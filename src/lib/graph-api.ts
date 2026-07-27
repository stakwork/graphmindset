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
  opts?: { limit?: number; skip?: number; node_type?: string; domains?: string[]; ui_skin?: string },
  signal?: AbortSignal
): Promise<NodesListResponse> {
  const params = new URLSearchParams({
    q: query,
    limit: String(opts?.limit ?? 50),
    skip: String(opts?.skip ?? 0),
  })
  if (opts?.node_type) params.set("node_type", opts.node_type)
  if (opts?.ui_skin) params.set("ui_skin", opts.ui_skin)

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

// Lightweight node search for the edge-picker autocomplete. Hits the dedicated
// /v2/nodes/search endpoint, which returns matches ONLY (no 1-hop neighbour
// expansion, no edges) and just {node_type, ref_id, title}. Unlike /v2/nodes
// this route is free on boltwall, so it's safe to call per keystroke.
//
// The lite payload is adapted to the GraphNode shape (title -> properties.name)
// so existing consumers (NodeSearchInput, resolveNodeTitle) keep working without
// any special-casing.
export async function searchNodesForEdge(
  query: string,
  opts?: { limit?: number; node_type?: string },
  signal?: AbortSignal
): Promise<NodesListResponse> {
  const params = new URLSearchParams({
    q: query,
    limit: String(opts?.limit ?? 10),
  })
  if (opts?.node_type) params.set("node_type", opts.node_type)

  const res = await api.get<{
    nodes: { node_type: string; ref_id: string; title: string | null }[]
  }>(`/v2/nodes/search?${params}`, undefined, signal)

  return {
    nodes: (res.nodes ?? []).map((n) => ({
      ref_id: n.ref_id,
      node_type: n.node_type,
      properties: { name: n.title ?? "" },
    })),
  }
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

// Fetch only the *attachable* 1-hop neighbours of a node — edges carrying
// `attachable: true` — via the backend's server-side `edge_props` filter.
// Used by the preview panel to render native embeds (images, episodes…) without
// pulling the node's full (potentially huge) neighbourhood. Returns the host +
// attached peers in { nodes, edges }; the filter runs in Neo4j, so only matching
// edges come back.
export async function getAttachables(refId: string, signal?: AbortSignal): Promise<GraphData> {
  const edgeProps = encodeURIComponent(JSON.stringify({ attachable: true }))
  return api.get<GraphData>(
    `/v2/nodes/${refId}?expand=edges&edge_props=${edgeProps}`,
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

// Set a node's image via the Stakwork pipeline (any node type).
//
// POSTs the file to /v2/nodes/<ref>/image: the backend stages it to temp S3,
// points image_url at the presigned temp URL (so it renders immediately), and
// dispatches the workflow that relocates it to permanent storage and writes the
// durable URL back via /v2/images/finalize. Returns the temp URL for preview;
// `status` is "processing" while the workflow runs. Caller identity is admin or
// owner of the target (via L402/Sphinx-sig).
//
// Built as a one-off rather than going through `api.post` because that helper
// always JSON-encodes the body — multipart needs FormData and the browser
// setting its own boundary'd Content-Type header.
export async function uploadImageToNode(
  refId: string,
  file: File,
  signal?: AbortSignal
): Promise<{ url: string; ref_id: string; status?: string }> {
  const url = new URL(`${API_URL}/v2/nodes/${refId}/image`)

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
  const body = (await response.json()) as {
    image_url?: string
    temp_url?: string
    ref_id: string
    status?: string
  }
  return {
    url: body.image_url ?? body.temp_url ?? "",
    ref_id: body.ref_id,
    status: body.status,
  }
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
  response?: string
  created_at?: number
  started_at?: number
  finished_at?: number
  project_id?: number
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

export type AuditEntry = { name: string; count: number }
export type AuditCategory = {
  healthy: AuditEntry[]
  orphaned: AuditEntry[]
  unused: AuditEntry[]
}
export type SchemaAuditData = {
  node_labels: AuditCategory
  relationship_types: AuditCategory
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

// Re-apply canonical Domain_* labels to existing nodes of the given schema
// types after their `domain` was assigned/renamed. New nodes already get the
// right label at ingest; this catches up existing ones. Runs in a background
// job server-side and returns immediately. No-op in mock mode.
export async function relabelDomain(
  types: string[],
  signal?: AbortSignal
): Promise<{ status: string; types: string[] }> {
  if (isMocksEnabled()) return { status: "relabeling", types }
  return api.post<{ status: string; types: string[] }>(
    "/v2/schema/relabel-domain",
    { types },
    undefined,
    signal
  )
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
): Promise<{ exists: boolean; ref_id: string | null; status: string | null; owner_reference_id: string | null }> {
  const params = new URLSearchParams({ node_type: nodeType, key })
  try {
    return await api.get<{ exists: boolean; ref_id: string | null; status: string | null; owner_reference_id: string | null }>(
      `/v2/nodes/check?${params}`,
      undefined,
      signal
    )
  } catch {
    return { exists: false, ref_id: null, status: null, owner_reference_id: null }
  }
}

// Hash-based duplicate check for file-upload dedup via content_hash
export async function checkNodeExistsByHash(
  nodeType: string,
  hash: string,
  signal?: AbortSignal
): Promise<{ exists: boolean; ref_id: string | null; status: string | null; owner_reference_id: string | null }> {
  const params = new URLSearchParams({ node_type: nodeType, hash })
  try {
    return await api.get<{ exists: boolean; ref_id: string | null; status: string | null; owner_reference_id: string | null }>(
      `/v2/nodes/check?${params}`,
      undefined,
      signal
    )
  } catch {
    return { exists: false, ref_id: null, status: null, owner_reference_id: null }
  }
}

// Maps content_type values to their corresponding node type names
export const CONTENT_TYPE_TO_NODE_TYPE: Record<string, string> = {
  audio_video: "Episode",
  document: "Document",
  webpage: "Document",
  arxiv_paper: "ArxivPaper",
  tweet: "Tweet",
  legal_document: "LegalDocument",
}

// Re-process an existing node via force_update — follows L402 payment flow
export async function reprocessContent(
  refId: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  const l402 = await getL402()
  const headers: Record<string, string> = {}
  if (l402) headers["Authorization"] = l402
  return api.post("/v2/content", { ...body, ref_id: refId, force_update: true }, headers, signal)
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

// Admin-only enrich (web search) — no payment gate
export async function triggerEnrich(
  refId: string,
  signal?: AbortSignal
): Promise<{ stakwork_run_ref_id: string }> {
  if (isMocksEnabled()) {
    _mockDeepResearchPollCounts[refId + "_enrich"] = 0
    return { stakwork_run_ref_id: "mock-enrich-run-" + refId }
  }
  return api.post<{ stakwork_run_ref_id: string }>(
    `/v2/nodes/${refId}/enrich`,
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
    const mockKey = jobType === "web_search_enrich" ? refId + "_enrich" : refId
    const count = (_mockDeepResearchPollCounts[mockKey] ?? 0) + 1
    _mockDeepResearchPollCounts[mockKey] = count
    const runPrefix = jobType === "web_search_enrich" ? "mock-enrich-run-" : "mock-deep-run-"
    if (count <= 2) {
      return {
        ref_id: runPrefix + refId,
        job_type: jobType,
        status: "RUNNING",
        created_at: Math.floor(Date.now() / 1000),
      }
    }
    return {
      ref_id: runPrefix + refId,
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
// Ontology Agent (plain-language schema editing)
// -------------------------------------------------------------------------

export interface OntologyAgentMessage {
  role: "user" | "agent"
  content: string
}

// Per-run mock poll counters (mirrors the deep-research mock pattern)
const _mockOntologyPollCounts: Record<string, number> = {}
let _mockOntologyRunCounter = 0

// Admin-only, graph-scoped. Triggers the ontology_agent workflow; proposals
// come back as reviews (polled via getStakworkRun → listReviews(run_ref_id)).
export async function triggerOntologyAgent(
  instruction: string,
  history?: OntologyAgentMessage[],
  signal?: AbortSignal
): Promise<{ stakwork_run_ref_id: string }> {
  if (isMocksEnabled()) {
    const runRef = `mock-ontology-run-${++_mockOntologyRunCounter}`
    _mockOntologyPollCounts[runRef] = 0
    // Seed a couple of pending schema-change reviews tied to this run so the
    // conversational panel can render + approve them once the run "completes".
    getMockReviewsStore().unshift(...buildMockOntologyReviews(runRef, instruction))
    return { stakwork_run_ref_id: runRef }
  }
  return api.post<{ stakwork_run_ref_id: string }>(
    "/v2/schema/ontology-agent",
    { instruction, history: history ?? [] },
    undefined,
    signal
  )
}

// Poll a single run by its run ref_id (graph-scoped runs have no node ref_id).
export async function getStakworkRun(
  refId: string,
  signal?: AbortSignal
): Promise<StakworkRun | null> {
  if (isMocksEnabled()) {
    const count = (_mockOntologyPollCounts[refId] ?? 0) + 1
    _mockOntologyPollCounts[refId] = count
    const running = count <= 2
    return {
      ref_id: refId,
      job_type: "ontology_agent",
      status: running ? "RUNNING" : "COMPLETED",
      created_at: Math.floor(Date.now() / 1000),
      ...(running
        ? {}
        : {
            finished_at: Math.floor(Date.now() / 1000),
            response:
              "I've drafted the schema changes below — review and approve them to apply. Let me know if you'd like to adjust anything.",
          }),
    }
  }
  try {
    return await api.get<StakworkRun>(`/v2/stakwork-runs/${refId}`, undefined, signal)
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { status?: number }).status === 404) return null
    throw err
  }
}

// Mock-only: fabricate schema-change reviews so the panel is demoable end-to-end.
function buildMockOntologyReviews(runRef: string, instruction: string): Review[] {
  const now = new Date().toISOString()
  const base = { status: "pending" as ReviewStatus, priority: 5, subject_ids: [], subject_nodes: [], created_at: now, run_ref_id: runRef }
  return [
    {
      ...base,
      ref_id: `${runRef}-r1`,
      type: "schema_change",
      rationale: `Proposed from: "${instruction}"`,
      action_name: "add_schema_node_type",
      action_payload: {
        type: "Podcast",
        parent: "Media",
        color: "#8b5cf6",
        node_key: "name",
        attributes: [
          { key: "name", type: "string", required: true },
          { key: "episode_count", type: "number", required: false },
        ],
      },
      fingerprint: `${runRef}-r1`,
      icon: "layers",
    },
    {
      ...base,
      ref_id: `${runRef}-r2`,
      type: "schema_change",
      rationale: `Proposed from: "${instruction}"`,
      action_name: "add_schema_edge_type",
      action_payload: { edge_type: "HOSTED_BY", source: "Podcast", target: "Person" },
      fingerprint: `${runRef}-r2`,
      icon: "network",
    },
  ]
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
  params?: { status?: ReviewStatus; type?: string; action_name?: string; run_ref_id?: string; sort?: string; skip?: number; limit?: number; search?: string; node_type?: string },
  signal?: AbortSignal
): Promise<ReviewsListResponse> {
  if (isMocksEnabled()) {
    const store = getMockReviewsStore()
    let filtered = [...store]
    if (params?.status) filtered = filtered.filter((r) => r.status === params.status)
    if (params?.type) filtered = filtered.filter((r) => r.type === params.type)
    if (params?.action_name) filtered = filtered.filter((r) => r.action_name === params.action_name)
    if (params?.run_ref_id) filtered = filtered.filter((r) => r.run_ref_id === params.run_ref_id)
    if (params?.search) {
      const q = params.search.toLowerCase()
      filtered = filtered.filter(
        (r) =>
          r.rationale?.toLowerCase().includes(q) ||
          r.display_label?.toLowerCase().includes(q)
      )
    }
    if (params?.node_type) {
      filtered = filtered.filter((r) =>
        params.node_type === "Unknown"
          ? !r.subject_nodes || r.subject_nodes.length === 0
          : r.subject_nodes?.some((sn) => sn.node_type === params.node_type)
      )
    }
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
  if (params?.run_ref_id) qs.set("run_ref_id", params.run_ref_id)
  if (params?.sort) qs.set("sort", params.sort)
  if (params?.skip !== undefined) qs.set("skip", String(params.skip))
  if (params?.limit !== undefined) qs.set("limit", String(params.limit))
  if (params?.search) qs.set("search", params.search)
  if (params?.node_type) qs.set("node_type", params.node_type)
  return api.get<ReviewsListResponse>(`/v2/reviews?${qs}`, undefined, signal)
}

export async function getReviewNodeTypeCounts(
  params?: { status?: ReviewStatus; action_name?: string; search?: string },
  signal?: AbortSignal
): Promise<{ counts: Record<string, number>; truncated: boolean }> {
  if (isMocksEnabled()) {
    const store = getMockReviewsStore()
    let filtered = [...store]
    if (params?.status) filtered = filtered.filter((r) => r.status === params.status)
    if (params?.action_name) filtered = filtered.filter((r) => r.action_name === params.action_name)
    if (params?.search) {
      const q = params.search.toLowerCase()
      filtered = filtered.filter(
        (r) =>
          r.rationale?.toLowerCase().includes(q) ||
          r.display_label?.toLowerCase().includes(q)
      )
    }
    const counts: Record<string, number> = {}
    for (const review of filtered) {
      if (!review.subject_nodes || review.subject_nodes.length === 0) {
        counts["Unknown"] = (counts["Unknown"] ?? 0) + 1
      } else {
        const seen = new Set<string>()
        for (const sn of review.subject_nodes) {
          const nt = sn.node_type ?? "Unknown"
          if (!seen.has(nt)) {
            seen.add(nt)
            counts[nt] = (counts[nt] ?? 0) + 1
          }
        }
      }
    }
    return { counts, truncated: false }
  }

  const qs = new URLSearchParams()
  if (params?.status) qs.set("status", params.status)
  if (params?.action_name) qs.set("action_name", params.action_name)
  if (params?.search) qs.set("search", params.search)
  return api.get<{ counts: Record<string, number>; truncated: boolean }>(
    `/v2/reviews/node_type_counts?${qs}`,
    undefined,
    signal
  )
}

export async function approveReview(
  refId: string,
  overridePayload?: { from: string[]; to: string },
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
  const body = overridePayload ? { override_payload: overridePayload } : {}
  return api.post<{ status: string; error_message?: string }>(
    `/v2/reviews/${refId}/approve`,
    body,
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

export async function getSchemaAudit(): Promise<SchemaAuditData> {
  return api.get<SchemaAuditData>("/schema/audit")
}

// ── Legal document ingestion ─────────────────────────────────────────────────

// URL path — submits a publicly accessible PDF URL to the legal workflow.
export async function addLegalDocument(
  pdfUrl: string,
  signal?: AbortSignal
): Promise<{ status: string; nodes: Array<Record<string, unknown>>; status_messages: string[] }> {
  const l402 = await getL402()
  const headers: Record<string, string> = {}
  if (l402) headers["Authorization"] = l402
  return api.post("/v2/legal", { pdf_url: pdfUrl }, headers, signal)
}

// File path — multipart POST, mirrors addImageContent pattern.
export async function addLegalDocumentFile(
  file: File,
  signal?: AbortSignal
): Promise<{ status: string; nodes: Array<Record<string, unknown>>; status_messages: string[] }> {
  const url = new URL(`${API_URL}/v2/legal/upload`)

  const signed = await getSignedMessage()
  if (signed.signature) {
    url.searchParams.append("sig", signed.signature)
    url.searchParams.append("msg", signed.message)
  }

  const l402 = await getL402()
  const headers: Record<string, string> = {}
  if (l402) headers["Authorization"] = l402

  const form = new FormData()
  form.append("file", file)

  const response = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: form,
    signal: signal ?? new AbortController().signal,
  })

  if (!response.ok) throw response
  return response.json()
}

// ── Legal Domain Seed ─────────────────────────────────────────────────────────

// Curated Agreement-first seed for the legal skin.
// 1. Fetch up to 10 Agreement nodes.
// 2. Expand each agreement's 1-hop neighbours; collect Orgs and Persons.
// 3. Deduplicate by ref_id (Maps).
// 4. Top-up to 10 Orgs / 10 Persons if needed.
// 5. Filter edges to only those where both endpoints exist in the final set.
export async function getLegalInitialNodes(signal?: AbortSignal): Promise<GraphData> {
  const agreementsResp = await api.get<NodesListResponse>(
    "/v2/nodes/latest?node_type=Agreement&limit=10&skip_cache=1",
    undefined,
    signal
  )
  const agreements: GraphNode[] = agreementsResp.nodes ?? []

  const orgs = new Map<string, GraphNode>()
  const persons = new Map<string, GraphNode>()
  const allEdges: GraphEdge[] = []

  await Promise.all(
    agreements.map(async (agreement) => {
      try {
        const expanded = await getNode(agreement.ref_id, "edges", signal)
        for (const node of expanded.nodes ?? []) {
          if (node.node_type === "Organization") {
            if (!orgs.has(node.ref_id)) orgs.set(node.ref_id, node)
          } else if (node.node_type === "Person") {
            if (!persons.has(node.ref_id)) persons.set(node.ref_id, node)
          }
        }
        allEdges.push(...(expanded.edges ?? []))
      } catch (err) {
        console.warn(`[getLegalInitialNodes] expand failed for ${agreement.ref_id}:`, err)
      }
    })
  )

  if (orgs.size < 10) {
    try {
      const topupResp = await api.get<NodesListResponse>(
        "/v2/nodes/latest?node_type=Organization&limit=10&skip_cache=1",
        undefined,
        signal
      )
      for (const node of topupResp.nodes ?? []) {
        if (orgs.size >= 10) break
        if (!orgs.has(node.ref_id)) orgs.set(node.ref_id, node)
      }
    } catch (err) {
      console.warn("[getLegalInitialNodes] Organization top-up failed:", err)
    }
  }

  if (persons.size < 10) {
    try {
      const topupResp = await api.get<NodesListResponse>(
        "/v2/nodes/latest?node_type=Person&limit=10&skip_cache=1",
        undefined,
        signal
      )
      for (const node of topupResp.nodes ?? []) {
        if (persons.size >= 10) break
        if (!persons.has(node.ref_id)) persons.set(node.ref_id, node)
      }
    } catch (err) {
      console.warn("[getLegalInitialNodes] Person top-up failed:", err)
    }
  }

  const finalNodes: GraphNode[] = [
    ...agreements,
    ...orgs.values(),
    ...persons.values(),
  ]
  const finalRefIds = new Set<string>(finalNodes.map((n) => n.ref_id))

  const seenEdges = new Set<string>()
  const filteredEdges: GraphEdge[] = []
  for (const edge of allEdges) {
    if (!finalRefIds.has(edge.source) || !finalRefIds.has(edge.target)) continue
    const key = edge.ref_id
      ? edge.ref_id
      : `${edge.source}__${edge.target}__${edge.edge_type}`
    if (seenEdges.has(key)) continue
    seenEdges.add(key)
    filteredEdges.push(edge)
  }

  return { nodes: finalNodes, edges: filteredEdges }
}
