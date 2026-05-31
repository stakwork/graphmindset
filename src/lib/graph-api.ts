import { api, API_URL } from "./api"
import { getSignedMessage, getL402 } from "./sphinx"
import { isMocksEnabled, MOCK_REVIEWS } from "./mock-data"

export interface GraphNode {
  ref_id: string
  node_type: string
  properties: Record<string, unknown>
  date_added_to_graph?: number
  score?: number
  match_type?: "exact" | "fuzzy" | "semantic"
  weight?: number
  matched_property?: string
  match_excerpt?: string | null
}

export interface GraphEdge {
  source: string
  target: string
  edge_type: string
  ref_id?: string
  properties?: Record<string, unknown>
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

interface NodesListResponse {
  nodes: GraphNode[]
  edges?: GraphEdge[]
  totalCount?: number
}

interface StatsResponse {
  num_nodes: number
  num_episodes: number
  num_people: number
  num_audio: number
  num_video: number
  num_tweet: number
  num_documents: number
  [key: string]: number
}

// Domains used by default search. Backend's namespace schema decides what's
// available. Callers can pass `opts.domains` to scope the search; passing an
// unknown domain returns 400 INVALID_DOMAIN.
export const DEFAULT_SEARCH_DOMAINS: readonly string[] = []

// Search nodes via v2 endpoint
export async function searchNodes(
  query: string,
  opts?: { limit?: number; skip?: number; node_type?: string; domains?: string[] },
  signal?: AbortSignal
): Promise<NodesListResponse> {
  const params = new URLSearchParams({
    q: query,
    limit: String(opts?.limit ?? 50),
    skip: String(opts?.skip ?? 0),
  })
  if (opts?.node_type) params.set("node_type", opts.node_type)

  const domains = opts?.domains ?? DEFAULT_SEARCH_DOMAINS
  if (domains.length > 0) {
    params.set("domains", domains.join(","))
  }

  return api.get<NodesListResponse>(
    `/v2/nodes?${params}`,
    undefined,
    signal
  )
}

// Latest 100 nodes added to the graph + their 1-hop edges. Used to populate
// the canvas on initial mount before the user has issued a search.
// `skip_cache=1` bypasses the backend's Redis response cache so we get a
// fresh answer instead of a stale empty payload from a prior cold start.
export async function getLatestNodes(signal?: AbortSignal): Promise<NodesListResponse> {
  return api.get<NodesListResponse>("/v2/nodes/latest?skip_cache=1", undefined, signal)
}

// Latest nodes of a given type, sorted by date_added_to_graph DESC.
// Used for Hot Takes (Clip nodes) and the Latest Clips panel.
export async function listLatestByType(
  type: string,
  limit = 10,
  skip = 0,
  signal?: AbortSignal
): Promise<NodesListResponse> {
  const params = new URLSearchParams({
    type,
    limit: String(limit),
    skip: String(skip),
  })
  return api.get<NodesListResponse>(`/v2/nodes/latest?${params.toString()}`, undefined, signal)
}

// List nodes (no search query)
export async function listNodes(
  opts?: { limit?: number; skip?: number; node_type?: string },
  signal?: AbortSignal
): Promise<NodesListResponse> {
  const params = new URLSearchParams({
    limit: String(opts?.limit ?? 50),
    skip: String(opts?.skip ?? 0),
  })
  if (opts?.node_type) params.set("node_type", opts.node_type)

  return api.get<NodesListResponse>(
    `/v2/nodes?${params}`,
    undefined,
    signal
  )
}

// Type guard for GraphData
export function isGraphData(r: unknown): r is GraphData {
  return (
    typeof r === "object" &&
    r !== null &&
    Array.isArray((r as GraphData).nodes) &&
    Array.isArray((r as GraphData).edges)
  )
}

// Get a single node (optionally with edges)
export async function getNode(refId: string, expand: "edges", signal?: AbortSignal): Promise<GraphData>
export async function getNode(refId: string, expand?: undefined, signal?: AbortSignal): Promise<GraphNode>
export async function getNode(
  refId: string,
  expand?: "edges",
  signal?: AbortSignal
): Promise<GraphNode | GraphData> {
  const params = expand ? `?expand=${expand}` : ""
  return api.get<GraphNode | GraphData>(
    `/v2/nodes/${refId}${params}`,
    undefined,
    signal
  )
}

// Create a node via the generic paid endpoint (POST /v2/nodes)
export async function createNode(
  nodeType: string,
  nodeData: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  return api.post("/v2/nodes", { node_type: nodeType, node_data: nodeData }, undefined, signal)
}

// Upload an image file and attach it to an existing Image node.
//
// The Image node must have been created first via createNode("Image", ...).
// Backend resolves the caller's identity (admin or owner via L402/Sphinx-sig)
// and writes the resulting S3 URL onto the node's `url` property.
//
// Built as a one-off rather than going through `api.post` because that helper
// always JSON-encodes the body — multipart needs FormData and the browser
// setting its own boundary'd Content-Type header.
export async function uploadImageToNode(
  refId: string,
  file: File,
  signal?: AbortSignal
): Promise<{ url: string; ref_id: string }> {
  const url = new URL(`${API_URL}/v2/images/${refId}/upload`)

  // Sphinx-signed admin path piggybacks on query params (matches api.ts).
  const signed = await getSignedMessage()
  if (signed.signature) {
    url.searchParams.append("sig", signed.signature)
    url.searchParams.append("msg", signed.message)
  }

  const headers: Record<string, string> = {}
  const l402 = await getL402()
  if (l402) headers.Authorization = l402

  const form = new FormData()
  form.append("file", file)

  // Do NOT set Content-Type — the browser fills in the multipart boundary.
  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: form,
    signal: signal ?? new AbortController().signal,
  })

  if (!response.ok) {
    throw response
  }
  return response.json()
}

