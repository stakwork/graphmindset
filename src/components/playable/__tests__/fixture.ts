import rawData from "../../../../private/playable-data"
import claimsData from "../../../../private/playable-claims.json"
import crossEdgesData from "../../../../private/playable-cross-edges.json"
import { setBoardData, type BoardEdge, type BoardNode } from "@/lib/board-dataset"

/**
 * Board test fixture: one real episode's graph slice, assembled from DB pulls
 * kept under `private/`:
 * - `playable-data.ts` — base export (episode, chapters, clips, entities)
 * - `playable-claims.json` — Claim nodes + SOURCE/SUPPORTS/CONTRADICTS/
 *   MADE_CLAIM edges
 * - `playable-cross-edges.json` — Chapter→Entity MENTIONS edges
 */
export function loadFixture() {
  const data = rawData as { nodes: BoardNode[]; edges: BoardEdge[] }
  const claims = claimsData as { nodes: BoardNode[]; edges: BoardEdge[] }
  const cross = crossEdgesData as unknown as { edges: BoardEdge[] }
  setBoardData(
    [...data.nodes, ...claims.nodes],
    [...data.edges, ...claims.edges, ...cross.edges]
  )
}
