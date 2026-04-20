"use client"

import { useCallback, useEffect, useState } from "react"
import cronstrue from "cronstrue"
import { formatDistanceToNow } from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  type RadarConfig,
  type RadarSourceType,
  getRadarConfig,
  runRadarNow,
  updateRadarConfig,
} from "@/lib/graph-api"
import { isMocksEnabled, MOCK_RADAR_CONFIGS } from "@/lib/mock-data"

const SOURCE_TYPE_LABELS: Record<RadarSourceType, string> = {
  twitter_handle: "Twitter handles",
  youtube_channel: "YouTube channels",
  rss: "RSS feeds",
  topic: "Topics",
}

function describeCron(cron: string): string {
  if (!cron?.trim()) return "—"
  try {
    return cronstrue.toString(cron, { use24HourTimeFormat: false })
  } catch {
    return "Invalid cron"
  }
}

function formatLastRun(ts?: number): string {
  if (!ts) return "Never run"
  return formatDistanceToNow(new Date(ts * 1000), { addSuffix: true })
}

export function RadarSettings({ open }: { open: boolean }) {
  const [configs, setConfigs] = useState<RadarConfig[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (isMocksEnabled()) {
        setConfigs(MOCK_RADAR_CONFIGS as RadarConfig[])
        return
      }
      const { configs } = await getRadarConfig()
      setConfigs(configs)
    } catch (err) {
      console.error("Failed to load radar config", err)
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
      sourceType: RadarSourceType,
      fields: Partial<Pick<RadarConfig, "enabled" | "cadence" | "workflow_id">>
    ) => {
      // Optimistic update so the row reacts immediately on toggle/edit.
      setConfigs((prev) =>
        prev
          ? prev.map((c) =>
              c.source_type === sourceType ? { ...c, ...fields } : c
            )
          : prev
      )
      if (isMocksEnabled()) return
      try {
        const { config } = await updateRadarConfig(sourceType, fields)
        setConfigs((prev) =>
          prev
            ? prev.map((c) => (c.source_type === sourceType ? config : c))
            : prev
        )
      } catch (err) {
        console.error("Failed to update radar config", err)
        setError(err instanceof Error ? err.message : "Failed to update")
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
        How often to pull new content per source type. Times are UTC. Toggle
        off to pause without losing the cadence.
      </p>
      {configs?.map((cfg) => (
        <RadarRow key={cfg.source_type} config={cfg} onUpdate={handleUpdate} />
      ))}
    </div>
  )
}

function RadarRow({
  config,
  onUpdate,
}: {
  config: RadarConfig
  onUpdate: (
    sourceType: RadarSourceType,
    fields: Partial<Pick<RadarConfig, "enabled" | "cadence" | "workflow_id">>
  ) => Promise<void>
}) {
  const [cadence, setCadence] = useState(config.cadence)
  const [running, setRunning] = useState(false)
  const [runMessage, setRunMessage] = useState<string | null>(null)

  useEffect(() => {
    setCadence(config.cadence)
  }, [config.cadence])

  const cadenceDescription = describeCron(cadence)
  const cadenceInvalid = cadenceDescription === "Invalid cron"

  const commitCadence = useCallback(() => {
    const trimmed = cadence.trim()
    if (!trimmed || trimmed === config.cadence || cadenceInvalid) return
    onUpdate(config.source_type, { cadence: trimmed })
  }, [cadence, config.cadence, config.source_type, cadenceInvalid, onUpdate])

  const handleRunNow = useCallback(async () => {
    if (isMocksEnabled()) {
      setRunMessage("Mock: dispatched")
      return
    }
    setRunning(true)
    setRunMessage(null)
    try {
      const result = await runRadarNow(config.source_type)
      setRunMessage(
        `${result.status}: dispatched ${result.dispatched}` +
          (result.failed?.length ? `, ${result.failed.length} failed` : "")
      )
    } catch (err) {
      setRunMessage(err instanceof Error ? err.message : "Run failed")
    } finally {
      setRunning(false)
    }
  }, [config.source_type])

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {SOURCE_TYPE_LABELS[config.source_type]}
        </span>
        <Switch
          checked={config.enabled}
          onCheckedChange={(v) => onUpdate(config.source_type, { enabled: v })}
        />
      </div>

      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-1">
          <Input
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
            onBlur={commitCadence}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                commitCadence()
              }
            }}
            disabled={!config.enabled}
            placeholder="0 */6 * * *"
            className="h-8 text-xs font-mono bg-background/50"
          />
          <p
            className={
              cadenceInvalid
                ? "text-[10px] text-destructive"
                : "text-[10px] text-muted-foreground"
            }
          >
            {cadenceDescription}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRunNow}
          disabled={running || !config.enabled}
          className="text-xs"
        >
          {running ? "Running…" : "Run now"}
        </Button>
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground/80">
        <span>Last updated {formatLastRun(config.updated_at)}</span>
        {runMessage && <span>{runMessage}</span>}
      </div>
    </div>
  )
}
