"use client"

import { useEffect, useRef, useState } from "react"
import { Maximize2, Minimize2, X, Network, GripVertical, Minus } from "lucide-react"
import { useGraphStore } from "@/stores/graph-store"
import { useSchemaStore } from "@/stores/schema-store"
import { GraphCanvas } from "./graph-canvas"
import { cn } from "@/lib/utils"
import type { GraphNode, GraphEdge } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"

type Mode = "collapsed" | "mini" | "expanded"
type DragTarget = "collapsed" | "mini"

const MINI_W = 360
const MINI_H = 260
const COLLAPSED_SIZE = 48
const GUTTER = 24

interface Position {
  x: number
  y: number
}

function defaultPos(w: number, h: number): Position {
  if (typeof window === "undefined") return { x: 100, y: 100 }
  return {
    x: window.innerWidth - w - GUTTER,
    y: window.innerHeight - h - GUTTER,
  }
}

function clampToViewport(p: Position, w: number, h: number): Position {
  if (typeof window === "undefined") return p
  return {
    x: Math.max(GUTTER, Math.min(window.innerWidth - w - GUTTER, p.x)),
    y: Math.max(GUTTER, Math.min(window.innerHeight - h - GUTTER, p.y)),
  }
}

export function GraphFloater() {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const setSidebarSelectedNode = useGraphStore((s) => s.setSidebarSelectedNode)
  const schemas = useSchemaStore((s) => s.schemas)

  const [mode, setMode] = useState<Mode>("mini")
  const [miniPos, setMiniPos] = useState<Position>(() => defaultPos(MINI_W, MINI_H))
  const [collapsedPos, setCollapsedPos] = useState<Position>(() =>
    defaultPos(COLLAPSED_SIZE, COLLAPSED_SIZE)
  )

  useEffect(() => {
    function onResize() {
      setMiniPos((p) => clampToViewport(p, MINI_W, MINI_H))
      setCollapsedPos((p) => clampToViewport(p, COLLAPSED_SIZE, COLLAPSED_SIZE))
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const drag = useRef<{ startX: number; startY: number; startPos: Position; target: DragTarget } | null>(null)
  const moved = useRef(false)

  // Single mount-lifetime install/cleanup so listeners can never leak past unmount,
  // even if the user releases the mouse outside the document.
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag.current) return
      moved.current = true
      const dx = e.clientX - drag.current.startX
      const dy = e.clientY - drag.current.startY
      const next = { x: drag.current.startPos.x + dx, y: drag.current.startPos.y + dy }
      if (drag.current.target === "collapsed") {
        setCollapsedPos(clampToViewport(next, COLLAPSED_SIZE, COLLAPSED_SIZE))
      } else {
        setMiniPos(clampToViewport(next, MINI_W, MINI_H))
      }
    }
    function onUp() {
      drag.current = null
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [])

  function onDragStart(e: React.MouseEvent, target: DragTarget) {
    if ((e.target as HTMLElement).closest("button")) return
    e.preventDefault()
    moved.current = false
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPos: target === "collapsed" ? collapsedPos : miniPos,
      target,
    }
  }

  function selectNode(node: GraphNode) {
    setSelectedNode(node)
    setSidebarSelectedNode(node)
  }

  const hasData = nodes.length > 0

  if (mode === "collapsed") {
    return (
      <div
        onMouseDown={(e) => onDragStart(e, "collapsed")}
        onClick={() => {
          if (moved.current) return
          setMode("mini")
        }}
        style={{
          position: "fixed",
          left: collapsedPos.x,
          top: collapsedPos.y,
          width: COLLAPSED_SIZE,
          height: COLLAPSED_SIZE,
          zIndex: 60,
        }}
        className={cn(
          "rounded-full flex items-center justify-center group cursor-grab active:cursor-grabbing",
          "bg-popover/95 border border-primary/30 backdrop-blur-md",
          "shadow-[0_8px_30px_oklch(0_0_0/0.4),0_0_24px_oklch(0.72_0.14_200/0.18)]",
          "hover:border-primary/60 hover:shadow-[0_8px_30px_oklch(0_0_0/0.4),0_0_32px_oklch(0.72_0.14_200/0.3)] transition-all"
        )}
        title="Open graph map"
        role="button"
      >
        <Network className="h-5 w-5 text-primary group-hover:scale-110 transition-transform pointer-events-none" />
        {hasData && (
          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_oklch(0.72_0.14_200/0.8)] pointer-events-none">
            <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-60" />
          </span>
        )}
      </div>
    )
  }

  if (mode === "expanded") {
    return (
      <>
        <div
          className="fixed inset-0 z-[70] bg-background/85 backdrop-blur-sm animate-fade-in-up"
          onClick={() => setMode("mini")}
        />
        <div className="fixed inset-[5vh_5vw] z-[80] rounded-xl overflow-hidden flex flex-col bg-popover/95 border border-primary/30 backdrop-blur-md shadow-[0_30px_80px_oklch(0_0_0/0.6)]">
          <FloaterHeader
            mode="expanded"
            hasData={hasData}
            nodeCount={nodes.length}
            edgeCount={edges.length}
            onMini={() => setMode("mini")}
            onCollapse={() => setMode("collapsed")}
            onClose={() => setMode("mini")}
          />
          <div className="relative flex-1 min-h-0">
            <GraphContent hasData={hasData} nodes={nodes} edges={edges} schemas={schemas} onSelect={selectNode} />
          </div>
        </div>
      </>
    )
  }

  return (
    <div
      style={{
        position: "fixed",
        left: miniPos.x,
        top: miniPos.y,
        width: MINI_W,
        height: MINI_H,
        zIndex: 40,
      }}
      className={cn(
        "rounded-lg overflow-hidden flex flex-col group",
        "bg-popover/92 border border-primary/25 backdrop-blur-md",
        "shadow-[0_0_50px_oklch(0.72_0.14_200/0.15),inset_0_0_30px_oklch(0.72_0.14_200/0.04)]"
      )}
    >
      <div onMouseDown={(e) => onDragStart(e, "mini")} className="cursor-grab active:cursor-grabbing">
        <FloaterHeader
          mode="mini"
          hasData={hasData}
          nodeCount={nodes.length}
          edgeCount={edges.length}
          onCollapse={() => setMode("collapsed")}
          onExpand={() => setMode("expanded")}
        />
      </div>
      <div className="relative flex-1 min-h-0">
        <GraphContent hasData={hasData} nodes={nodes} edges={edges} schemas={schemas} onSelect={selectNode} />
      </div>
    </div>
  )
}

