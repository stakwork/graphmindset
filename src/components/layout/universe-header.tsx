"use client"

import { useAppStore } from "@/stores/app-store"
import { useGraphStore } from "@/stores/graph-store"

export function UniverseHeader() {
  const graphName = useAppStore((s) => s.graphName)
  const closeAllPanels = useAppStore((s) => s.closeAllPanels)
  const setSearchTerm = useAppStore((s) => s.setSearchTerm)
  const clearSelection = useGraphStore((s) => s.clearSelection)
  const title = graphName || "Knowledge Graph"

  function handleClick() {
    closeAllPanels()
    clearSelection()
    setSearchTerm("")
  }

  return (
    <header
      className="relative z-20 flex items-baseline gap-3 border-b border-border/50 bg-background/70 backdrop-blur-md px-5 py-3 cursor-pointer hover:opacity-80 transition-opacity"
      onClick={handleClick}
    >
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
