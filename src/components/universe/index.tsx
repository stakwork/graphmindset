"use client"

import { useAppStore } from "@/stores/app-store"
import { useGraphStore } from "@/stores/graph-store"

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
  const shadows = Array.from({ length: count }, () => {
    const x = Math.floor(Math.random() * 2000)
    const y = Math.floor(Math.random() * 2000)
    return `${x}px ${y}px oklch(0.85 0.01 260 / ${opacity})`
  }).join(", ")

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
  const { nodes, edges, loading } = useGraphStore()

  const hasResults = nodes.length > 0

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

      {/* Center element */}
      <div className="relative z-10 text-center space-y-6 animate-fade-in-up">
        {loading ? (
          <div className="space-y-3">
            <div className="mx-auto h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            <p className="text-xs font-heading font-semibold uppercase tracking-[0.2em] text-primary/60">
              Searching
            </p>
          </div>
        ) : hasResults ? (
          <div className="space-y-3">
            <p className="text-xs font-heading font-semibold uppercase tracking-[0.2em] text-primary/60">
              Results
            </p>
            <p className="text-3xl font-heading font-bold text-foreground">
              {nodes.length}
              <span className="text-sm font-normal text-muted-foreground ml-2">
                nodes
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              {edges.length} edges &middot; &ldquo;{searchTerm}&rdquo;
            </p>
            <p className="text-xs text-muted-foreground/60 mt-4">
              3D graph visualization will render here
            </p>
          </div>
        ) : (
          <>
            {/* Orbital ring */}
            <div className="mx-auto relative h-28 w-28">
              <div className="absolute inset-0 rounded-full border border-primary/10" />
              <div
                className="absolute inset-2 rounded-full border border-dashed border-primary/15"
                style={{ animation: "spin 30s linear infinite" }}
              />
              <div
                className="absolute inset-5 rounded-full border border-primary/8"
                style={{ animation: "spin 45s linear infinite reverse" }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-2 w-2 rounded-full bg-primary/60 shadow-[0_0_8px_oklch(0.72_0.14_200/0.4),0_0_20px_oklch(0.72_0.14_200/0.15)]" />
              </div>
              <div
                className="absolute top-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-primary/30"
                style={{ animation: "pulse-glow 3s ease-in-out infinite" }}
              />
              <div
                className="absolute bottom-4 right-2 h-1.5 w-1.5 rounded-full bg-cyan-muted/40"
                style={{ animation: "pulse-glow 4s ease-in-out infinite 1s" }}
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-heading font-semibold uppercase tracking-[0.2em] text-primary/60">
                Graph Viewport
              </p>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                3D graph visualization will render here
              </p>
            </div>
          </>
        )}
      </div>

      {/* Corner decorations */}
      <div className="absolute top-4 left-4 flex items-center gap-2 opacity-40">
        <div className="h-px w-8 bg-primary/40" />
        <span className="text-[9px] font-mono text-primary/60 uppercase">viewport</span>
      </div>
      <div className="absolute bottom-4 right-4 flex items-center gap-2 opacity-40">
        <span className="text-[9px] font-mono text-primary/60">
          {hasResults ? `${nodes.length}n ${edges.length}e` : "0,0,0"}
        </span>
        <div className="h-px w-8 bg-primary/40" />
      </div>
    </div>
  )
}
