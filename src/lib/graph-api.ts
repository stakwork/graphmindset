import { api } from "./api"
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

// Update a node
export async function updateNode(
  refId: string,
  data: Record<string, unknown>,
  signal?: AbortSignal
) {
  return api.post(`/v2/nodes/${refId}`, data, undefined, signal)
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
  data: { source: string; source_type: string; topics?: string[] },
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

export type JanitorSourceType = "deduplication"

export type CronKind = "source" | "janitor"

export interface CronConfig {
  ref_id: string
  namespace: string
  source_type: RadarSourceType | JanitorSourceType
  kind: CronKind
  enabled: boolean
  cadence: string
  workflow_id: string
  created_at?: number
  updated_at?: number
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
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"
  error?: string
  created_at?: string
  started_at?: string
  finished_at?: string
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




// -------------------------------------------------------------------------
// Reviews
// -------------------------------------------------------------------------

export type ReviewStatus = "pending" | "approved" | "dismissed" | "failed"

export interface ReviewAction {
  name: string
  payload: unknown
}

export interface Review {
  ref_id: string
  type: string
  rationale: string
  subject_ids: string[]
  action: ReviewAction
  status: ReviewStatus
  fingerprint: string
  priority: number
  dismissal_reason?: string
  error_message?: string
  run_ref_id?: string
  created_at: string
  decided_at?: string
  decided_by?: string
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
  params?: { status?: ReviewStatus; type?: string; sort?: string; skip?: number; limit?: number },
  signal?: AbortSignal
): Promise<ReviewsListResponse> {
  if (isMocksEnabled()) {
    const store = getMockReviewsStore()
    let filtered = [...store]
    if (params?.status) filtered = filtered.filter((r) => r.status === params.status)
    if (params?.type) filtered = filtered.filter((r) => r.type === params.type)
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