// Mirrors jarvis ALLOWED_ORIGINAL_TYPES + MAX_IMAGE_UPLOAD_BYTES. Kept in sync
// manually — change both at once. SVG/HEIC deliberately excluded (XSS surface,
// missing Pillow codec respectively).
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const
export const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024

// Single-shot image content upload — multipart POST to /v2/content/image.
// Backend stages the original bytes in sphinx-swarm/temp, creates the Image
// node, and triggers the Stakwork workflow that relocates the file to
// permanent storage. Caller doesn't need to call createNode first.
//
// Multipart same as uploadImageToNode — bypasses api.post (which forces
// application/json) so the browser can set the multipart boundary itself.
export async function addImageContent(
  file: File,
  opts: { name?: string; webhookUrl?: string } = {},
  signal?: AbortSignal
): Promise<{
  status: string
  nodes: Array<Record<string, unknown>>
  status_messages: string[]
  temp_url?: string
}> {
  const url = new URL(`${API_URL}/v2/content/image`)

  const signed = await getSignedMessage()
  if (signed.signature) {
    url.searchParams.append("sig", signed.signature)
    url.searchParams.append("msg", signed.message)
  }

  const headers: Record<string, string> = {}
  const l402 = await getL402()
  if (l402) headers.Authorization = l402

  const form = new FormData()
  form.append("file", file)
  if (opts.name) form.append("name", opts.name)
  if (opts.webhookUrl) form.append("webhook_url", opts.webhookUrl)

  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: form,
    signal: signal ?? new AbortController().signal,
  })

  if (!response.ok) {
    throw response
  }
  return response.json()
}

// Update a node
export async function updateNode(
  refId: string,
  data: Record<string, unknown>,
  signal?: AbortSignal
) {
  return api.post(`/v2/nodes/${refId}`, data, undefined, signal)
}

// Admin update a node via boltwall PUT /node (type changes + property edits)
export async function adminUpdateNode(
  payload: {
    ref_id: string
    node_type: string
    node_data: Record<string, unknown>
    type_to_be_deleted?: string[]
    properties_to_be_deleted?: string[]
  },
  signal?: AbortSignal
) {
  return api.put("/node", payload, undefined, signal)
}

// Delete a node
export async function deleteNode(refId: string, signal?: AbortSignal) {
  return api.delete(`/v2/nodes/${refId}`, undefined, signal)
}

