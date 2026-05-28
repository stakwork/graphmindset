"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { GraphNode, GraphData, GraphEdge } from "@/lib/graph-api"
import { getNode } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"
import { metroSeries } from "@/data/metro"
import { buildCaseDataset } from "./adapter"
import { LOD, C, FONT_MONO } from "./constants"
import { worldToScreen, screenToWorld, type Cam } from "./camera"
import {
  clear,
  drawDot,
  drawLeafGlyph,
  drawEdge,
  getNodeCardBounds,
} from "./draw"
import type { SigDataset, SigEntity } from "./types"

const METRO_FIXTURE_STATION_REF_IDS = new Set(
  (metroSeries.nodes as { ref_id: string; node_type?: string }[])
    .filter((n) => n.node_type === "Station")
    .map((n) => n.ref_id),
)

// Read the 1-hop subgraph for a refId. Backend nodes go through /v2/nodes;
// metro stations short-circuit to the local fixture (same pattern as
// node-preview-panel.tsx — backend collapses platform variants we want to keep).
async function fetchCaseSubgraph(
  refId: string,
  signal?: AbortSignal,
): Promise<GraphData> {
  if (METRO_FIXTURE_STATION_REF_IDS.has(refId)) {
    const allNodes = metroSeries.nodes as GraphNode[]
    const allEdges = metroSeries.edges as GraphEdge[]
    const neighborIds = new Set<string>([refId])
    for (const e of allEdges) {
      if (e.source === refId) neighborIds.add(e.target)
      if (e.target === refId) neighborIds.add(e.source)
    }
    return {
      nodes: allNodes.filter((n) => neighborIds.has(n.ref_id)),
      edges: allEdges.filter(
        (e) => e.source === refId || e.target === refId,
      ),
    }
  }
  return getNode(refId, "edges", signal)
}

const INITIAL_SCALE = 1.0
const EXIT_ZOOM_THRESHOLD = 0.25 // cam.scale below this → trigger 2D→3D exit

export interface CaseViewProps {
  initialNode: GraphNode
  schemas: SchemaNode[]
  // Apparent screen radius the selected node had in 3D at the handoff frame.
  // We initialize cam.scale so the same node has the same on-screen radius
  // here — the user's eye doesn't lose it.
  initialApparentRadius?: number
  onExit: () => void
}

// Duration of the cross-fade between the 3D canvas and the 2D case view, in
// ms. Used both on open (after data arrives) and on close (before onExit).
const FADE_MS = 300
// Duration of the post-landing zoom-out: the selected node lands at the same
// pixel size it had in 3D, then eases out to REST_SCALE so neighbors come
// into view. Tuned to feel like a continuation of the camera dolly, not a
// separate animation.
const REST_SCALE_ANIM_MS = 600
const REST_SCALE = 1.0

