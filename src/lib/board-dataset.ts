/**
 * The episode board's active dataset: a module-level graph slice (nodes +
 * edges) plus derived accessors (chapters, claims, mentions, relations).
 *
 * The dataset starts empty; `setBoardData` points the board at a graph slice
 * (a live episode pull via `fetchEpisodeBoardData`, or a test fixture). Only
 * one board is mounted at a time, so a module-level swap is safe — the
 * explorer bumps a data version to re-render after swapping.
 */

export interface BoardNode {
  ref_id: string
  node_type: string
  properties: Record<string, unknown>
}

export interface BoardEdge {
  ref_id: string
  edge_type: string
  source: string
  target: string
  weight?: number
  properties: {
    index?: number
    timestamp_start?: string
    timestamp_end?: string
    [key: string]: unknown
  }
}

export let boardNodes: BoardNode[] = []
export let boardEdges: BoardEdge[] = []
export let nodeById = new Map(boardNodes.map((n) => [n.ref_id, n]))

/** Point the board at a new graph slice (e.g. a live episode pull).
 *  `anchorEpisodeId` picks which Episode card is the center when the slice
 *  contains more than one. */
export function setBoardData(
  nodes: BoardNode[],
  edges: BoardEdge[],
  anchorEpisodeId?: string
) {
  boardNodes = nodes
  boardEdges = edges
  nodeById = new Map(nodes.map((n) => [n.ref_id, n]))
  const anchor = anchorEpisodeId ? nodeById.get(anchorEpisodeId) : undefined
  episodeNode =
    (anchor?.node_type === "Episode" ? anchor : undefined) ??
    nodes.find((n) => n.node_type === "Episode")
  showNode = nodes.find((n) => n.node_type === "Show")
}

/** Clear the dataset (board unmounted / episode closed). */
export function resetBoardData() {
  setBoardData([], [])
}

// ─── Labels ─────────────────────────────────────────────────────────────────

const LABEL_KEYS = ["episode_title", "name", "show_title", "title"]

export function nodeLabel(node: BoardNode): string {
  for (const key of LABEL_KEYS) {
    const v = node.properties?.[key]
    if (typeof v === "string" && v.length > 0) return v
  }
  return node.ref_id
}

export function truncateLabel(label: string, max = 34): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

// ─── Type colors ────────────────────────────────────────────────────────────
// Vibrant accents per node type — same role as ICON_ACCENT_MAP in
// schema-icons.ts (schema primary colors are too dark for small UI elements).

export const TYPE_COLORS: Record<string, string> = {
  Episode: "#4cc9f0",
  Show: "#7209b7",
  Chapter: "#3a86ff",
  Clip: "#fb8500",
  Person: "#ff006e",
  Topic: "#8ecae6",
  Organization: "#8338ec",
  Product: "#06d6a0",
  Location: "#ef476f",
  Claim: "#ffd166",
}

export function typeColor(nodeType: string): string {
  return TYPE_COLORS[nodeType] ?? "#9aa5b1"
}

// ─── Timestamps ─────────────────────────────────────────────────────────────

/** Chapter timestamps are ms-as-string ("13417"); clips use "m:ss" ("4:48"). */
export function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null
  if (value.includes(":")) {
    const parts = value.split(":").map((p) => Number(p))
    if (parts.some((p) => Number.isNaN(p))) return null
    const secs = parts.reduce((acc, p) => acc * 60 + p, 0)
    return secs * 1000
  }
  const ms = Number(value)
  return Number.isNaN(ms) ? null : ms
}