// List edges
export async function listEdges(
  opts?: { limit?: number; skip?: number },
  signal?: AbortSignal
) {
  const params = new URLSearchParams({
    limit: String(opts?.limit ?? 50),
    skip: String(opts?.skip ?? 0),
  })
  return api.get<{ edges: GraphEdge[] }>(
    `/v2/edges?${params}`,
    undefined,
    signal
  )
}

// Create edge(s)
export async function createEdge(
  data: Record<string, unknown> | Record<string, unknown>[],
  signal?: AbortSignal
) {
  return api.post("/v2/edges", data, undefined, signal)
}

// Delete an edge
export async function deleteEdge(refId: string, signal?: AbortSignal) {
  return api.delete(`/v2/edges/${refId}`, undefined, signal)
}

// Get graph stats
export async function getStats(signal?: AbortSignal): Promise<StatsResponse> {
  return api.get<StatsResponse>("/stats", undefined, signal)
}

// Add content via v2/content
export async function addContent(
  data: { source: string; source_type: string; topics?: string[]; category?: string; weight?: number },
  signal?: AbortSignal
) {
  return api.post("/radar", data, undefined, signal)
}

// --- Cron / Radar config --------------------------------------------------

export type RadarSourceType =
  | "twitter_handle"
  | "youtube_channel"
  | "rss"
  | "topic"

export const RADAR_SOURCE_TYPES: RadarSourceType[] = [
  "twitter_handle",
  "youtube_channel",
  "rss",
  "topic",
]

export type JanitorSourceType = "deduplication" | "content_review" | "topic_review" | "orphan_node"

export type CronKind = "source" | "janitor"

export interface CronConfig {
  ref_id: string
  namespace: string
  source_type: RadarSourceType | JanitorSourceType
  kind: CronKind
  enabled: boolean
  cadence: string
  workflow_id: string
  label?: string
  created_at?: number
  updated_at?: number
  last_run_at?: number
}

/** @deprecated Use CronConfig */
export type RadarConfig = CronConfig

export interface StakworkRun {
  ref_id: string
  namespace?: string
  source_type?: string
  kind?: CronKind
  job_type?: string
  trigger?: "SCHEDULED" | "MANUAL"
  status: "pending" | "in_progress" | "completed" | "halted" | "error" | "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "ERROR" | "HALTED"
  error?: string
  error_message?: string
  created_at?: number
  started_at?: number
  finished_at?: number
}

export async function getCronConfig(
  opts: { kind?: CronKind },
  signal?: AbortSignal
): Promise<{ configs: CronConfig[] }> {
  const params = new URLSearchParams()
  if (opts.kind) params.set("kind", opts.kind)
  return api.get<{ configs: CronConfig[] }>(
    `/v2/cron/config?${params}`,
    undefined,
    signal
  )
}

export async function updateCronConfig(
  sourceType: string,
  fields: Partial<Pick<CronConfig, "enabled" | "cadence" | "workflow_id">>,
  signal?: AbortSignal
): Promise<{ config: CronConfig }> {
  return api.put<{ config: CronConfig }>(
    `/v2/cron/config/${sourceType}`,
    fields,
    undefined,
    signal
  )
}

export async function runCron(
  sourceType: string,
  signal?: AbortSignal
): Promise<{ run: StakworkRun }> {
  return api.post<{ run: StakworkRun }>(
    `/v2/cron/${sourceType}/run`,
    {},
    undefined,
    signal
  )
}

export interface WorkflowMarketplaceItem {
  ref_id: string
  label?: string
  source_type: RadarSourceType | JanitorSourceType
  kind: CronKind
  enabled: boolean
}

export async function getWorkflowMarketplace(
  signal?: AbortSignal
): Promise<WorkflowMarketplaceItem[]> {
  const { isMocksEnabled, MOCK_WORKFLOW_MARKETPLACE } = await import("./mock-data")
  if (isMocksEnabled()) {
    return MOCK_WORKFLOW_MARKETPLACE
  }
  const res = await api.get<{ workflows: WorkflowMarketplaceItem[] }>(
    '/v2/workflows/marketplace',
    undefined,
    signal
  )
  return res.workflows ?? []
}

