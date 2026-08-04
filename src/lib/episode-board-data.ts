import { getNode, type GraphEdge, type GraphNode } from "./graph-api"
import type { PlayableEdge, PlayableNode } from "./playable-mock"

/**
 * Pulls everything the episode board needs from the live backend:
 * the episode's 1-hop neighbourhood (chapters, clips, show, entities) plus
 * one extra hop per chapter (claims, chapter-level mentions, and whatever
 * claim↔claim / authorship edges sit inside that neighbourhood set).
 */

function toPlayableNode(n: GraphNode): PlayableNode {
  return { ref_id: n.ref_id, node_type: n.node_type, properties: n.properties ?? {} }
}

function edgeKey(e: GraphEdge): string {
  return e.ref_id ?? `${e.source}|${e.edge_type}|${e.target}`
}

function toPlayableEdge(e: GraphEdge): PlayableEdge {
  return {
    ref_id: edgeKey(e),
    edge_type: e.edge_type,
    source: e.source,
    target: e.target,
    properties: (e.properties ?? {}) as PlayableEdge["properties"],
  }
}

export async function fetchEpisodeBoardData(
  episodeRefId: string,
  signal?: AbortSignal
): Promise<{ nodes: PlayableNode[]; edges: PlayableEdge[] }> {
  const nodes = new Map<string, PlayableNode>()
  const edges = new Map<string, PlayableEdge>()
  const merge = (g: { nodes: GraphNode[]; edges: GraphEdge[] }) => {
    for (const n of g.nodes) nodes.set(n.ref_id, toPlayableNode(n))
    for (const e of g.edges) edges.set(edgeKey(e), toPlayableEdge(e))
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