export function CaseView({
  initialNode,
  schemas,
  initialApparentRadius,
  onExit,
}: CaseViewProps) {
  const [currentRefId, setCurrentRefId] = useState(initialNode.ref_id)
  const [data, setData] = useState<SigDataset | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Drives the outer-div CSS opacity transition. Stays 0 until data lands,
  // then ramps to 1 (open). Flips back to 0 on close, and after the
  // transition completes we call the parent's onExit to actually unmount.
  const [visible, setVisible] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLCanvasElement>(null)
  const edgeRef = useRef<HTMLCanvasElement>(null)
  const nodeRef = useRef<HTMLCanvasElement>(null)

  // Fetch dataset whenever the active refId changes
  useEffect(() => {
    const controller = new AbortController()
    setLoadError(null)
    fetchCaseSubgraph(currentRefId, controller.signal)
      .then((g) => {
        if (controller.signal.aborted) return
        const ds = buildCaseDataset({
          selectedRefId: currentRefId,
          nodes: g.nodes,
          edges: g.edges,
          schemas,
        })
        if (!ds) {
          setLoadError("No node data")
          return
        }
        setData(ds)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setLoadError(err instanceof Error ? err.message : "Failed to load")
      })
    return () => controller.abort()
  }, [currentRefId, schemas])

  // Imperative state for the render loop. Decoupled from React's render cycle
  // so 60fps pan/zoom doesn't trigger re-renders.
  const stateRef = useRef({
    cam: { x: 0, y: 0, scale: INITIAL_SCALE } as Cam,
    DPR: typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1,
    w: 0,
    h: 0,
    mouse: { x: 0, y: 0, down: false, dragStart: null as null | { x: number; y: number; camX: number; camY: number } },
    hover: null as SigEntity | null,
    data: null as SigDataset | null,
    t0: typeof performance !== "undefined" ? performance.now() : 0,
    t: 0,
    rafId: 0,
    onNeighborClick: null as null | ((e: SigEntity) => void),
    onExitZoom: null as null | (() => void),
    exitFired: false,
    // While the auto-fit animation is running, the cam.scale is being
    // driven programmatically. Suppress the zoom-out-to-exit trigger so
    // high-degree centers (which fit at low scale) don't bounce the user
    // back to 3D the moment they open the case view.
    autoFitInProgress: false,
  })

  useEffect(() => {
    stateRef.current.data = data
    if (data) {
      // Re-center camera on the new selected node. If an initial apparent
      // radius was provided (the 3D→2D handoff), pick cam.scale so the
      // selected entity has that same apparent radius on this canvas.
      stateRef.current.cam.x = data.selected.x
      stateRef.current.cam.y = data.selected.y
      if (initialApparentRadius && initialApparentRadius > 0) {
        stateRef.current.cam.scale = initialApparentRadius / data.selected.r
      } else {
        stateRef.current.cam.scale = INITIAL_SCALE
      }
      stateRef.current.exitFired = false
    }
  }, [data, initialApparentRadius])

  // Fade in once data is ready — keeps the case view transparent (so the 3D
  // scene shows through) during the fetch, eliminating the "loading…" flash.
  // Errors also flip visible so the failure message isn't hidden by opacity:0.
  useEffect(() => {
    if (!data && !loadError) return
    // rAF lets the browser commit the opacity:0 initial frame before
    // flipping to 1, so the CSS transition actually animates.
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [data, loadError])

  // After landing pixel-continuous on the selected node, ease cam.scale to
  // a "fit" zoom — derived from the layout's world bounding box so the
  // outermost ring sits comfortably inside the viewport with margin.
  // Auto-fit suppresses the zoom-out-to-exit trigger so high-degree
  // centers (which fit at low scale) don't bounce the user back to 3D the
  // moment they open the case view.
  useEffect(() => {
    if (!data) return
    const S = stateRef.current
    if (S.w === 0 || S.h === 0) return
    const start = S.cam.scale
    const bb = data.worldBBox
    const worldW = Math.max(bb.maxX - bb.minX, 1)
    const worldH = Math.max(bb.maxY - bb.minY, 1)
    const margin = 80
    const fitScale = Math.min(
      (S.w - margin * 2) / worldW,
      (S.h - margin * 2) / worldH,
    )
    // Clamp above the exit threshold so the animation can't bounce us back
    // to 3D mid-fit. Clamp below 2× rest scale so low-degree centers don't
    // zoom in absurdly.
    const target = Math.max(
      EXIT_ZOOM_THRESHOLD * 1.5,
      Math.min(fitScale, Math.max(start, REST_SCALE * 2)),
    )
    const startTime = performance.now()
    let raf = 0
    S.autoFitInProgress = true
    function tick() {
      const t = Math.min(1, (performance.now() - startTime) / REST_SCALE_ANIM_MS)
      const eased = 1 - Math.pow(1 - t, 3)
      S.cam.scale = start + (target - start) * eased
      if (t < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        S.autoFitInProgress = false
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      S.autoFitInProgress = false
    }
  }, [data])

  // Triggers the fade-out, then calls the parent's onExit once the
  // transition has finished playing. Replaces direct onExit() everywhere so
  // every close path (Esc / X button / zoom-out trigger) animates.
  const requestExit = useCallback(() => {
    setVisible(false)
    setTimeout(onExit, FADE_MS)
  }, [onExit])

  // Esc + close button exit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestExit()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [requestExit])

  // Hit-test in screen space. At high LOD the node renders as a content
  // card (drawNodeCard), so the test uses its rectangular bounds;
  // otherwise it falls back to the circular radius the glyph occupies.
  const hitTest = useCallback((sx: number, sy: number): SigEntity | null => {
    const S = stateRef.current
    if (!S.data) return null
    for (const e of S.data.flat) {
      const sc = worldToScreen(e.x, e.y, S.cam, S.w, S.h)
      const appR = e.r * S.cam.scale
      if (appR > LOD.CARD_VISIBLE) {
        const b = getNodeCardBounds(e, sc, appR)
        if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) {
          return e
        }
      } else {
        const r = appR + 6
        const dx = sx - sc.x
        const dy = sy - sc.y
        if (dx * dx + dy * dy <= r * r) return e
      }
    }
    return null
  }, [])

  const handleNeighborClick = useCallback((e: SigEntity) => {
    if (e.id === currentRefId) return
    setCurrentRefId(e.id)
  }, [currentRefId])

  useEffect(() => {
    stateRef.current.onNeighborClick = handleNeighborClick
    stateRef.current.onExitZoom = requestExit
  }, [handleNeighborClick, requestExit])

  // Render loop + input handling
  useEffect(() => {
    const stage = stageRef.current
    const bgC = bgRef.current
    const edgeC = edgeRef.current
    const nodeC = nodeRef.current
    if (!stage || !bgC || !edgeC || !nodeC) return
    const bgCtx = bgC.getContext("2d")
    const edgeCtx = edgeC.getContext("2d")
    const nodeCtx = nodeC.getContext("2d")
    if (!bgCtx || !edgeCtx || !nodeCtx) return
    const S = stateRef.current

    function resize() {
      const r = stage!.getBoundingClientRect()
      S.w = r.width
      S.h = r.height
      for (const c of [bgC, edgeC, nodeC]) {
        if (!c) continue
        c.width = Math.floor(r.width * S.DPR)
        c.height = Math.floor(r.height * S.DPR)
        c.getContext("2d")!.setTransform(S.DPR, 0, 0, S.DPR, 0, 0)
      }
    }
    window.addEventListener("resize", resize)
    resize()

    function drawBackground() {
      clear(bgCtx!, S.w, S.h)
      bgCtx!.fillStyle = C.bg0
      bgCtx!.fillRect(0, 0, S.w, S.h)
      // grid
      const step = 200
      const sStep = step * S.cam.scale
      if (sStep < 10) return
      const tl = screenToWorld(0, 0, S.cam, S.w, S.h)
      const ox = (Math.floor(tl.x / step) * step - S.cam.x) * S.cam.scale + S.w / 2
      const oy = (Math.floor(tl.y / step) * step - S.cam.y) * S.cam.scale + S.h / 2
      bgCtx!.strokeStyle = `rgba(120, 200, 220, 0.06)`
      bgCtx!.lineWidth = 1
      bgCtx!.beginPath()
      for (let x = ox; x < S.w + sStep; x += sStep) {
        bgCtx!.moveTo(x, 0)
        bgCtx!.lineTo(x, S.h)
      }
      for (let y = oy; y < S.h + sStep; y += sStep) {
        bgCtx!.moveTo(0, y)
        bgCtx!.lineTo(S.w, y)
      }
      bgCtx!.stroke()
    }

    function drawEdges() {
      clear(edgeCtx!, S.w, S.h)
      if (!S.data) return
      const selectedId = S.data.selectedId
      // 1) Only draw edges that touch the selected node — sibling-to-sibling
      //    edges from the API turn the case board into a hairball.
      const drawable = S.data.edges.filter(
        (e) => e.fromId === selectedId || e.toId === selectedId,
      )
      // 2) Label dedup: show each edge-type label at most once, on the
      //    edge whose midpoint is closest to screen-center.
      const showLabelsAtAll = S.cam.scale > 0.4
      const labelEdgeId = new Set<string>()
      if (showLabelsAtAll) {
        const byType = new Map<string, typeof drawable>()
        for (const e of drawable) {
          const arr = byType.get(e.label ?? "") ?? []
          arr.push(e)
          byType.set(e.label ?? "", arr)
        }
        for (const [, arr] of byType) {
          let bestId = arr[0].id
          let bestDx = Infinity
          for (const e of arr) {
            const ax = (e.from.x - S.cam.x) * S.cam.scale + S.w / 2
            const bx = (e.to.x - S.cam.x) * S.cam.scale + S.w / 2
            const mx = (ax + bx) / 2
            const dx = Math.abs(mx - S.w / 2)
            if (dx < bestDx) {
              bestDx = dx
              bestId = e.id
            }
          }
          labelEdgeId.add(bestId)
        }
      }
      for (const e of drawable) {
        const a = worldToScreen(e.from.x, e.from.y, S.cam, S.w, S.h)
        const b = worldToScreen(e.to.x, e.to.y, S.cam, S.w, S.h)
        const label = labelEdgeId.has(e.id) ? e.label : undefined
        drawEdge(edgeCtx!, a, b, 1, label)
      }
    }

    function drawNodes() {
      clear(nodeCtx!, S.w, S.h)
      if (!S.data) return
      for (const e of S.data.flat) {
        const sc = worldToScreen(e.x, e.y, S.cam, S.w, S.h)
        const appR = e.r * S.cam.scale
        const margin = 200 + appR
        if (sc.x < -margin || sc.x > S.w + margin) continue
        if (sc.y < -margin || sc.y > S.h + margin) continue
        if (appR < LOD.MIN_VISIBLE) continue
        if (appR < LOD.GLYPH_MIN) {
          drawDot(nodeCtx!, sc, e.color, 1)
          continue
        }
        drawLeafGlyph(nodeCtx!, e, sc, appR, {
          selected: e.isSelected,
          hover: S.hover === e,
          dim: 1,
          t: S.t,
        })
      }
    }

    function frame() {
      S.t = performance.now() - S.t0
      drawBackground()
      drawEdges()
      drawNodes()
      // Exit-on-zoom-out: once the user pulls the camera back past the
      // threshold, trigger a clean 2D→3D handoff. Suppressed while the
      // auto-fit animation is driving cam.scale — otherwise high-degree
      // centers would auto-fit through the threshold and bounce out
      // before the user has even seen the layout.
      if (
        !S.exitFired &&
        !S.autoFitInProgress &&
        S.data &&
        S.cam.scale < EXIT_ZOOM_THRESHOLD &&
        S.onExitZoom
      ) {
        S.exitFired = true
        S.onExitZoom()
      }
      S.rafId = requestAnimationFrame(frame)
    }
    S.rafId = requestAnimationFrame(frame)

    // ── input ──
    function getMousePos(ev: MouseEvent): { x: number; y: number } {
      const r = stage!.getBoundingClientRect()
      return { x: ev.clientX - r.left, y: ev.clientY - r.top }
    }

    function onMouseDown(ev: MouseEvent) {
      const m = getMousePos(ev)
      S.mouse.down = true
      S.mouse.dragStart = { x: m.x, y: m.y, camX: S.cam.x, camY: S.cam.y }
    }
    function onMouseMove(ev: MouseEvent) {
      const m = getMousePos(ev)
      S.mouse.x = m.x
      S.mouse.y = m.y
      if (S.mouse.down && S.mouse.dragStart) {
        const dx = m.x - S.mouse.dragStart.x
        const dy = m.y - S.mouse.dragStart.y
        S.cam.x = S.mouse.dragStart.camX - dx / S.cam.scale
        S.cam.y = S.mouse.dragStart.camY - dy / S.cam.scale
      } else {
        const hit = hitTest(m.x, m.y)
        S.hover = hit
        stage!.style.cursor = hit ? "pointer" : "default"
      }
    }
    function onMouseUp(ev: MouseEvent) {
      const m = getMousePos(ev)
      const wasDragging =
        S.mouse.dragStart &&
        (Math.abs(m.x - S.mouse.dragStart.x) > 3 ||
          Math.abs(m.y - S.mouse.dragStart.y) > 3)
      S.mouse.down = false
      S.mouse.dragStart = null
      if (!wasDragging) {
        const hit = hitTest(m.x, m.y)
        if (hit && !hit.isSelected && S.onNeighborClick) {
          S.onNeighborClick(hit)
        }
      }
    }
    function onWheel(ev: WheelEvent) {
      ev.preventDefault()
      const m = getMousePos(ev)
      // zoom toward the cursor — keeps the world point under the cursor fixed
      const worldBefore = screenToWorld(m.x, m.y, S.cam, S.w, S.h)
      const factor = Math.exp(-ev.deltaY * 0.0015)
      S.cam.scale = Math.max(0.02, Math.min(20, S.cam.scale * factor))
      const worldAfter = screenToWorld(m.x, m.y, S.cam, S.w, S.h)
      S.cam.x += worldBefore.x - worldAfter.x
      S.cam.y += worldBefore.y - worldAfter.y
    }

    stage.addEventListener("mousedown", onMouseDown)
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    stage.addEventListener("wheel", onWheel, { passive: false })

    return () => {
      cancelAnimationFrame(S.rafId)
      window.removeEventListener("resize", resize)
      stage.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
      stage.removeEventListener("wheel", onWheel)
    }
  }, [hitTest])

  const breadcrumb = useMemo(() => {
    if (!data) return ""
    return data.selected.name
  }, [data])

  return (
    <div
      ref={stageRef}
      className="relative h-full w-full overflow-hidden"
      style={{
        background: C.bg0,
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease-out`,
      }}
    >
      <canvas
        ref={bgRef}
        className="absolute inset-0 h-full w-full"
        style={{ pointerEvents: "none" }}
      />
      <canvas
        ref={edgeRef}
        className="absolute inset-0 h-full w-full"
        style={{ pointerEvents: "none" }}
      />
      <canvas
        ref={nodeRef}
        className="absolute inset-0 h-full w-full"
      />

      <div
        className="absolute left-4 top-4 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs"
        style={{
          background: C.panel,
          border: `1px solid ${C.panelBorder}`,
          color: C.ink,
          fontFamily: FONT_MONO,
          backdropFilter: "blur(8px)",
        }}
      >
        <span style={{ color: C.inkDim }}>CASE</span>
        <span style={{ color: C.selected }}>
          {breadcrumb}
        </span>
        {data && (
          <span style={{ color: C.inkDim }}>
            · {data.flat.length - 1} connected
          </span>
        )}
      </div>

      <button
        onClick={requestExit}
        title="Close (Esc)"
        className="absolute right-4 top-4 flex items-center justify-center rounded-md text-sm transition-colors"
        style={{
          background: C.panel,
          border: `1px solid ${C.panelBorder}`,
          color: C.ink,
          width: 36,
          height: 36,
          backdropFilter: "blur(8px)",
        }}
      >
        ✕
      </button>

      {loadError && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md px-4 py-2 text-sm"
          style={{
            background: C.panel,
            border: `1px solid ${C.panelBorder}`,
            color: C.warm,
            fontFamily: FONT_MONO,
          }}
        >
          {loadError}
        </div>
      )}

      {!data && !loadError && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md px-4 py-2 text-sm"
          style={{
            background: C.panel,
            border: `1px solid ${C.panelBorder}`,
            color: C.inkDim,
            fontFamily: FONT_MONO,
          }}
        >
          loading…
        </div>
      )}
    </div>
  )
}
