import type { SubgraphNode, SubgraphResponse } from "@/lib/graph-api"

/**
 * Derives the source sentences a merge-review subject was extracted from,
 * out of its 1-hop MENTIONS subgraph (GET /v2/graph/subgraph). Only the
 * fragment around the subject's name is shown — a few words either side —
 * not the whole property value.
 *
 * The name is matched word-by-word with crude prefix stemming, because the
 * entity name is normalised by extraction and rarely appears verbatim
 * ("Document search and extraction" ↔ "…search and extract document data…").
 *
 * Pure functions — the fetching lives in MergeContextPanel.
 */

export interface MentionExcerpt {
  refId: string
  nodeType: string | null
  excerpt: string
  // False when the subject's name never occurs in the source text — the
  // excerpt is then just the head of the text, shown as context-only.
  matched: boolean
}

// Window around the matched name: enough context either side to read the
// claim being made, not just the phrase.
const WORDS_BEFORE = 6
const WORDS_AFTER = 10
// Fallback head length (words) when the name doesn't occur in the text.
const FALLBACK_WORDS = 20
const MENTIONS_MAX = 4

/**
 * Only properties that hold actual prose count as a source sentence — a
 * Chapter/Episode *name* is a topic label, not the sentence the entity was
 * extracted from. Verbatim sources first: a tweet's `text` and an episode's
 * `transcript` (newer episodes store the full speaker-attributed transcript;
 * older ones don't), then a chapter/clip's `description` (a real sentence
 * naming the entities of that segment), then an episode's `summary`.
 * Order doubles as ranking.
 */
const TEXT_KEYS = ["text", "transcript", "description", "summary"] as const

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "over",
  "a", "an", "of", "to", "in", "on", "is", "are", "was", "were", "its",
])

function normaliseText(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  let text = raw.trim()
  // Tweet texts are stored with literal wrapper quotes and literal escape
  // sequences (backslash-n, backslash-uXXXX) — decode them for display.
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1)
  }
  text = text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\[nrt]/g, " ")
  text = text.split(/\s+/).join(" ").trim()
  return text || null
}

function normaliseWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9@#]/g, "")
}

/**
 * Crude prefix stem: enough of the token that inflections still match
 * ("extraction" → "extrac" matches "extract"/"extracting"), never shorter
 * than 4 chars so tiny words stay exact.
 */
function stem(token: string): string {
  if (token.length <= 4) return token
  return token.slice(0, Math.max(4, token.length - 4))
}

/** Significant, stemmed words of the subject's name — also drives highlighting. */
export function nameStems(name: string | null | undefined): string[] {
  if (!name) return []
  const stems: string[] = []
  for (const word of name.split(/\s+/)) {
    const cleaned = normaliseWord(word)
    if (cleaned.length >= 3 && !STOPWORDS.has(cleaned)) {
      const s = stem(cleaned)
      if (!stems.includes(s)) stems.push(s)
    }
  }
  return stems
}

function wordMatchesAnyStem(word: string, stems: string[]): boolean {
  const cleaned = normaliseWord(word)
  if (!cleaned) return false
  return stems.some((s) => cleaned.startsWith(s))
}

/**
 * The displayable fragment: the words around the first stretch of the text
 * that matches the name (longest run of consecutive name-words wins, so a
 * full-phrase occurrence beats a stray single word). Falls back to the head
 * of the text when the name never occurs — flagged via `matched: false`.
 */
export function buildExcerpt(
  raw: unknown,
  name: string | null
): { excerpt: string; matched: boolean } | null {
  const text = normaliseText(raw)
  if (!text) return null
  const words = text.split(" ")
  const stems = nameStems(name)

  let matchStart = -1
  let matchLen = 0
  if (stems.length > 0) {
    for (let i = 0; i < words.length; i++) {
      if (!wordMatchesAnyStem(words[i], stems)) continue
      let len = 1
      while (
        i + len < words.length &&
        wordMatchesAnyStem(words[i + len], stems)
      ) {
        len++
      }
      if (len > matchLen) {
        matchStart = i
        matchLen = len
      }
      i += len
    }
  }

  let start: number
  let end: number
  if (matchStart >= 0) {
    start = Math.max(0, matchStart - WORDS_BEFORE)
    end = Math.min(words.length, matchStart + matchLen + WORDS_AFTER)
  } else {
    start = 0
    end = Math.min(words.length, FALLBACK_WORDS)
  }

  const prefix = start > 0 ? "… " : ""
  const suffix = end < words.length ? " …" : ""
  return {
    excerpt: prefix + words.slice(start, end).join(" ") + suffix,
    matched: matchStart >= 0,
  }
}

export function excerptFor(raw: unknown, name: string | null): string | null {
  return buildExcerpt(raw, name)?.excerpt ?? null
}

export function deriveMentions(
  refId: string,
  subgraph: SubgraphResponse,
  name?: string | null
): MentionExcerpt[] {
  const nodeById = new Map(subgraph.nodes.map((n) => [n.ref_id, n]))
  const sources: SubgraphNode[] = []
  const seen = new Set<string>()

  for (const edge of subgraph.edges) {
    if (edge.edge_type !== "MENTIONS" || edge.target !== refId) continue
    const sourceId = edge.source
    if (!sourceId || sourceId === refId || seen.has(sourceId)) continue
    seen.add(sourceId)
    const source = nodeById.get(sourceId)
    if (source) sources.push(source)
  }

  // Ranking: sources whose text actually contains the name beat ones where
  // it never occurs (head-of-text fallbacks), then a `text` property beats a
  // `summary` one — so the sentence showing the name is never crowded out.
  const candidates: Array<MentionExcerpt & { rank: number }> = []
  for (const source of sources) {
    const props = source.properties
    if (!props) continue
    for (let rank = 0; rank < TEXT_KEYS.length; rank++) {
      const built = buildExcerpt(props[TEXT_KEYS[rank]], name ?? null)
      if (built) {
        candidates.push({
          refId: source.ref_id,
          nodeType: source.node_type,
          excerpt: built.excerpt,
          matched: built.matched,
          rank,
        })
        break
      }
    }
  }
  return candidates
    .sort((a, b) =>
      a.matched !== b.matched ? (a.matched ? -1 : 1) : a.rank - b.rank
    )
    .slice(0, MENTIONS_MAX)
    .map(({ refId: rid, nodeType, excerpt, matched }) => ({
      refId: rid,
      nodeType,
      excerpt,
      matched,
    }))
}
