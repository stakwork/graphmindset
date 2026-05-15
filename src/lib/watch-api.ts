import { api } from "./api"
import { isMocksEnabled, MOCK_NODES, MOCK_EDGES } from "./mock-data"
import type { GraphNode, GraphEdge } from "./graph-api"

export interface WatchEntry {
  ref_id: string
  node_type?: string
  title?: string
}

export async function watchNode(refId: string): Promise<void> {
  if (isMocksEnabled()) return
  await api.post(`/v2/watch/node/${refId}`, {})
}

export async function unwatchNode(refId: string): Promise<void> {
  if (isMocksEnabled()) return
  await api.delete(`/v2/watch/node/${refId}`)
}

export async function subscribeType(nodeType: string): Promise<void> {
  if (isMocksEnabled()) return
  await api.post(`/v2/watch/type/${nodeType}`, {})
}

export async function unsubscribeType(nodeType: string): Promise<void> {
  if (isMocksEnabled()) return
  await api.delete(`/v2/watch/type/${nodeType}`)
}

export async function getWatches(): Promise<{ nodes: WatchEntry[]; types: string[] }> {
  if (isMocksEnabled()) {
    return {
      nodes: [{ ref_id: "mock-1", node_type: "Episode", title: "Mock Episode" }],
      types: ["Clip"],
    }
  }
  return api.get<{ nodes: WatchEntry[]; types: string[] }>("/v2/watches")
}

export async function getFollowingFeed(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  if (isMocksEnabled()) {
    return {
      nodes: MOCK_NODES.slice(0, 5),
      edges: MOCK_EDGES.slice(0, 5),
    }
  }
  return api.get<{ nodes: GraphNode[]; edges: GraphEdge[] }>("/v2/feed/following")
}
