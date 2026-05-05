"use client"

import { useCallback, useEffect, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Button } from "@/components/ui/button"
import { SelectNative } from "@/components/ui/select-native"
import { Switch } from "@/components/ui/switch"
import { CADENCE_PRESETS, snapToPreset } from "@/lib/cadence-presets"
import {
  type CronConfig,
  type StakworkRun,
  getCronConfig,
  getCronRuns,
  runCron,
  updateCronConfig,
} from "@/lib/graph-api"
import { isMocksEnabled, MOCK_CRON_CONFIGS, MOCK_STAKWORK_RUNS } from "@/lib/mock-data"

const JANITOR_LABELS: Record<string, string> = {
  deduplication: "Deduplication",
}

function formatRunTime(ts?: string): string {
  if (!ts) return "Never run"
  return formatDistanceToNow(new Date(ts), { addSuffix: true })
}

function RunStatusBadge({ status }: { status: StakworkRun["status"] }) {
  const colours: Record<StakworkRun["status"], string> = {
    COMPLETED: "bg-green-500/15 text-green-400",
    FAILED: "bg-destructive/15 text-destructive",
    RUNNING: "bg-blue-500/15 text-blue-400",
    PENDING: "bg-yellow-500/15 text-yellow-400",
  }
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${colours[status]}`}>
      {status}
    </span>
  )
}

export function JanitorSettings({ open }: { open: boolean }) {
  const [configs, setConfigs] = useState<CronConfig[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (isMocksEnabled()) {
        setConfigs(MOCK_CRON_CONFIGS.filter((c) => c.kind === "janitor") as CronConfig[])
        return
      }
      const { configs } = await getCronConfig({ kind: "janitor" })
      setConfigs(configs)
    } catch (err) {
      console.error("Failed to load janitor config", err)
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const handleUpdate = useCallback(
    async (
      sourceType: string,
      fields: Partial<Pick<CronConfig, "enabled" | "cadence">>
    ) => {
      // Optimistic update
      setConfigs((prev) =>
        prev
          ? prev.map((c) => (c.source_type === sourceType ? { ...c, ...fields } : c))
          : prev
      )
      if (isMocksEnabled()) return
      try {
        const { config } = await updateCronConfig(sourceType, fields)
        setConfigs((prev) =>
          prev ? prev.map((c) => (c.source_type === sourceType ? config : c)) : prev
        )
      } catch (err) {
        console.error("Failed to update janitor config", err)
        setError(err instanceof Error ? err.message : "Failed to update")
        // Revert optimistic update
        load()
      }
    },
    [load]
  )

  if (loading && !configs) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  if (error && !configs) {
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
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Automated graph maintenance jobs. Toggle on to enable scheduled runs.
        Use &ldquo;Run now&rdquo; to trigger immediately.
      </p>
      {configs?.map((cfg) => (
        <JanitorRow key={cfg.source_type} config={cfg} onUpdate={handleUpdate} />
      ))}
    </div>
  )
}

function JanitorRow({
  config,
  onUpdate,
}: {
  config: CronConfig
  onUpdate: (sourceType: string, fields: Partial<Pick<CronConfig, "enabled" | "cadence">>) => Promise<void>
}) {
  const [lastRun, setLastRun] = useState<StakworkRun | null>(null)
  const [runsLoading, setRunsLoading] = useState(true)
  const [running, setRunning] = useState(false)

  const loadRuns = useCallback(async () => {
    try {
      if (isMocksEnabled()) {
        const mockRuns = MOCK_STAKWORK_RUNS.filter(
          (r) => r.source_type === config.source_type
        )
        setLastRun(mockRuns[0] ?? null)
        return
      }
      const { runs } = await getCronRuns({ source_type: config.source_type, limit: 1 })
      setLastRun(runs[0] ?? null)
    } catch {
      // Non-critical — silently skip if runs can't be fetched
    } finally {
      setRunsLoading(false)
    }
  }, [config.source_type])

  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  const isActive =
    lastRun?.status === "PENDING" || lastRun?.status === "RUNNING"

  const handleRunNow = useCallback(async () => {
    if (isMocksEnabled()) {
      // Simulate a dispatched PENDING run in mock mode
      setLastRun({
        ref_id: "mock-run-now",
        source_type: config.source_type,
        kind: "janitor",
        status: "PENDING",
        trigger: "MANUAL",
        created_at: new Date().toISOString(),
      })
      return
    }
    setRunning(true)
    try {
      const { run } = await runCron(config.source_type)
      setLastRun(run)
    } catch (err) {
      // 409 (skip/overlap) or any error → silent, just re-enable button
      const status = (err as { status?: number })?.status
      if (status !== 409) {
        console.error("Failed to run janitor", err)
      }
    } finally {
      setRunning(false)
    }
  }, [config.source_type])

  const label = JANITOR_LABELS[config.source_type] ?? config.source_type

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Switch
          checked={config.enabled}
          onCheckedChange={(v) => onUpdate(config.source_type, { enabled: v })}
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <SelectNative
            options={CADENCE_PRESETS}
            value={snapToPreset(config.cadence)}
            disabled={!config.enabled}
            className="h-8 text-xs"
            onChange={(e) => onUpdate(config.source_type, { cadence: e.target.value })}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/80">
          {!runsLoading && lastRun ? (
            <>
              <RunStatusBadge status={lastRun.status} />
              <span>
                {formatRunTime(lastRun.finished_at ?? lastRun.started_at ?? lastRun.created_at)}
              </span>
            </>
          ) : (
            <span>Never run</span>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleRunNow}
          disabled={running || isActive}
          className="text-xs"
        >
          {running || isActive ? (
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              Running…
            </span>
          ) : (
            "Run now"
          )}
        </Button>
      </div>
    </div>
  )
}
