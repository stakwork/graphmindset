import { api } from "./api"

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

// Domains used by default search. Caller can override via `opts.domains`.
export const DEFAULT_SEARCH_DOMAINS: readonly string[] = ["content"]

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

// Create node(s)
export async function createNode(
  data: Record<string, unknown> | Record<string, unknown>[],
  signal?: AbortSignal
) {
  return api.post("/v2/nodes", data, undefined, signal)
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

// --- Radar config ---------------------------------------------------------

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

export interface RadarConfig {
  ref_id: string
  namespace: string
  source_type: RadarSourceType
  enabled: boolean
  cadence: string
  workflow_id: string
  created_at?: number
  updated_at?: number
}

export async function getRadarConfig(
  signal?: AbortSignal
): Promise<{ configs: RadarConfig[] }> {
  return api.get<{ configs: RadarConfig[] }>(
    "/v2/radar/config",
    undefined,
    signal
  )
}

export async function updateRadarConfig(
  sourceType: RadarSourceType,
  fields: Partial<Pick<RadarConfig, "enabled" | "cadence" | "workflow_id">>,
  signal?: AbortSignal
): Promise<{ config: RadarConfig }> {
  return api.put<{ config: RadarConfig }>(
    `/v2/radar/config/${sourceType}`,
    fields,
    undefined,
    signal
  )
}

// --- Domains & hidden types ----------------------------------------------

export interface SchemaDomainsResponse {
  domains: string[]
  hidden: string[]
}

// Returns the available domain roots for this namespace and the current
// hidden_types list (schema types excluded from Domain_* labeling).
export async function getSchemaDomains(
  signal?: AbortSignal
): Promise<SchemaDomainsResponse> {
  return api.get<SchemaDomainsResponse>(
    "/v2/schema/domains",
    undefined,
    signal
  )
}

// Write the hidden_types list (and required title/description) via /about.
// The backend diffs old vs new and re-labels affected nodes in the background.
export async function updateHiddenTypes(
  title: string,
  description: string,
  hiddenTypes: string[],
  signal?: AbortSignal
): Promise<{ status: string }> {
  return api.post<{ status: string }>(
    "/about",
    { title, description, hidden_types: hiddenTypes },
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

// Paid topic creation via POST /v2/topic
export async function createTopic(
  data: { name: string; description?: string },
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  return api.post("/v2/topic", data, undefined, signal)
}

export async function runRadarNow(
  sourceType: RadarSourceType,
  signal?: AbortSignal
): Promise<{ status: string; dispatched: number; failed: string[] }> {
  return api.post<{ status: string; dispatched: number; failed: string[] }>(
    `/v2/radar/run/${sourceType}`,
    {},
    undefined,
    signal
  )
}
