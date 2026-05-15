"use client"

import { useAppStore } from "@/stores/app-store"

export function UniverseHeader() {
  const graphName = useAppStore((s) => s.graphName)
  const title = graphName || "Knowledge Graph"

  return (
    <header className="relative z-20 flex items-baseline gap-3 border-b border-border/50 bg-background/70 backdrop-blur-md px-5 py-3">
      <div className="absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent pointer-events-none" />

      <h1
        className="font-heading text-xl sm:text-2xl font-semibold leading-none uppercase text-foreground glow-text-cyan whitespace-nowrap"
        style={{ letterSpacing: "0.35em" }}
      >
        Universe
      </h1>

      <span className="h-4 w-px bg-border/60 self-center" aria-hidden />

      <h2
        className="font-heading text-base sm:text-lg font-medium leading-none uppercase text-foreground/80 truncate"
        style={{ letterSpacing: "0.28em" }}
      >
        {title}
      </h2>
    </header>
  )
}