export async function getCronRuns(
  opts: { source_type?: string; kind?: CronKind; limit?: number },
  signal?: AbortSignal
): Promise<{ runs: StakworkRun[] }> {
  const params = new URLSearchParams()
  if (opts.source_type) params.set("source_type", opts.source_type)
  if (opts.kind) params.set("kind", opts.kind)
  if (opts.limit !== undefined) params.set("limit", String(opts.limit))
  return api.get<{ runs: StakworkRun[] }>(
    `/v2/cron/runs?${params}`,
    undefined,
    signal
  )
}

// --- Domains & hidden types ----------------------------------------------

export interface SchemaDomainsResponse {
  domains: string[]
  hidden_types: string[]
  hidden_domains: string[]
}

// Returns the available domain roots for this namespace plus the hidden_types
// and hidden_domains lists (schema types/domains excluded from Domain_* labeling).
export async function getSchemaDomains(
  signal?: AbortSignal
): Promise<SchemaDomainsResponse> {
  return api.get<SchemaDomainsResponse>(
    "/v2/schema/domains",
    undefined,
    signal
  )
}

// Write the hidden_types and hidden_domains lists (with required title/description)
// via /about. The backend diffs old vs new and re-labels affected nodes in the
// background. Pass `undefined` for either list to leave it untouched.
export async function updateHiddenLists(
  title: string,
  description: string,
  hiddenTypes: string[] | undefined,
  hiddenDomains: string[] | undefined,
  signal?: AbortSignal
): Promise<{ status: string }> {
  const body: Record<string, unknown> = { title, description }
  if (hiddenTypes !== undefined) body.hidden_types = hiddenTypes
  if (hiddenDomains !== undefined) body.hidden_domains = hiddenDomains
  return api.post<{ status: string }>("/about", body, undefined, signal)
}

// Free preflight — no payment required
export async function checkTopicExists(
  name: string,
  signal?: AbortSignal
): Promise<{ exists: boolean; ref_id: string | null }> {
  const params = new URLSearchParams({ name })
  return api.get(`/v2/nodes/topic-check?${params}`, undefined, signal)
}

// Generic ontology-driven duplicate check — no payment required
export async function checkNodeExists(
  nodeType: string,
  key: string,
  signal?: AbortSignal
): Promise<{ exists: boolean; ref_id: string | null; status: string | null }> {
  const params = new URLSearchParams({ node_type: nodeType, key })
  try {
    return await api.get<{ exists: boolean; ref_id: string | null; status: string | null }>(
      `/v2/nodes/check?${params}`,
      undefined,
      signal
    )
  } catch {
    return { exists: false, ref_id: null, status: null }
  }
}




// -------------------------------------------------------------------------
// Deep Research
// -------------------------------------------------------------------------

// In-flight deep-research mock poll counter (per ref_id)
const _mockDeepResearchPollCounts: Record<string, number> = {}

// Paid — L402 handled identically to createNode (handles 402 challenge)
export async function triggerDeepResearch(
  refId: string,
  signal?: AbortSignal
): Promise<{ stakwork_run_ref_id: string }> {
  if (isMocksEnabled()) {
    // Reset poll counter so the next getLatestStakworkRun calls cycle through states
    _mockDeepResearchPollCounts[refId] = 0
    return { stakwork_run_ref_id: "mock-deep-run-" + refId }
  }
  return api.post<{ stakwork_run_ref_id: string }>(
    `/v2/nodes/${refId}/deep-research`,
    {},
    undefined,
    signal
  )
}

// Free poll — returns null when no run exists (404)
export async function getLatestStakworkRun(
  refId: string,
  jobType: string,
  signal?: AbortSignal
): Promise<StakworkRun | null> {
  if (isMocksEnabled()) {
    const count = (_mockDeepResearchPollCounts[refId] ?? 0) + 1
    _mockDeepResearchPollCounts[refId] = count
    if (count <= 2) {
      return {
        ref_id: "mock-deep-run-" + refId,
        job_type: jobType,
        status: "RUNNING",
        created_at: Math.floor(Date.now() / 1000),
      }
    }
    return {
      ref_id: "mock-deep-run-" + refId,
      job_type: jobType,
      status: "COMPLETED",
      created_at: Math.floor(Date.now() / 1000),
      finished_at: Math.floor(Date.now() / 1000),
    }
  }
  try {
    const params = new URLSearchParams({ ref_id: refId, job_type: jobType })
    return await api.get<StakworkRun>(
      `/v2/stakwork-runs/latest?${params}`,
      undefined,
      signal
    )
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { status?: number }).status === 404) return null
    throw err
  }
}

