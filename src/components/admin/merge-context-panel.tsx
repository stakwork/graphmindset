"use client"

import { useEffect, useState, type ReactNode } from "react"
import { getSubgraph } from "@/lib/graph-api"
import type { Review } from "@/lib/graph-api"
import { deriveMentions, nameStems } from "@/lib/merge-context"
import type { MentionExcerpt } from "@/lib/merge-context"

const SUBGRAPH_LIMIT = 50
// Merge reviews carry candidate + canonical; legacy multi-candidate reviews
// are capped so a pathological row can't fan out requests.
const MAX_SUBJECTS = 4

function subjectName(review: Review, refId: string): string | null {
  const subject = review.subject_nodes.find((sn) => sn.ref_id === refId)
  const props = subject?.properties
  for (const key of ["name", "title", "episode_title"]) {
    const value = props?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

/**
 * Card order mirrors the Sources → Canonical layout above the panel: the
 * merge sources come first, the canonical (to) node last. subject_ids order
 * is not reliable for this — it's fingerprint-sorted.
 */
function orderedSubjectIds(review: Review): string[] {
  const payload = review.action_payload as { from?: unknown; to?: unknown } | null
  const from = Array.isArray(payload?.from)
    ? payload.from.filter((id): id is string => typeof id === "string" && id !== "")
    : []
  const to = typeof payload?.to === "string" ? payload.to : null
  if (to) {
    const sources = Array.from(new Set(from)).filter((id) => id !== to)
    return [...sources, to].slice(0, MAX_SUBJECTS)
  }
  return review.subject_ids.slice(0, MAX_SUBJECTS)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * The excerpt with the words matching the subject's name marked. Matching is
 * stem-based (same stems the excerpt was windowed around), so inflected
 * forms light up too — "extract" for a subject named "…extraction".
 */
function HighlightedExcerpt({ text, term }: { text: string; term: string | null }) {
  const stems = nameStems(term)
  if (stems.length === 0) return <>{text}</>
  const pattern = new RegExp(
    `\\b(${stems.map(escapeRegExp).join("|")})[\\w]*`,
    "gi"
  )
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of text.matchAll(pattern)) {
    const idx = match.index ?? 0
    if (idx > last) out.push(text.slice(last, idx))
    out.push(
      <mark key={key++} className="rounded-sm bg-primary/25 px-0.5 text-inherit">
        {match[0]}
      </mark>
    )
    last = idx + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

interface SubjectMentions {
  refId: string
  name: string | null
  mentions: MentionExcerpt[]
}

/**
 * The sentences each merge subject was extracted from, shown under the
 * expanded row. Extracted entities carry no provenance properties — their
 * incoming MENTIONS edges are the only trail back to the source text.
 * Fetched lazily on expand; sources first, canonical last, matching the
 * columns above.
 */
export function MergeContextPanel({ review }: { review: Review }) {
  const [subjects, setSubjects] = useState<SubjectMentions[] | null>(null)
  const [failed, setFailed] = useState(false)

  const subjectsKey = orderedSubjectIds(review).join(",")

  useEffect(() => {
    const subjectIds = subjectsKey ? subjectsKey.split(",") : []
    if (subjectIds.length === 0) return
    let cancelled = false
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const graphs = await Promise.all(
          subjectIds.map((id) =>
            getSubgraph(
              {
                start_node: id,
                depth: 1,
                limit: SUBGRAPH_LIMIT,
                edge_type: ["MENTIONS"],
              },
              ctrl.signal
            )
          )
        )
        if (cancelled) return
        setSubjects(
          subjectIds.map((id, i) => {
            const name = subjectName(review, id)
            return {
              refId: id,
              name,
              mentions: deriveMentions(id, graphs[i] ?? { nodes: [], edges: [] }, name),
            }
          })
        )
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      ctrl.abort()
    }
    // review identity is stable for a row; subjectsKey captures what we fetch on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectsKey])

  if (failed) {
    return (
      <p className="mt-3 border-t border-border/30 pt-2 text-[10px] text-muted-foreground">
        Source sentences unavailable
      </p>
    )
  }

  return (
    <div className="mt-3 border-t border-border/30 pt-2" data-testid="merge-context">
      <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Source Sentences
      </div>

      {subjects === null ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-muted/20" />
          ))}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {subjects.map((subject) => (
            <div
              key={subject.refId}
              className="rounded-md border border-border/40 bg-background/40 p-2"
              data-testid={`merge-context-subject-${subject.refId}`}
            >
              <div className="mb-1 truncate text-[11px] font-medium">
                {subject.name ?? subject.refId.slice(0, 8)}
              </div>
              {subject.mentions.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {subject.mentions.map((mention) => (
                    <li
                      key={mention.refId}
                      className={
                        mention.matched
                          ? "text-[10px] leading-relaxed text-foreground/70"
                          : "text-[10px] leading-relaxed text-muted-foreground/60"
                      }
                      title={
                        mention.matched
                          ? undefined
                          : "The node's name does not appear in this source's text — showing its beginning"
                      }
                    >
                      <span className="mr-1 rounded border border-border/50 bg-muted/30 px-1 py-px font-mono text-[8px] uppercase text-muted-foreground">
                        {mention.nodeType ?? "?"}
                      </span>
                      “<HighlightedExcerpt text={mention.excerpt} term={subject.name} />”
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[10px] italic text-muted-foreground">
                  No source text found
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
