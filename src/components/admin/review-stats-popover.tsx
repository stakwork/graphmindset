"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { BarChart3 } from "lucide-react"
import { getReviewStats } from "@/lib/graph-api"
import type { DeciderCategory, ReviewStatsResponse } from "@/lib/graph-api"
import { AnchoredPopover } from "@/components/ui/anchored-popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const WINDOW_DAYS = 7

const DECIDER_LABELS: Record<DeciderCategory, string> = {
  admin: "Admin",
  workflow: "Workflow",
  system: "System",
  other: "Other",
}

const DECIDER_ORDER: DeciderCategory[] = ["admin", "workflow", "system", "other"]

function weekdayLabel(isoDay: string, index: number, count: number) {
  const d = new Date(`${isoDay}T00:00:00`)
  if (index === count - 1) return "Today"
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })
}

/**
 * Trigger button + anchored panel showing the last week of review decisions:
 * per-day stacked bars (approved/dismissed/failed) and a reviewer breakdown.
 * Follows the page's action filter so the numbers match the list being viewed.
 */
export function ReviewStatsPopover({ actionName }: { actionName?: string }) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [stats, setStats] = useState<ReviewStatsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await getReviewStats({
        days: WINDOW_DAYS,
        action_name: actionName || undefined,
      })
      setStats(res)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [actionName])

  // Fetch on every open so the numbers reflect decisions made since the last
  // look; stale data stays visible while the refresh is in flight.
  useEffect(() => {
    if (open) fetchStats()
  }, [open, fetchStats])

  const maxDayTotal = stats
    ? Math.max(1, ...stats.days.map((d) => d.total))
    : 1

  return (
    <div ref={anchorRef} className="flex">
      <Button
        size="sm"
        variant="outline"
        data-testid="review-stats-btn"
        onClick={() => setOpen((v) => !v)}
        title="Decision analytics — last 7 days"
        className={cn(
          "h-7 w-7 p-0",
          open && "border-primary/70 bg-primary/10 text-primary"
        )}
      >
        <BarChart3 className="h-3.5 w-3.5" />
      </Button>

      <AnchoredPopover
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        matchWidth={false}
        align="end"
        maxHeight={420}
        className="w-[300px] rounded-lg border border-border bg-popover p-3 shadow-lg"
      >
        <div className="overflow-y-auto" data-testid="review-stats-panel">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-xs font-semibold">
              Decisions — last {WINDOW_DAYS} days
            </span>
            {actionName && (
              <span className="text-[10px] text-muted-foreground">{actionName}</span>
            )}
          </div>

          {error ? (
            <p className="py-4 text-center text-[11px] text-red-400">
              Failed to load analytics
            </p>
          ) : !stats && loading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-muted/30" />
              ))}
            </div>
          ) : stats ? (
            <div className={cn(loading && "opacity-60")}>
              {/* Totals */}
              <p className="mb-2 text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {stats.totals.total}
                </span>{" "}
                decided ·{" "}
                <span className="text-emerald-400">{stats.totals.approved} approved</span> ·{" "}
                <span className="text-rose-400">{stats.totals.dismissed} dismissed</span>
                {stats.totals.failed > 0 && (
                  <>
                    {" "}· <span className="text-amber-400">{stats.totals.failed} failed</span>
                  </>
                )}
              </p>

              {/* Per-day stacked bars */}
              <div className="space-y-1.5">
                {stats.days.map((d, i) => (
                  <div key={d.day} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-[10px] text-muted-foreground">
                      {weekdayLabel(d.day, i, stats.days.length)}
                    </span>
                    <div className="h-3 flex-1 overflow-hidden rounded-sm bg-muted/20">
                      {d.total > 0 && (
                        <div
                          className="flex h-full"
                          style={{ width: `${(d.total / maxDayTotal) * 100}%` }}
                        >
                          {d.approved > 0 && (
                            <div
                              className="h-full bg-emerald-500/70"
                              style={{ flexGrow: d.approved }}
                            />
                          )}
                          {d.dismissed > 0 && (
                            <div
                              className="h-full bg-rose-500/70"
                              style={{ flexGrow: d.dismissed }}
                            />
                          )}
                          {d.failed > 0 && (
                            <div
                              className="h-full bg-amber-500/70"
                              style={{ flexGrow: d.failed }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                    <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                      {d.total}
                    </span>
                  </div>
                ))}
              </div>

              {/* Reviewer breakdown */}
              <div className="mt-3 border-t border-border/60 pt-2">
                <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  By reviewer
                </p>
                <div className="flex flex-wrap gap-1">
                  {DECIDER_ORDER.filter((k) => stats.totals.deciders[k] > 0).map(
                    (k) => (
                      <span
                        key={k}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {DECIDER_LABELS[k]}
                        <span className="font-semibold text-foreground">
                          {stats.totals.deciders[k]}
                        </span>
                      </span>
                    )
                  )}
                  {stats.totals.total === 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      No decisions in this window
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </AnchoredPopover>
    </div>
  )
}