// -------------------------------------------------------------------------
// Reviews
// -------------------------------------------------------------------------

export type ReviewStatus = "pending" | "approved" | "dismissed" | "failed"

export interface Review {
  ref_id: string
  type: string
  rationale: string
  subject_ids: string[]
  subject_nodes: Array<{
    ref_id: string
    node_type: string | null
    properties: Record<string, unknown> | null
  }>
  action_name: string
  action_payload: unknown
  status: ReviewStatus
  fingerprint: string
  priority: number
  dismissal_reason?: string
  error_message?: string
  run_ref_id?: string
  created_at: string
  decided_at?: string
  decided_by?: string
  display_label?: string
  accent?: string
  action_verb?: string
  icon?: string
}

export interface ReviewsListResponse {
  reviews: Review[]
  total: number
  skip: number
  limit: number
}

// In-memory mock store (shared across mock API calls) — populated lazily on first use
let _mockReviewsStore: Review[] | null = null
function getMockReviewsStore(): Review[] {
  if (!_mockReviewsStore) {
    _mockReviewsStore = MOCK_REVIEWS.map((r) => ({ ...r }))
  }
  return _mockReviewsStore
}

export async function listReviews(
  params?: { status?: ReviewStatus; type?: string; action_name?: string; sort?: string; skip?: number; limit?: number },
  signal?: AbortSignal
): Promise<ReviewsListResponse> {
  if (isMocksEnabled()) {
    const store = getMockReviewsStore()
    let filtered = [...store]
    if (params?.status) filtered = filtered.filter((r) => r.status === params.status)
    if (params?.type) filtered = filtered.filter((r) => r.type === params.type)
    if (params?.action_name) filtered = filtered.filter((r) => r.action_name === params.action_name)
    const sort = params?.sort ?? "created_at"
    if (sort === "priority") {
      filtered.sort((a, b) => b.priority - a.priority)
    } else {
      filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }
    const skip = params?.skip ?? 0
    const limit = params?.limit ?? 20
    return {
      reviews: filtered.slice(skip, skip + limit),
      total: filtered.length,
      skip,
      limit,
    }
  }

  const qs = new URLSearchParams()
  if (params?.status) qs.set("status", params.status)
  if (params?.type) qs.set("type", params.type)
  if (params?.action_name) qs.set("action_name", params.action_name)
  if (params?.sort) qs.set("sort", params.sort)
  if (params?.skip !== undefined) qs.set("skip", String(params.skip))
  if (params?.limit !== undefined) qs.set("limit", String(params.limit))
  return api.get<ReviewsListResponse>(`/v2/reviews?${qs}`, undefined, signal)
}

export async function approveReview(
  refId: string,
  signal?: AbortSignal
): Promise<{ status: string; error_message?: string }> {
  if (isMocksEnabled()) {
    const store = getMockReviewsStore()
    const review = store.find((r) => r.ref_id === refId)
    if (review) {
      review.status = "approved"
      review.decided_at = new Date().toISOString()
      review.decided_by = "mock-admin"
    }
    return { status: "approved" }
  }
  return api.post<{ status: string; error_message?: string }>(
    `/v2/reviews/${refId}/approve`,
    {},
    undefined,
    signal
  )
}

export async function dismissReview(
  refId: string,
  reason?: string,
  signal?: AbortSignal
): Promise<{ status: string }> {
  if (isMocksEnabled()) {
    const store = getMockReviewsStore()
    const review = store.find((r) => r.ref_id === refId)
    if (review) {
      review.status = "dismissed"
      review.decided_at = new Date().toISOString()
      review.decided_by = "mock-admin"
      if (reason) review.dismissal_reason = reason
    }
    return { status: "dismissed" }
  }
  return api.post<{ status: string }>(
    `/v2/reviews/${refId}/dismiss`,
    { reason },
    undefined,
    signal
  )
}
