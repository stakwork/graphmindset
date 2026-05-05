"use client"

import { useCallback, useEffect, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Button } from "@/components/ui/button"
import { SelectNative } from "@/components/ui/select-native"
import { Switch } from "@/components/ui/switch"
import {
  type CronConfig,
  type RadarSourceType,
  getCronConfig,
  runCron,
  updateCronConfig,
} from "@/lib/graph-api"
import { isMocksEnabled, MOCK_CRON_CONFIGS } from "@/lib/mock-data"
import { CADENCE_PRESETS, snapToPreset } from "@/lib/cadence-presets"
import { useUserStore } from "@/stores/user-store"

const SOURCE_TYPE_LABELS: Record<RadarSourceType, string> = {
  twitter_handle: "Twitter handles",
  youtube_channel: "YouTube channels",
  rss: "RSS feeds",
  topic: "Topics",
}

function formatLastRun(ts?: number): string {
  if (!ts) return "Never run"
  return formatDistanceToNow(new Date(ts * 1000), { addSuffix: true })
}

export function RadarSettings({ open }: { open: boolean }) {
  const isAdmin = useUserStore((s) => s.isAdmin)
  const [configs, setConfigs] = useState<CronConfig[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (isMocksEnabled()) {
        setConfigs(MOCK_CRON_CONFIGS.filter((c) => c.kind === "source") as CronConfig[])
        return
      }
      const { configs } = await getCronConfig({ kind: "source" })
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
      fields: Partial<Pick<CronConfig, "enabled" | "cadence" | "workflow_id">>
    ) => {
      if (!isAdmin) return
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
        const { config } = await updateCronConfig(sourceType, fields)
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
    [isAdmin, load]
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
        <RadarRow key={cfg.source_type} config={cfg} onUpdate={handleUpdate} isAdmin={isAdmin} />
      ))}
    </div>
  )
}

function RadarRow({
  config,
  onUpdate,
  isAdmin,
}: {
  config: CronConfig
  onUpdate: (
    sourceType: RadarSourceType,
    fields: Partial<Pick<CronConfig, "enabled" | "cadence" | "workflow_id">>
  ) => Promise<void>
  isAdmin: boolean
}) {
  const [cadence, setCadence] = useState(snapToPreset(config.cadence))
  const [running, setRunning] = useState(false)
  const [runMessage, setRunMessage] = useState<string | null>(null)

  useEffect(() => {
    setCadence(snapToPreset(config.cadence))
  }, [config.cadence])

  const handleRunNow = useCallback(async () => {
    if (!isAdmin) return
    if (isMocksEnabled()) {
      setRunMessage("Mock: dispatched")
      return
    }
    setRunning(true)
    setRunMessage(null)
    try {
      await runCron(config.source_type)
      setRunMessage("Dispatched")
    } catch (err) {
      setRunMessage(err instanceof Error ? err.message : "Run failed")
    } finally {
      setRunning(false)
    }
  }, [isAdmin, config.source_type])

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {SOURCE_TYPE_LABELS[config.source_type as RadarSourceType]}
        </span>
        <Switch
          checked={config.enabled}
          onCheckedChange={(v) => onUpdate(config.source_type as RadarSourceType, { enabled: v })}
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <SelectNative
            options={CADENCE_PRESETS}
            value={cadence}
            disabled={!config.enabled}
            className="h-8 text-xs"
            onChange={(e) => {
              const val = e.target.value
              setCadence(val)
              onUpdate(config.source_type as RadarSourceType, { cadence: val })
            }}
          />
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
