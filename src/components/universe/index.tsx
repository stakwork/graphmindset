"use client"

import { useCallback, useEffect, useState } from "react"
import { useAppStore } from "@/stores/app-store"
import { useGraphStore } from "@/stores/graph-store"
import { useSchemaStore } from "@/stores/schema-store"
import { GraphCanvas } from "./graph-canvas"
import type { GraphNode } from "@/lib/graph-api"
import { getLatestNodes } from "@/lib/graph-api"
import { isMocksEnabled } from "@/lib/mock-data"
import { cn } from "@/lib/utils"

function StarLayer({
  count,
  size,
  duration,
  opacity,
}: {
  count: number
  size: number
  duration: number
  opacity: number
}) {
  // Random star positions are mounted once; re-randomizing on re-render
  // would cause visible jitter, and the values don't depend on anything
  // we need to react to.
  const [shadows] = useState(() =>
    Array.from({ length: count }, () => {
      const x = Math.floor(Math.random() * 2000)
      const y = Math.floor(Math.random() * 2000)
      return `${x}px ${y}px oklch(0.85 0.01 260 / ${opacity})`
    }).join(", ")
  )

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        boxShadow: shadows,
        borderRadius: "50%",
        animation: `drift-up ${duration}s linear infinite`,
      }}
    />
  )
}