export function formatMs(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

// ─── Graph slices ───────────────────────────────────────────────────────────

export let episodeNode = boardNodes.find((n) => n.node_type === "Episode")
export let showNode = boardNodes.find((n) => n.node_type === "Show")

export interface ChapterInfo {
  node: BoardNode
  edge: BoardEdge
  index: number
  startMs: number
  endMs: number
}

/** Chapters of the episode with time ranges. Live HAS edges sometimes carry
 *  missing/duplicate indexes, so order by start time (index as tie-break) and
 *  renumber by sorted position — the displayed index is the ordinal. */
export function getChapters(): ChapterInfo[] {
  if (!episodeNode) return []
  const out: ChapterInfo[] = []
  for (const e of boardEdges) {
    if (e.source !== episodeNode.ref_id || e.edge_type !== "HAS") continue
    const node = nodeById.get(e.target)
    if (!node || node.node_type !== "Chapter") continue
    out.push({
      node,
      edge: e,
      index: e.properties.index ?? 0,
      startMs:
        parseTimestampMs(e.properties.timestamp_start) ??
        parseTimestampMs(node.properties.timestamp_start) ??
        0,
      endMs:
        parseTimestampMs(e.properties.timestamp_end) ??
        parseTimestampMs(node.properties.timestamp_end) ??
        parseTimestampMs(node.properties.timestamp) ??
        0,
    })
  }
  out.sort((a, b) => a.startMs - b.startMs || a.index - b.index)
  return out.map((c, i) => ({ ...c, index: i }))
}

export function getClips(): BoardNode[] {
  return boardNodes.filter((n) => n.node_type === "Clip")
}

export const ENTITY_TYPES = ["Person", "Topic", "Organization", "Product", "Location"]

/** Non-episode content nodes grouped by type (People / Topics / Orgs / ...). */
export function getEntitiesByType(): Map<string, BoardNode[]> {
  const map = new Map<string, BoardNode[]>()
  for (const t of ENTITY_TYPES) map.set(t, [])
  for (const n of boardNodes) {
    const bucket = map.get(n.node_type)
    if (bucket) bucket.push(n)
  }
  return map
}

export function getHost(): BoardNode | undefined {
  const hostEdge = boardEdges.find((e) => e.edge_type === "IS_HOST")
  return hostEdge ? nodeById.get(hostEdge.source) : undefined
}

/** Claims sourced from a chapter (Claim -SOURCE-> Chapter), per chapter ref_id. */
export function getClaimsByChapter(): Map<string, BoardNode[]> {
  const map = new Map<string, BoardNode[]>()
  for (const e of boardEdges) {
    if (e.edge_type !== "SOURCE") continue
    const claim = nodeById.get(e.source)
    if (!claim || claim.node_type !== "Claim") continue
    const list = map.get(e.target)
    if (list) list.push(claim)
    else map.set(e.target, [claim])
  }
  return map
}

/** Claim-to-claim and claim authorship relations pulled from the DB. */
export function getClaimRelations(): {
  supports: BoardEdge[]
  contradicts: BoardEdge[]
  madeBy: BoardEdge[]
} {
  const supports: BoardEdge[] = []
  const contradicts: BoardEdge[] = []
  const madeBy: BoardEdge[] = []
  for (const e of boardEdges) {
    if (e.edge_type === "SUPPORTS") supports.push(e)
    else if (e.edge_type === "CONTRADICTS") contradicts.push(e)
    else if (e.edge_type === "MADE_CLAIM") madeBy.push(e)
  }
  return { supports, contradicts, madeBy }
}

/** Chapter→Entity MENTIONS edges (chapters reference people/topics/etc). */
export function getChapterMentions(): BoardEdge[] {
  return boardEdges.filter(
    (e) => e.edge_type === "MENTIONS" && nodeById.get(e.source)?.node_type === "Chapter"
  )
}

/** ref_ids directly connected to the given node (either direction). */
export function neighborIds(refId: string): Set<string> {
  const out = new Set<string>()
  for (const e of boardEdges) {
    if (e.source === refId) out.add(e.target)
    if (e.target === refId) out.add(e.source)
  }
  return out
}

/** All type names present in the data with their node counts, for the legend. */
export function getTypeCounts(): [string, number][] {
  const counts = new Map<string, number>()
  for (const n of boardNodes) counts.set(n.node_type, (counts.get(n.node_type) ?? 0) + 1)
  return [...counts.entries()]
}
