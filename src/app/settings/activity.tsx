"use client"

import { useCallback, useEffect, useState } from "react"
import { formatDateRelative } from "@/lib/date-format"
import { Button } from "@/components/ui/button"
import { RunStatusBadge } from "@/components/ui/run-status-badge"
import {
  type CronConfig,
  type StakworkRun,
  getCronConfig,
  getCronRuns,
} from "@/lib/graph-api"
import { isMocksEnabled, MOCK_CRON_CONFIGS, MOCK_STAKWORK_RUNS } from "@/lib/mock-data"

const SOURCE_TYPE_LABELS: Record<string, string> = {
  twitter_handle: "Twitter / X",
  youtube_channel: "YouTube",
  rss: "RSS",
  topic: "Topic",
}

// Janitors record a full run history; sources only stamp last_run_at on their
// config, so the two render differently (per-run log vs. last-run summary).
function runTime(run: StakworkRun): number | undefined {
  return run.finished_at ?? run.started_at ?? run.created_at
}

export function ActivitySettings({ open }: { open: boolean }) {
  const [runs, setRuns] = useState<StakworkRun[] | null>(null)
  const [sources, setSources] = useState<CronConfig[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (isMocksEnabled()) {
        setRuns(MOCK_STAKWORK_RUNS.filter((r) => r.kind === "janitor"))
        setSources(MOCK_CRON_CONFIGS.filter((c) => c.kind === "source") as CronConfig[])
        return
      }
      const [runsResp, sourcesResp] = await Promise.all([
        getCronRuns({ kind: "janitor", limit: 50 }),
        getCronConfig({ kind: "source" }),
      ])
      setRuns(runsResp.runs)
      setSources(sourcesResp.configs)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  if (loading && !runs && !sources) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  if (error && !runs && !sources) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="ghost" size="sm" onClick={load}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Recent janitor runs and last scheduled run per source type. Namespace-scoped.
        </p>
        <Button variant="ghost" size="sm" onClick={load}>
          Refresh
        </Button>
      </div>

      {/* Source schedules — last run per type (no per-run history exists for sources) */}
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
        <h3 className="text-xs font-heading font-semibold uppercase tracking-wider text-muted-foreground">
          Source Schedules
        </h3>
        {sources && sources.length > 0 ? (
          <div className="space-y-1">
            {sources.map((c) => (
              <div key={c.ref_id} className="flex items-center justify-between gap-2 py-1">
                <span className="text-sm text-foreground">
                  {SOURCE_TYPE_LABELS[c.source_type] ?? c.source_type}
                </span>
                <div className="flex items-center gap-2">
                  {!c.enabled && (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                      paused
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDateRelative(c.last_run_at, "Never run")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No source schedules configured.</p>
        )}
      </div>

      {/* Janitor run history — full per-run log */}
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
        <h3 className="text-xs font-heading font-semibold uppercase tracking-wider text-muted-foreground">
          Janitor Runs
        </h3>
        {runs && runs.length > 0 ? (
          <div className="space-y-1">
            {runs.map((run) => (
              <div
                key={run.ref_id}
                className="flex items-start justify-between gap-2 py-1"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground truncate">
                      {run.job_type ?? run.source_type ?? "—"}
                    </span>
                    <RunStatusBadge status={run.status} />
                    {run.trigger && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {run.trigger}
                      </span>
                    )}
                  </div>
                  {run.error && (
                    <p className="text-xs text-destructive truncate">{run.error}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatDateRelative(runTime(run), "—")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No janitor runs recorded yet.</p>
        )}
      </div>
    </div>
  )
}
