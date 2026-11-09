"use client"

import { useEffect, useState } from "react"
import { getStats } from "@/lib/graph-api"
import { isMocksEnabled } from "@/lib/mock-data"
import { formatStatNumber, getDisplayStats, type GraphStat } from "@/lib/graph-stats"

const MOCK_STATS: GraphStat[] = [{ label: "Nodes", value: 1234 }]

export function GraphStats() {
  const mocks = isMocksEnabled()
  const [stats, setStats] = useState<GraphStat[] | null>(mocks ? MOCK_STATS : null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (mocks) return
    const controller = new AbortController()
    getStats(controller.signal)
      .then((res) => setStats(getDisplayStats(res)))
      .catch((err) => {
        if (controller.signal.aborted) return
        console.error("[graph-stats] getStats failed:", err)
        setError(true)
      })
    return () => controller.abort()
  }, [mocks])

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-3 sm:px-6 pt-4 text-xs text-muted-foreground/60">
        Stats unavailable
      </div>
    )
  }

  if (stats === null) {
    return (
      <div className="max-w-3xl mx-auto px-3 sm:px-6 pt-4" data-testid="graph-stats-loading">
        <div className="h-10 w-40 rounded-md bg-muted/40 animate-pulse" />
      </div>
    )
  }

  if (stats.length === 0) return null

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-6 pt-4 flex flex-wrap gap-2">
      {stats.map((s) => (
        <div key={s.label} className="rounded-md border border-border/40 bg-card/50 px-3 py-1.5">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
            {s.label}
          </div>
          <div className="text-sm font-semibold text-foreground">{formatStatNumber(s.value)}</div>
        </div>
      ))}
    </div>
  )
}