function FloaterHeader({
  mode,
  hasData,
  nodeCount,
  edgeCount,
  onCollapse,
  onExpand,
  onMini,
  onClose,
}: {
  mode: Mode
  hasData: boolean
  nodeCount: number
  edgeCount: number
  onCollapse?: () => void
  onExpand?: () => void
  onMini?: () => void
  onClose?: () => void
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-background/60 select-none">
      <div className="flex items-center gap-2 min-w-0">
        <GripVertical className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        <div className="relative h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_oklch(0.72_0.14_200/0.8)] shrink-0">
          {hasData && <div className="absolute inset-0 rounded-full bg-primary animate-ping opacity-60" />}
        </div>
        <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-primary">Graph</span>
        {hasData && (
          <span className="font-mono text-[10px] text-muted-foreground truncate">
            {nodeCount}n · {edgeCount}e
          </span>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {mode !== "collapsed" && onCollapse && (
          <button
            onClick={onCollapse}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent transition-colors"
            title="Collapse to icon"
          >
            <Minus className="h-3 w-3" />
          </button>
        )}
        {mode === "mini" && onExpand && (
          <button
            onClick={onExpand}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent transition-colors"
            title="Expand to fullscreen"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        )}
        {mode === "expanded" && onMini && (
          <button
            onClick={onMini}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent transition-colors"
            title="Shrink to mini"
          >
            <Minimize2 className="h-3 w-3" />
          </button>
        )}
        {mode === "expanded" && onClose && (
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent transition-colors"
            title="Close"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

function GraphContent({
  hasData,
  nodes,
  edges,
  schemas,
  onSelect,
}: {
  hasData: boolean
  nodes: GraphNode[]
  edges: GraphEdge[]
  schemas: SchemaNode[]
  onSelect: (node: GraphNode) => void
}) {
  if (!hasData) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 pointer-events-none">
        <Network className="h-6 w-6 text-muted-foreground/30 mb-2" />
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">No graph data yet</p>
        <p className="font-mono text-[9px] text-muted-foreground/60 mt-1">Search to populate</p>
      </div>
    )
  }
  return <GraphCanvas nodes={nodes} edges={edges} schemas={schemas} onNodeSelect={onSelect} />
}
