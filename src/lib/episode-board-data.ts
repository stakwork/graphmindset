import { getNode, type GraphEdge, type GraphNode } from "./graph-api"
import type { BoardEdge, BoardNode } from "./board-dataset"

/**
 * Pulls everything the episode board needs from the live backend:
 * the episode's 1-hop neighbourhood (chapters, clips, show, entities) plus
 * one extra hop per chapter (claims, chapter-level mentions, and whatever
 * claim↔claim / authorship edges sit inside that neighbourhood set).
 */

function toBoardNode(n: GraphNode): BoardNode {
  return { ref_id: n.ref_id, node_type: n.node_type, properties: n.properties ?? {} }
}

function edgeKey(e: GraphEdge): string {
  return e.ref_id ?? `${e.source}|${e.edge_type}|${e.target}`
}

function toBoardEdge(e: GraphEdge): BoardEdge {
  return {
    ref_id: edgeKey(e),
    edge_type: e.edge_type,
    source: e.source,
    target: e.target,
    properties: (e.properties ?? {}) as BoardEdge["properties"],
  }
}

export async function fetchEpisodeBoardData(
  episodeRefId: string,
  signal?: AbortSignal
): Promise<{ nodes: BoardNode[]; edges: BoardEdge[] }> {
  const nodes = new Map<string, BoardNode>()
  const edges = new Map<string, BoardEdge>()
  const merge = (g: { nodes: GraphNode[]; edges: GraphEdge[] }) => {
    for (const n of g.nodes) nodes.set(n.ref_id, toBoardNode(n))
    for (const e of g.edges) edges.set(edgeKey(e), toBoardEdge(e))
  }

  const firstHop = await getNode(episodeRefId, "edges", signal)
  merge(firstHop)

  // Second hop: each chapter's neighbourhood carries its claims (SOURCE),
  // chapter-level entity MENTIONS, and claim relations. A failed chapter hop
  // is non-fatal — the board just shows that chapter without claims.
  const chapterIds = [...nodes.values()]
    .filter((n) => n.node_type === "Chapter")
    .map((n) => n.ref_id)
  const hops = await Promise.allSettled(chapterIds.map((id) => getNode(id, "edges", signal)))
  for (const h of hops) {
    if (h.status === "fulfilled") merge(h.value)
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}
