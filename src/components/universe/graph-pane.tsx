"use client"

import { useSyncExternalStore } from "react"
import { Network, Loader2 } from "lucide-react"
import { useGraphStore } from "@/stores/graph-store"
import { useAppStore } from "@/stores/app-store"
import { useSchemaStore } from "@/stores/schema-store"
import { Neo4jCanvas } from "./neo4j-canvas"
import { GraphCanvas } from "./graph-canvas"
import { UniverseHeader } from "@/components/layout/universe-header"
import { Toolkit, ToolkitFAB } from "@/components/layout/toolkit"
import type { GraphNode } from "@/lib/graph-api"

// Which renderer draws the main graph. "neo4j" is the Neo4j Browser-style 2D
// force view, "radial" the original 3D radial view. Remembered per browser.
type GraphViewMode = "neo4j" | "radial"
const VIEW_MODE_STORAGE_KEY = "graphmindset.graph-view-mode"
const VIEW_MODES: { value: GraphViewMode; label: string }[] = [
  { value: "neo4j", label: "2D" },
  { value: "radial", label: "Radial" },
]

// localStorage exposed as an external store: the server snapshot is always
// "neo4j" so SSR and the first client render agree, then the stored choice
// takes over without a setState-in-effect.
const viewModeListeners = new Set<() => void>()
function subscribeViewMode(cb: () => void) {
  viewModeListeners.add(cb)
  window.addEventListener("storage", cb)
  return () => {
    viewModeListeners.delete(cb)
    window.removeEventListener("storage", cb)
  }
}
function readStoredViewMode(): GraphViewMode {
  try {
    return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "radial" ? "radial" : "neo4j"
  } catch {
    return "neo4j"
  }
}
function writeStoredViewMode(mode: GraphViewMode) {
  try {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
  } catch {
    // storage unavailable (private mode) — the choice just won't persist
  }
  for (const cb of viewModeListeners) cb()
}

export function GraphPane() {
  const viewMode = useSyncExternalStore(subscribeViewMode, readStoredViewMode, () => "neo4j" as GraphViewMode)
  const changeViewMode = writeStoredViewMode

  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const selectedNode = useGraphStore((s) => s.selectedNode)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  // While a sidebar pick is active the canvas shows that node's 1-hop
  // neighborhood as its own graph (see useNeighborFetch / setFocusGraph).
  const focusGraph = useGraphStore((s) => s.focusGraph)
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

  // Canvas clicks update `selectedNode` (drives the preview panel). Both
  // selectedNode and sidebarSelectedNode now gate the 1-hop neighbor fetch
  // (use-neighbor-fetch), so clicking a node anywhere appends its related
  // nodes/edges into the graph. The append goes through addNodes, which does
  // not bump dataVersion — the current view is kept, not reset.
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

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, oklch(0.08 0.022 260 / 0.85) 100%)",
        }}
      />

      <UniverseHeader />

      <div className="relative z-10 flex-1 min-h-0">
        {hasData ? (
          viewMode === "neo4j" ? (
            <Neo4jCanvas
              nodes={focusGraph ? focusGraph.nodes : nodes}
              edges={focusGraph ? focusGraph.edges : edges}
              layoutRootRefId={focusGraph?.rootRefId}
              schemas={schemas}
              onNodeSelect={onSelect}
            />
          ) : (
            <GraphCanvas
              nodes={focusGraph ? focusGraph.nodes : nodes}
              edges={focusGraph ? focusGraph.edges : edges}
              layoutRootRefId={focusGraph?.rootRefId}
              schemas={schemas}
              onNodeSelect={onSelect}
            />
          )
        ) : (
          <EmptyState />
        )}

        {isDefaultView && hasData && (
          <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none px-6">
            <div className="flex flex-col items-center gap-2 select-none">
              <span className="relative h-6 w-6 rounded-full bg-primary shadow-[0_0_24px_oklch(0.72_0.14_200/0.9),inset_0_0_8px_oklch(0.72_0.14_200/0.6)]">
                <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-40" />
                <span className="absolute inset-[6px] rounded-full bg-background/40" />
              </span>
              <span className="font-mono text-[13px] tracking-[0.18em] uppercase text-foreground font-medium whitespace-nowrap">
                {title}
              </span>
            </div>
          </div>
        )}

        <div className="absolute top-4 left-5 z-20 pointer-events-none flex items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Graph view"
            className="pointer-events-auto flex items-center rounded-md border border-border bg-background/80 p-0.5 backdrop-blur"
          >
            {VIEW_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={viewMode === m.value}
                onClick={() => changeViewMode(m.value)}
                className={`rounded px-2 py-0.5 font-mono text-[9px] tracking-[0.18em] uppercase transition-colors ${
                  viewMode === m.value
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
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
    </section>
  )
}

function EmptyState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 pointer-events-none">
      <div className="relative mb-4">
        <Network className="h-10 w-10 text-primary/30" />
        <span className="absolute inset-0 rounded-full bg-primary/10 blur-2xl" aria-hidden />
      </div>
      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
        No graph data yet
      </p>
      <p className="font-mono text-[10px] text-muted-foreground/60 mt-2 tracking-[0.18em]">
        Search to populate the universe
      </p>
    </div>
  )
}
