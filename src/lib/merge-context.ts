import type { SubgraphNode, SubgraphResponse } from "@/lib/graph-api"

/**
 * Derives comparison context for merge-review subjects from their 1-hop
 * subgraphs (GET /v2/graph/subgraph): how connected each node is, the
 * sentences it was extracted from (incoming MENTIONS from text-bearing
 * nodes), and how much the subjects' neighborhoods overlap — shared
 * neighbors are the strongest same-entity signal; disjoint neighborhoods
 * are a red flag for a proposed merge.
 *
 * Pure functions — the fetching lives in MergeContextPanel.
 */

export interface MentionExcerpt {
  refId: string
  nodeType: string | null
  excerpt: string
}

export interface SubjectGraphContext {
  refId: string
  degree: number
  edgeCounts: Record<string, number>
  neighborIds: string[]
  mentions: MentionExcerpt[]
}

export interface SharedNeighbor {
  refId: string
  name: string
  nodeType: string | null
}

export interface MergeGraphContext {
  subjects: SubjectGraphContext[]
  sharedCount: number
  sharedExamples: SharedNeighbor[]
}

const EXCERPT_MAX = 220
const MENTIONS_MAX = 3
const SHARED_EXAMPLES_MAX = 4

/** Keys tried, in order, for a mention source's displayable text. */
const TEXT_KEYS = ["text", "name", "episode_title", "title", "summary"] as const

/**
 * Normalise source text for display: strip the literal wrapper quotes tweet
 * texts are stored with, collapse whitespace, truncate on a word boundary.
 */
export function cleanExcerpt(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  let text = raw.trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1)
  }
  text = text.split(/\s+/).join(" ").trim()
  if (!text) return null
  if (text.length > EXCERPT_MAX) {
    text = text.slice(0, EXCERPT_MAX).replace(/\s+\S*$/, "") + "…"
  }
  return text
}

function nodeExcerpt(node: SubgraphNode | undefined): string | null {
  const props = node?.properties
  if (!props) return null
  for (const key of TEXT_KEYS) {
    const cleaned = cleanExcerpt(props[key])
    if (cleaned) return cleaned
  }
  return null
}

function nodeDisplayName(node: SubgraphNode | undefined, refId: string): string {
  const props = node?.properties
  for (const key of ["name", "title", "episode_title"]) {
    const value = props?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return refId.slice(0, 8)
}

export function deriveSubjectContext(
  refId: string,
  subgraph: SubgraphResponse
): SubjectGraphContext {
  const nodeById = new Map(subgraph.nodes.map((n) => [n.ref_id, n]))
  const neighborIds = new Set<string>()
  const edgeCounts: Record<string, number> = {}
  const mentionSources: SubgraphNode[] = []
  const seenMentionSources = new Set<string>()

  for (const edge of subgraph.edges) {
    const isSource = edge.source === refId
    const isTarget = edge.target === refId
    // apoc.subgraphAll also returns edges among the neighbors themselves —
    // only edges incident to the subject describe the subject.
    if (!isSource && !isTarget) continue
    const otherId = isSource ? edge.target : edge.source
    if (!otherId || otherId === refId) continue
    neighborIds.add(otherId)
    edgeCounts[edge.edge_type] = (edgeCounts[edge.edge_type] ?? 0) + 1
    if (edge.edge_type === "MENTIONS" && isTarget && !seenMentionSources.has(otherId)) {
      seenMentionSources.add(otherId)
      const source = nodeById.get(otherId)
      if (source) mentionSources.push(source)
    }
  }

  const mentions: MentionExcerpt[] = []
  for (const source of mentionSources) {
    if (mentions.length >= MENTIONS_MAX) break
    const excerpt = nodeExcerpt(source)
    if (excerpt) {
      mentions.push({ refId: source.ref_id, nodeType: source.node_type, excerpt })
    }
  }

  return {
    refId,
    degree: neighborIds.size,
    edgeCounts,
    neighborIds: Array.from(neighborIds),
    mentions,
  }
}

export function deriveMergeContext(
  subjectIds: string[],
  subgraphs: SubgraphResponse[]
): MergeGraphContext {
  const subjects = subjectIds.map((id, i) =>
    deriveSubjectContext(id, subgraphs[i] ?? { nodes: [], edges: [] })
  )

  // Shared = neighbors present on EVERY subject; the subjects themselves are
  // excluded (candidate and canonical are often each other's IS_ALIAS
  // neighbor, which says nothing about a third common connection).
  let shared: Set<string> | null = null
  for (const subject of subjects) {
    const ids = new Set(subject.neighborIds)
    if (shared === null) {
      shared = ids
    } else {
      const previous: Set<string> = shared
      shared = new Set(Array.from(previous).filter((id) => ids.has(id)))
    }
  }
  const sharedIds = Array.from(shared ?? new Set<string>()).filter(
    (id) => !subjectIds.includes(id)
  )

  const nodeById = new Map<string, SubgraphNode>()
  for (const graph of subgraphs) {
    for (const node of graph?.nodes ?? []) nodeById.set(node.ref_id, node)
  }
  const sharedExamples = sharedIds
    .map((id) => {
      const node = nodeById.get(id)
      return {
        refId: id,
        name: nodeDisplayName(node, id),
        nodeType: node?.node_type ?? null,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, SHARED_EXAMPLES_MAX)

  return { subjects, sharedCount: sharedIds.length, sharedExamples }
}
