import { api } from "./api"

export interface GraphNode {
  ref_id: string
  node_type: string
  properties: Record<string, unknown>
  date_added_to_graph?: number
  score?: number
  match_type?: "exact" | "fuzzy" | "semantic"
  weight?: number
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

// Search nodes via v2 endpoint
export async function searchNodes(
  query: string,
  opts?: { limit?: number; skip?: number; node_type?: string },
  signal?: AbortSignal
): Promise<NodesListResponse> {
  const params = new URLSearchParams({
    q: query,
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

// Get a single node (optionally with edges)
export async function getNode(
  refId: string,
  expand?: "edges",
  signal?: AbortSignal
): Promise<GraphNode> {
  const params = expand ? `?expand=${expand}` : ""
  return api.get<GraphNode>(
    `/v2/nodes/${refId}${params}`,
    undefined,
    signal
  )
}

// Get node neighborhood (edges + connected nodes)
export async function getNodeNeighborhood(
  refId: string,
  signal?: AbortSignal
): Promise<GraphData> {
  return api.get<GraphData>(
    `/v2/nodes/${refId}/neighborhood`,
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

// Get purchased node ref_ids for current LSAT
export async function getPurchasedNodes(): Promise<{ ref_ids: string[] }> {
  return api.get<{ ref_ids: string[] }>("/lsat/purchased-nodes")
}

// Add content via v2/content
export async function addContent(
  data: { source: string; source_type: string },
  signal?: AbortSignal
) {
  return api.post("/radar", data, undefined, signal)
}
