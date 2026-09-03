"use client"

import { useEffect, useState } from "react"
import { getSubgraph } from "@/lib/graph-api"
import type { Review } from "@/lib/graph-api"
import { deriveMergeContext } from "@/lib/merge-context"
import type { MergeGraphContext, SubjectGraphContext } from "@/lib/merge-context"

// Wide enough that the neighbor-overlap intersection is meaningful even for
// well-connected entities; the payload is one hop only.
const SUBGRAPH_LIMIT = 100
// Merge reviews carry candidate + canonical; legacy multi-candidate reviews
// are capped so a pathological row can't fan out requests.
const MAX_SUBJECTS = 4
const EDGE_TYPES_SHOWN = 3

function subjectName(review: Review, refId: string): string {
  const subject = review.subject_nodes.find((sn) => sn.ref_id === refId)
  const props = subject?.properties
  for (const key of ["name", "title", "episode_title"]) {
    const value = props?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return refId.slice(0, 8)
}

function edgeCountsLine(subject: SubjectGraphContext): string {
  const parts = Object.entries(subject.edgeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, EDGE_TYPES_SHOWN)
    .map(([type, count]) => `${type} ${count}`)
  const connections = `${subject.degree} connection${subject.degree === 1 ? "" : "s"}`
  return parts.length > 0 ? `${connections} · ${parts.join(" · ")}` : connections
}

/**
 * Graph evidence under an expanded merge review: per subject its degree and
 * the sentences it was extracted from (via /v2/graph/subgraph), plus the
 * neighbor overlap between the subjects — shared neighbors argue for the
 * merge, disjoint neighborhoods against it.
 */
export function MergeContextPanel({ review }: { review: Review }) {
  const [context, setContext] = useState<MergeGraphContext | null>(null)
  const [failed, setFailed] = useState(false)

  const subjectsKey = review.subject_ids.slice(0, MAX_SUBJECTS).join(",")

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
              { start_node: id, depth: 1, limit: SUBGRAPH_LIMIT },
              ctrl.signal
            )
          )
        )
        if (cancelled) return
        setContext(deriveMergeContext(subjectIds, graphs))
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [subjectsKey])

  if (failed) {
    return (
      <p className="mt-3 border-t border-border/30 pt-2 text-[10px] text-muted-foreground">
        Graph context unavailable
      </p>
    )
  }

  return (
    <div className="mt-3 border-t border-border/30 pt-2" data-testid="merge-context">
      <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Graph Context
      </div>

      {context === null ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-muted/20" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {context.subjects.map((subject) => (
              <div
                key={subject.refId}
                className="rounded-md border border-border/40 bg-background/40 p-2"
                data-testid={`merge-context-subject-${subject.refId}`}
              >
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11px] font-medium">
                    {subjectName(review, subject.refId)}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {edgeCountsLine(subject)}
                  </span>
                </div>
                {subject.mentions.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {subject.mentions.map((mention) => (
                      <li
                        key={mention.refId}
                        className="text-[10px] leading-relaxed text-foreground/70"
                      >
                        <span className="mr-1 rounded border border-border/50 bg-muted/30 px-1 py-px font-mono text-[8px] uppercase text-muted-foreground">
                          {mention.nodeType ?? "?"}
                        </span>
                        “{mention.excerpt}”
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[10px] italic text-muted-foreground">
                    No source text found in the immediate neighborhood
                  </p>
                )}
              </div>
            ))}
          </div>

          {context.subjects.length > 1 && (
            <p
              className={
                context.sharedCount > 0
                  ? "mt-1.5 text-[10px] text-emerald-400"
                  : "mt-1.5 text-[10px] text-amber-400"
              }
              data-testid="merge-context-overlap"
            >
              {context.sharedCount > 0 ? (
                <>
                  {context.sharedCount} shared connection
                  {context.sharedCount === 1 ? "" : "s"}
                  {context.sharedExamples.length > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      — {context.sharedExamples.map((n) => n.name).join(", ")}
                    </span>
                  )}
                </>
              ) : (
                "No shared connections — the neighborhoods are disjoint"
              )}
            </p>
          )}
        </>
      )}
    </div>
  )
}