export function Universe() {
  const searchTerm = useAppStore((s) => s.searchTerm)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const loading = useGraphStore((s) => s.loading)
  const setGraphData = useGraphStore((s) => s.setGraphData)
  const setLoading = useGraphStore((s) => s.setLoading)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const schemas = useSchemaStore((s) => s.schemas)

  const hasResults = nodes.length > 0

  // Populate the canvas on initial mount so it isn't empty before the user
  // searches. Skip in mocks mode (mock fixtures drive the view there) and
  // skip if the store already has nodes (e.g. hot-reload, navigation back).
  // Don't abort on cleanup — React StrictMode runs effects twice in dev,
  // and aborting between runs would kill the request. We just drop the
  // result if the component is unmounted by the time it lands.
  useEffect(() => {
    if (isMocksEnabled()) return
    if (useGraphStore.getState().nodes.length > 0) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const result = await getLatestNodes()
        if (cancelled) return
        setGraphData(result.nodes ?? [], result.edges ?? [])
      } catch (err) {
        console.error("[universe] getLatestNodes failed:", err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleNodeSelect = useCallback(
    (node: GraphNode) => {
      setSelectedNode(node)
    },
    [setSelectedNode]
  )

  // Show 3D graph when we have search results
  if (hasResults && !loading) {
    return (
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        schemas={schemas}
        onNodeSelect={handleNodeSelect}
      />
    )
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {/* Deep background */}
      <div className="absolute inset-0 bg-[oklch(0.05_0.02_260)]" />

      {/* Grid overlay */}
      <div className="absolute inset-0 grid-bg opacity-60" />

      {/* Star layers */}
      <div className="absolute inset-0 overflow-hidden">
        <StarLayer count={120} size={1} duration={80} opacity={0.4} />
        <StarLayer count={60} size={2} duration={120} opacity={0.25} />
        <StarLayer count={20} size={3} duration={200} opacity={0.15} />
      </div>

      {/* Radial vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_30%,_oklch(0.05_0.02_260)_100%)]" />

      {/* Center element — concentric rings idle, with a radar-sweep arc + orbit
          dots + breathing halo when loading. */}
      <div className="relative z-10 text-center space-y-6 animate-fade-in-up">
        <div
          className="mx-auto relative h-32 w-32"
          style={loading ? { animation: "loader-breath 2.4s ease-in-out infinite" } : undefined}
        >
          {/* Diffuse halo behind everything (loading only) */}
          {loading && (
            <div
              className="absolute inset-[-20%] rounded-full pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle, oklch(0.72 0.14 200 / 0.18) 0%, transparent 60%)",
                animation: "loader-halo 2.4s ease-in-out infinite",
              }}
            />
          )}

          {/* Outermost static ring */}
          <div
            className={cn(
              "absolute inset-0 rounded-full border transition-colors duration-500",
              loading ? "border-primary/30" : "border-primary/10"
            )}
          />

          {/* Sweeping radar arc on the outer ring (loading only) */}
          {loading && (
            <svg
              className="absolute inset-0 pointer-events-none"
              viewBox="0 0 100 100"
              style={{ animation: "spin 1.4s linear infinite" }}
            >
              <defs>
                <linearGradient id="loader-sweep" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="oklch(0.72 0.14 200)" stopOpacity="0" />
                  <stop offset="100%" stopColor="oklch(0.72 0.14 200)" stopOpacity="1" />
                </linearGradient>
              </defs>
              <circle
                cx="50"
                cy="50"
                r="49"
                fill="none"
                stroke="url(#loader-sweep)"
                strokeWidth="1.5"
                strokeDasharray="60 240"
                strokeLinecap="round"
              />
            </svg>
          )}

          {/* Dashed middle ring */}
          <div
            className={cn(
              "absolute inset-2 rounded-full border border-dashed transition-colors duration-500",
              loading ? "border-primary/55" : "border-primary/15"
            )}
            style={{ animation: `spin ${loading ? 4 : 30}s linear infinite` }}
          />

          {/* Orbit dot traveling along the dashed ring (loading only) */}
          {loading && (
            <div
              className="absolute inset-2 pointer-events-none"
              style={{ animation: "spin 2s linear infinite" }}
            >
              <div
                className="absolute -top-[3px] left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-primary"
                style={{ boxShadow: "0 0 8px oklch(0.72 0.14 200), 0 0 16px oklch(0.72 0.14 200 / 0.5)" }}
              />
            </div>
          )}

          {/* Inner ring */}
          <div
            className={cn(
              "absolute inset-5 rounded-full border transition-colors duration-500",
              loading ? "border-primary/35" : "border-primary/8"
            )}
            style={{ animation: `spin ${loading ? 5 : 45}s linear infinite reverse` }}
          />

          {/* Counter-rotating orbit dot on inner ring (loading only) */}
          {loading && (
            <div
              className="absolute inset-5 pointer-events-none"
              style={{ animation: "spin 2.6s linear infinite reverse" }}
            >
              <div
                className="absolute -top-[2px] left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-cyan-muted"
                style={{ boxShadow: "0 0 6px oklch(0.85 0.12 200), 0 0 12px oklch(0.85 0.12 200 / 0.5)" }}
              />
            </div>
          )}

          {/* Pulsing halo behind the center dot (loading only) */}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className="h-3 w-3 rounded-full bg-primary/40"
                style={{ animation: "loader-pulse 1.4s ease-out infinite" }}
              />
            </div>
          )}

          {/* Center dot */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className={cn(
                "rounded-full transition-all duration-500",
                loading
                  ? "h-2.5 w-2.5 bg-primary shadow-[0_0_14px_oklch(0.72_0.14_200/0.8),0_0_28px_oklch(0.72_0.14_200/0.35)]"
                  : "h-2 w-2 bg-primary/60 shadow-[0_0_8px_oklch(0.72_0.14_200/0.4),0_0_20px_oklch(0.72_0.14_200/0.15)]"
              )}
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-heading font-semibold uppercase tracking-[0.2em] text-primary/60">
            {loading ? "Loading" : "Graph Viewport"}
          </p>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            {loading
              ? "Fetching the latest activity from the graph"
              : "Search to explore the knowledge graph"}
          </p>
        </div>
      </div>

      {/* Corner decorations */}
      <div className="absolute top-4 left-4 flex items-center gap-2 opacity-40">
        <div className="h-px w-8 bg-primary/40" />
        <span className="text-[9px] font-mono text-primary/60 uppercase">viewport</span>
      </div>
      <div className="absolute bottom-4 right-4 flex items-center gap-2 opacity-40">
        <span className="text-[9px] font-mono text-primary/60">
          {searchTerm ? `"${searchTerm}"` : "0,0,0"}
        </span>
        <div className="h-px w-8 bg-primary/40" />
      </div>
    </div>
  )
}
