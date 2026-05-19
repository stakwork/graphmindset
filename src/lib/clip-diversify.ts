import type { GraphNode, GraphEdge } from "@/lib/graph-api"

export interface DiversifyOptions {
  maxPerSource: number // hard cap per parent (default 1)
  finalLimit: number // total clips to return (default 4)
}

/**
 * Returns a diversified subset of clips, ensuring at most `maxPerSource` clips
 * per parent episode. Falls back to relax-fill when distinct sources are scarce.
 *
 * Parent resolution order:
 * 1. HAS edge in `edges` whose target === clip.ref_id → source (episode ref_id)
 * 2. clip.properties.episode_title (string)
 * 3. clip.properties.show + ":" + clip.properties.episode_number (if non-empty)
 * 4. clip.ref_id itself (unique bucket — never collapses with others)
 */
export function diversifyClipsByParent(
  clips: GraphNode[],
  edges: GraphEdge[],
  opts: DiversifyOptions
): GraphNode[] {
  const { maxPerSource, finalLimit } = opts

  function parentKey(clip: GraphNode): string {
    // 1. Edge-based: find a HAS edge targeting this clip
    const hasEdge = edges.find((e) => e.edge_type === "HAS" && e.target === clip.ref_id)
    if (hasEdge) return hasEdge.source

    // 2. episode_title fallback
    const p = clip.properties ?? {}
    if (typeof p.episode_title === "string" && p.episode_title) return p.episode_title

    // 3. show + episode_number combo
    const show = p.show ?? ""
    const episodeNum = p.episode_number ?? ""
    const combo = `${show}:${episodeNum}`
    if (combo !== ":") return combo

    // 4. Last resort: unique per clip
    return clip.ref_id
  }

  const counts = new Map<string, number>()
  const pass1: GraphNode[] = []
  const skipped: GraphNode[] = []

  // Pass 1 (strict): honour maxPerSource cap, collect up to finalLimit
  for (const clip of clips) {
    if (pass1.length >= finalLimit) break
    const key = parentKey(clip)
    const count = counts.get(key) ?? 0
    if (count < maxPerSource) {
      pass1.push(clip)
      counts.set(key, count + 1)
    } else {
      skipped.push(clip)
    }
  }

  if (pass1.length >= finalLimit) return pass1

  // Pass 2 (relax-fill): add remaining clips in recency order until finalLimit
  const result = [...pass1]
  for (const clip of skipped) {
    if (result.length >= finalLimit) break
    result.push(clip)
  }

  return result
}
