import { getNode, isGraphData, type GraphNode } from "@/lib/graph-api"
import { useGraphStore } from "@/stores/graph-store"
import { usePlayerStore } from "@/stores/player-store"

/**
 * Shared unlock helper used by both AddContentModal (cache-hit branch) and
 * NodePreviewPanel's unlock button.
 *
 * - Fetches GET /v2/nodes/:ref_id?expand=edges (L402 auto-attached via api.get)
 * - Merges returned nodes/edges into graph store without clobbering an active search
 * - Selects the unlocked node so SearchResultsPanel renders NodePreviewPanel
 * - Starts media playback if the node has a media_url or link property
 * - Returns the unlocked GraphNode so callers can update local state (e.g. fullNode)
 * - Throws on failure so callers handle 402 / budget modal as usual
 */
export async function unlockNode(refId: string): Promise<GraphNode | null> {
  try {
    const result = await getNode(refId, "edges")

    if (!isGraphData(result)) {
      console.warn("[unlock] failed", { refId, err: "unexpected response shape" })
      throw new Error("Unexpected response shape from unlock")
    }

    const { nodes, edges } = result
    const unlockedNode = nodes[0] ?? null

    console.info("[unlock] fetched", { refId, nodes: nodes.length, edges: edges.length })

    const graphStore = useGraphStore.getState()
    graphStore.addNodes(nodes, edges)

    if (unlockedNode) {
      graphStore.setSelectedNode(unlockedNode)

      const props = unlockedNode.properties as Record<string, unknown> | undefined
      if (props?.media_url || props?.link) {
        usePlayerStore.getState().setPlayingNode(unlockedNode)
      }
    }

    return unlockedNode
  } catch (err) {
    console.warn("[unlock] failed", { refId, err })
    throw err
  }
}
