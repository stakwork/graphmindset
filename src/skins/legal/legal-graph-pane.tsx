"use client"

import { Network, Loader2 } from "lucide-react"
import { useGraphStore } from "@/stores/graph-store"
import { useAppStore } from "@/stores/app-store"
import { useSchemaStore } from "@/stores/schema-store"
import { GraphCanvas } from "@/components/universe/graph-canvas"
import { SearchBar } from "@/components/search/search-bar"
import { Toolkit, ToolkitFAB } from "@/components/layout/toolkit"
import type { GraphNode } from "@/lib/graph-api"

// ── Legal Network Header ─────────────────────────────────────────────────────

function LegalNetworkHeader() {
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
      className="relative z-20 flex items-baseline gap-3 border-b border-primary/20 bg-background/70 backdrop-blur-md px-5 py-3 cursor-pointer hover:opacity-80 transition-opacity"
      onClick={handleClick}
    >
      {/* Gold rule beneath header */}
      <div className="absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent pointer-events-none" />

      <h1
        className="font-heading font-semibold text-xs tracking-[0.25em] uppercase text-primary"
      >
        Legal Network
      </h1>

      <span className="h-3 w-px bg-primary/30 self-center" aria-hidden />

      <h2
        className="font-heading text-xs font-medium leading-none uppercase text-foreground/70 truncate tracking-[0.18em]"
      >
        {title}
      </h2>
    </header>
  )
}

// ── Legal Graph Pane ─────────────────────────────────────────────────────────

export function LegalGraphPane() {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const selectedNode = useGraphStore((s) => s.selectedNode)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const clearSelection = useGraphStore((s) => s.clearSelection)
  const loadingNeighbors = useGraphStore((s) => s.loadingNeighborRefs.size > 0)
  const schemas = useSchemaStore((s) => s.schemas)

  const sourcesOpen = useAppStore((s) => s.sourcesOpen)
  const myContentOpen = useAppStore((s) => s.myContentOpen)
  const followingOpen = useAppStore((s) => s.followingOpen)
  const agentOpen = useAppStore((s) => s.agentOpen)
  const clipsOpen = useAppStore((s) => s.clipsOpen)
  const searchTerm = useAppStore((s) => s.searchTerm)
  const graphName = useAppStore((s) => s.graphName)
  const toggleSources = useAppStore((s) => s.toggleSources)
  const toggleMyContent = useAppStore((s) => s.toggleMyContent)
  const toggleFollowing = useAppStore((s) => s.toggleFollowing)
  const toggleAgent = useAppStore((s) => s.toggleAgent)
  const workflowsOpen = useAppStore((s) => s.workflowsOpen)
  const toggleWorkflows = useAppStore((s) => s.toggleWorkflows)

  function onSelect(node: GraphNode) {
    setSelectedNode(node)
  }

  function openPanel(toggle: () => void) {
    clearSelection()
    toggle()
  }

  const hasData = nodes.length > 0
  const isDefaultView =
    !sourcesOpen &&
    !myContentOpen &&
    !followingOpen &&
    !agentOpen &&
    !clipsOpen &&
    !workflowsOpen &&
    !selectedNode &&
    !searchTerm
  const title = graphName || "Knowledge Graph"

  return (
    <section className="relative h-full w-full flex flex-col bg-background noise-bg overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none" />

      {/* Navy vignette overlay (deeper than default) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, oklch(0.09 0.03 250 / 0.88) 100%)",
        }}
      />

      <LegalNetworkHeader />

      <div className="relative z-10 flex-1 min-h-0">
        {hasData ? (
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            schemas={schemas}
            onNodeSelect={onSelect}
          />
        ) : (
          <LegalEmptyState />
        )}

        {isDefaultView && hasData && (
          <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none px-6">
            <div className="flex flex-col items-center gap-2 select-none">
              <span className="relative h-6 w-6 rounded-full bg-primary shadow-[0_0_24px_oklch(0.72_0.15_75/0.9),inset_0_0_8px_oklch(0.72_0.15_75/0.6)]">
                <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-40" />
                <span className="absolute inset-[6px] rounded-full bg-background/40" />
              </span>
              <span className="font-mono text-[13px] tracking-[0.18em] uppercase text-primary font-medium whitespace-nowrap">
                {title}
              </span>
            </div>
          </div>
        )}

        <div className="absolute top-4 left-5 z-20 pointer-events-none flex items-center gap-2">
          <div className="font-mono text-[9px] tracking-[0.22em] uppercase text-muted-foreground/70">
            {nodes.length}n · {edges.length}e
          </div>
          {loadingNeighbors && (
            <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[9px] tracking-[0.18em] uppercase text-primary">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Loading connections
            </div>
          )}
        </div>

        <div className="absolute top-4 right-5 z-30">
          <Toolkit
            sourcesOpen={sourcesOpen}
            onToggleSources={() => openPanel(toggleSources)}
            myContentOpen={myContentOpen}
            onToggleMyContent={() => openPanel(toggleMyContent)}
            followingOpen={followingOpen}
            onToggleFollowing={() => openPanel(toggleFollowing)}
            agentOpen={agentOpen}
            onToggleAgent={() => openPanel(toggleAgent)}
            workflowsOpen={workflowsOpen}
            onToggleWorkflows={() => openPanel(toggleWorkflows)}
          />
        </div>
        <ToolkitFAB
          sourcesOpen={sourcesOpen}
          onToggleSources={() => openPanel(toggleSources)}
          myContentOpen={myContentOpen}
          onToggleMyContent={() => openPanel(toggleMyContent)}
          followingOpen={followingOpen}
          onToggleFollowing={() => openPanel(toggleFollowing)}
          agentOpen={agentOpen}
          onToggleAgent={() => openPanel(toggleAgent)}
          workflowsOpen={workflowsOpen}
          onToggleWorkflows={() => openPanel(toggleWorkflows)}
        />
      </div>

      <div className="relative z-20 px-5 pb-5 pt-3 bg-gradient-to-t from-background/95 via-background/70 to-transparent">
        <div className="mx-auto max-w-2xl">
          <SearchBar />
        </div>
      </div>
    </section>
  )
}

function LegalEmptyState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 pointer-events-none">
      <div className="relative mb-4">
        <Network className="h-10 w-10 text-primary/30" />
        <span className="absolute inset-0 rounded-full bg-primary/10 blur-2xl" aria-hidden />
      </div>
      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary/60">
        No documents indexed
      </p>
      <p className="font-mono text-[10px] text-muted-foreground/60 mt-2 tracking-[0.18em]">
        Search to load the legal network
      </p>
    </div>
  )
}
