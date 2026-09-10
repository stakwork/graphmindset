"use client"

// Neo4j Browser-style graph view: force-directed 2D layout, fixed-radius
// circles colored per label with the caption inside, straight/arced
// relationships with arrowheads and the type written along the line, a
// label/relationship legend, drag-to-pin, wheel zoom and drag-to-pan.
//
// Rendering is plain SVG. React owns the element structure (which nodes and
// relationships exist); positions and the viewport transform are written
// imperatively each simulation tick so a hot layout never re-renders React.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react"
import type { GraphNode as ApiNode, GraphEdge as ApiEdge } from "@/lib/graph-api"
import type { SchemaNode } from "@/lib/schema-types"
import { useGraphStore } from "@/stores/graph-store"
import { resolveNodeTitle } from "@/lib/node-display"
import {
  DEFAULT_FORCE_CONFIG,
  ForceSimulation,
  phyllotaxisPosition,
  precomputeTicksFor,
  type SimNode,
} from "@/lib/force-layout"
import {
  colorForLabel,
  wrapCaption,
  NEO4J_NODE_RADIUS,
  NEO4J_CAPTION_FONT_SIZE,
  NEO4J_CAPTION_LINE_HEIGHT,
  NEO4J_RELATIONSHIP_COLOR,
  NEO4J_RELATIONSHIP_FONT_SIZE,
} from "@/lib/neo4j-style"
import { HoverPreviewCard } from "./hover-preview-card"

interface N4Node extends SimNode {
  refId: string
  type: string
  api: ApiNode
  /** Pinned by the user (dragged). Survives simulation reheats. */
  userPinned: boolean
  /** Temporarily held in place while appended neighbors settle. */
  heldForAppend: boolean
}

interface N4Rel {
  key: string
  source: N4Node
  target: N4Node
  type: string
  /** Lane offset for parallel relationships between the same pair (0 = straight). */
  curve: number
}

interface Model {
  nodes: N4Node[]
  rels: N4Rel[]
  byRef: Map<string, N4Node>
  sim: ForceSimulation<N4Node>
}

interface Transform {
  x: number
  y: number
  k: number
}

const R = NEO4J_NODE_RADIUS
const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const FIT_PADDING = 40
const FIT_MAX_ZOOM = 1.4
const DRAG_THRESHOLD_PX = 3
const LANE_SPACING = 28
const EDGE_LABEL_MIN_ZOOM = 0.45
const SELF_LOOP_SIZE = 40
// Simulation heat while a node is dragged. Neo4j Browser keeps the rest of the
// graph nearly still: low heat so only direct neighbors nudge, plus anchors
// (below) that tether every other node to where it was.
const DRAG_ALPHA = 0.1
// Heat used to settle an appended neighborhood, and the ring the new nodes
// start on around the node they attach to.
const APPEND_ALPHA = 0.5
const APPEND_RING_RADIUS = DEFAULT_FORCE_CONFIG.linkDistance

function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`
}

function relKey(e: ApiEdge): string {
  return `${e.source} ${e.target} ${e.edge_type}`
}

function makeNode(api: ApiNode): N4Node {
  return {
    refId: api.ref_id,
    type: api.node_type,
    api,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    fx: null,
    fy: null,
    r: R,
    userPinned: false,
    heldForAppend: false,
  }
}

// Parallel relationships between one pair fan out into lanes so each stays
// visible; a single relationship stays straight. Lane sign is expressed in
// the pair's canonical (sorted) orientation and flipped per edge direction.
function assignLanes(rels: N4Rel[]) {
  const groups = new Map<string, N4Rel[]>()
  for (const r of rels) {
    const k = pairKey(r.source.refId, r.target.refId)
    const g = groups.get(k)
    if (g) g.push(r)
    else groups.set(k, [r])
  }
  for (const g of groups.values()) {
    const n = g.length
    g.forEach((r, i) => {
      const lane = n === 1 ? 0 : i - (n - 1) / 2
      const canonical = r.source.refId < r.target.refId
      r.curve = canonical ? lane : -lane
    })
  }
}

function buildModel(nodes: ApiNode[], edges: ApiEdge[], rootRefId?: string): Model {
  const byRef = new Map<string, N4Node>()
  const simNodes: N4Node[] = []
  for (const api of nodes) {
    if (byRef.has(api.ref_id)) continue
    const n = makeNode(api)
    byRef.set(api.ref_id, n)
    simNodes.push(n)
  }

  const rels: N4Rel[] = []
  const seen = new Set<string>()
  for (const e of edges) {
    const s = byRef.get(e.source)
    const t = byRef.get(e.target)
    if (!s || !t) continue
    const k = relKey(e)
    if (seen.has(k)) continue
    seen.add(k)
    rels.push({ key: k, source: s, target: t, type: e.edge_type, curve: 0 })
  }
  assignLanes(rels)

  const root = rootRefId ? byRef.get(rootRefId) : undefined
  seedPositions(simNodes, rels, root)

  const sim = new ForceSimulation<N4Node>(
    simNodes,
    rels.map((r) => ({ source: simNodes.indexOf(r.source), target: simNodes.indexOf(r.target) }))
  )
  // Neo4j Browser precomputes the layout, so the graph appears already settled.
  if (root) {
    root.fx = 0
    root.fy = 0
  }
  sim.precompute(precomputeTicksFor(simNodes.length))
  if (root) {
    root.fx = null
    root.fy = null
  }
  return { nodes: simNodes, rels, byRef, sim }
}

// Starting positions: BFS rings from the root (focus graphs), a phyllotaxis
// spiral otherwise. Only a seed - the simulation does the real work.
function seedPositions(nodes: N4Node[], rels: N4Rel[], root?: N4Node) {
  if (!root) {
    nodes.forEach((n, i) => {
      const p = phyllotaxisPosition(i, R * 1.6)
      n.x = p.x
      n.y = p.y
    })
    return
  }
  const adj = new Map<N4Node, N4Node[]>()
  for (const r of rels) {
    if (!adj.has(r.source)) adj.set(r.source, [])
    if (!adj.has(r.target)) adj.set(r.target, [])
    adj.get(r.source)!.push(r.target)
    adj.get(r.target)!.push(r.source)
  }
  const depth = new Map<N4Node, number>([[root, 0]])
  const queue = [root]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const nb of adj.get(cur) ?? []) {
      if (depth.has(nb)) continue
      depth.set(nb, depth.get(cur)! + 1)
      queue.push(nb)
    }
  }
  const rings = new Map<number, N4Node[]>()
  let maxDepth = 0
  for (const n of nodes) {
    const d = depth.get(n) ?? -1
    maxDepth = Math.max(maxDepth, d)
    if (!rings.has(d)) rings.set(d, [])
    rings.get(d)!.push(n)
  }
  root.x = 0
  root.y = 0
  for (const [d, ring] of rings) {
    if (d === 0) continue
    const level = d === -1 ? maxDepth + 1 : d
    const radius = Math.max(level * R * 4, (ring.length * R * 2.4) / (2 * Math.PI))
    ring.forEach((n, i) => {
      const a = (i / ring.length) * Math.PI * 2 + level * 0.5
      n.x = radius * Math.cos(a)
      n.y = radius * Math.sin(a)
    })
  }
}

// Fold newly arrived nodes/relationships into the live model. Existing nodes
// stay exactly where they are (held in place while the simulation runs), new
// ones spawn beside the neighbor they attach to and settle around it.
function appendToModel(model: Model, nodes: ApiNode[], edges: ApiEdge[]): boolean {
  const fresh: N4Node[] = []
  for (const api of nodes) {
    if (model.byRef.has(api.ref_id)) continue
    const n = makeNode(api)
    model.byRef.set(api.ref_id, n)
    model.nodes.push(n)
    fresh.push(n)
  }

  const known = new Set(model.rels.map((r) => r.key))
  let addedRels = false
  for (const e of edges) {
    const k = relKey(e)
    if (known.has(k)) continue
    const s = model.byRef.get(e.source)
    const t = model.byRef.get(e.target)
    if (!s || !t) continue
    known.add(k)
    model.rels.push({ key: k, source: s, target: t, type: e.edge_type, curve: 0 })
    addedRels = true
  }
  if (fresh.length === 0 && !addedRels) return false
  if (addedRels) assignLanes(model.rels)

  // Group the new nodes by the placed node they attach to, then fan each
  // group out on that node's open side (away from its existing neighbors) at
  // link distance. This respects the drawing that is already there: nothing
  // spawns on top of a node, and nothing has to fly across the graph to
  // reach free space.
  const freshSet = new Set(fresh)
  const placed = model.nodes.filter((n) => !freshSet.has(n))
  const centroid = { x: 0, y: 0 }
  for (const n of placed) {
    centroid.x += n.x
    centroid.y += n.y
  }
  if (placed.length > 0) {
    centroid.x /= placed.length
    centroid.y /= placed.length
  }

  const groups = new Map<N4Node | null, N4Node[]>()
  for (const n of fresh) {
    let anchor: N4Node | null = null
    for (const r of model.rels) {
      if (r.source === n && !freshSet.has(r.target)) {
        anchor = r.target
        break
      }
      if (r.target === n && !freshSet.has(r.source)) {
        anchor = r.source
        break
      }
    }
    const g = groups.get(anchor)
    if (g) g.push(n)
    else groups.set(anchor, [n])
  }

  for (const [anchor, group] of groups) {
    const origin = anchor ?? centroid
    // Open direction: away from the mean of the anchor's placed neighbors,
    // falling back to "away from the graph's centroid", then straight up.
    let dx = 0
    let dy = 0
    if (anchor) {
      let count = 0
      for (const r of model.rels) {
        const other: N4Node | null =
          r.source === anchor ? r.target : r.target === anchor ? r.source : null
        if (!other || other === anchor || freshSet.has(other)) continue
        dx += anchor.x - other.x
        dy += anchor.y - other.y
        count++
      }
      if (count === 0 || Math.hypot(dx, dy) < 1) {
        dx = anchor.x - centroid.x
        dy = anchor.y - centroid.y
      }
    }
    if (Math.hypot(dx, dy) < 1) {
      dx = 0
      dy = -1
    }
    const open = Math.atan2(dy, dx)
    const k = group.length
    const slot = R * 2 + 12
    // Fan of at most a half circle; widen the ring when the group is big.
    const radius = Math.max(APPEND_RING_RADIUS, (k * slot) / Math.PI)
    const step = slot / radius
    const fan = step * (k - 1)
    group.forEach((n, i) => {
      const a = open - fan / 2 + step * i
      n.x = origin.x + Math.cos(a) * radius
      n.y = origin.y + Math.sin(a) * radius
    })
  }

  for (const n of placed) {
    if (n.userPinned) continue
    n.heldForAppend = true
    n.fx = n.x
    n.fy = n.y
  }

  // Settle the new nodes in: gravity off so they aren't dragged toward the
  // origin across the held graph, moderate heat so they slide rather than
  // explode. releaseHeldNodes restores gravity once the simulation cools.
  model.sim.cfg.gravity = 0
  const index = new Map(model.nodes.map((n, i) => [n, i] as const))
  model.sim.nodes = model.nodes
  model.sim.links = model.rels.map((r) => ({ source: index.get(r.source)!, target: index.get(r.target)! }))
  model.sim.recount()
  model.sim.reheat(APPEND_ALPHA)
  return true
}

function releaseHeldNodes(model: Model) {
  model.sim.cfg.gravity = DEFAULT_FORCE_CONFIG.gravity
  for (const n of model.nodes) {
    if (n.heldForAppend) {
      n.heldForAppend = false
      n.fx = null
      n.fy = null
    }
    n.anchorX = null
    n.anchorY = null
  }
}

// Tether every node except `dragged` to its current spot for the duration of
// a drag (and the cool-down after it, cleared by releaseHeldNodes).
function anchorAllExcept(model: Model, dragged: N4Node) {
  for (const n of model.nodes) {
    if (n === dragged) continue
    n.anchorX = n.x
    n.anchorY = n.y
  }
}

// Geometry for one relationship: path from the source rim to the target rim
// (arrowhead tip lands on the rim), plus the label anchor + rotation.
function relGeometry(r: N4Rel): { d: string; lx: number; ly: number; angle: number } {
  const s = r.source
  const t = r.target
  if (s === t) {
    const top = s.y - R
    const d = `M ${s.x - 6} ${top + 2} C ${s.x - SELF_LOOP_SIZE} ${top - SELF_LOOP_SIZE}, ${s.x + SELF_LOOP_SIZE} ${top - SELF_LOOP_SIZE}, ${s.x + 6} ${top + 2}`
    return { d, lx: s.x, ly: top - SELF_LOOP_SIZE * 0.75, angle: 0 }
  }
  const dx = t.x - s.x
  const dy = t.y - s.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const ux = dx / len
  const uy = dy / len
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI
  if (angle > 90 || angle < -90) angle += 180

  if (r.curve === 0) {
    const sx = s.x + ux * R
    const sy = s.y + uy * R
    const tx = t.x - ux * R
    const ty = t.y - uy * R
    return { d: `M ${sx} ${sy} L ${tx} ${ty}`, lx: (sx + tx) / 2, ly: (sy + ty) / 2, angle }
  }

  // Quadratic arc bulging sideways by the lane offset.
  const nx = -uy
  const ny = ux
  const bulge = r.curve * LANE_SPACING
  const cx = (s.x + t.x) / 2 + nx * bulge
  const cy = (s.y + t.y) / 2 + ny * bulge
  const sdx = cx - s.x
  const sdy = cy - s.y
  const sl = Math.sqrt(sdx * sdx + sdy * sdy) || 1
  const sx = s.x + (sdx / sl) * R
  const sy = s.y + (sdy / sl) * R
  const tdx = cx - t.x
  const tdy = cy - t.y
  const tl = Math.sqrt(tdx * tdx + tdy * tdy) || 1
  const tx = t.x + (tdx / tl) * R
  const ty = t.y + (tdy / tl) * R
  // Point on the curve at t = 0.5.
  const lx = 0.25 * sx + 0.5 * cx + 0.25 * tx
  const ly = 0.25 * sy + 0.5 * cy + 0.25 * ty
  return { d: `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`, lx, ly, angle }
}

type Gesture =
  | { kind: "pan"; startX: number; startY: number; tx: number; ty: number; moved: boolean }
  | { kind: "node"; node: N4Node; startX: number; startY: number; moved: boolean; wasPinned: boolean }

const EMPTY_CAPTION: string[] = [""]

interface NodeGlyphProps {
  node: N4Node
  lines: string[]
  selected: boolean
  hot: boolean
  pinned: boolean
  register: (refId: string, el: SVGGElement | null) => void
  onPointerDown: (node: N4Node, e: React.PointerEvent<SVGGElement>) => void
  onEnter: (node: N4Node, e: React.PointerEvent) => void
  onLeave: () => void
  onDoubleClick: (node: N4Node, e: React.MouseEvent) => void
}

// One node: colored disc, caption inside, selection halo, pin dot. Memoized so
// hover/selection changes only repaint the nodes whose props actually changed.
const NodeGlyph = memo(function NodeGlyph({
  node,
  lines,
  selected,
  hot,
  pinned,
  register,
  onPointerDown,
  onEnter,
  onLeave,
  onDoubleClick,
}: NodeGlyphProps) {
  const color = colorForLabel(node.type)
  return (
    <g
      ref={(el) => register(node.refId, el)}
      transform={`translate(${node.x} ${node.y})`}
      style={{ cursor: "pointer" }}
      onPointerDown={(e) => onPointerDown(node, e)}
      onPointerEnter={(e) => onEnter(node, e)}
      onPointerLeave={onLeave}
      onDoubleClick={(e) => onDoubleClick(node, e)}
      data-node-ref={node.refId}
      data-node-type={node.type}
    >
      {selected && <circle r={R + 6} fill="none" stroke={color.fill} strokeOpacity={0.35} strokeWidth={10} />}
      <circle r={R} fill={color.fill} stroke={hot || selected ? "#ffffff" : color.border} strokeWidth={hot ? 3 : 2} />
      <text fill={color.text} fontSize={NEO4J_CAPTION_FONT_SIZE} textAnchor="middle" style={{ pointerEvents: "none" }}>
        {lines.map((line, i) => (
          <tspan key={i} x={0} y={(i - (lines.length - 1) / 2) * NEO4J_CAPTION_LINE_HEIGHT} dy="0.35em">
            {line}
          </tspan>
        ))}
      </text>
      {pinned && <circle cx={R * 0.7} cy={-R * 0.7} r={3} fill="#ffffff" stroke={color.border} strokeWidth={1} />}
    </g>
  )
})

interface Neo4jCanvasProps {
  nodes: ApiNode[]
  edges: ApiEdge[]
  schemas: SchemaNode[]
  onNodeSelect?: (node: ApiNode) => void
  /** Focus graph: this node starts at the center and the view fits the whole graph. */
  layoutRootRefId?: string
}

export function Neo4jCanvas({ nodes, edges, schemas, onNodeSelect, layoutRootRefId }: Neo4jCanvasProps) {
  const dataVersion = useGraphStore((s) => s.dataVersion)
  const selectedRefId = useGraphStore((s) => s.selectedNode?.ref_id ?? null)
  const sidebarSelectedRefId = useGraphStore((s) => s.sidebarSelectedNode?.ref_id ?? null)
  const sidebarHoveredRefId = useGraphStore((s) => s.hoveredNode?.ref_id ?? null)

  const svgRef = useRef<SVGSVGElement>(null)
  const viewportRef = useRef<SVGGElement>(null)
  const relLabelsRef = useRef<SVGGElement>(null)
  const nodeEls = useRef(new Map<string, SVGGElement>())
  const relEls = useRef(new Map<string, { path: SVGPathElement | null; label: SVGTextElement | null }>())
  const transform = useRef<Transform>({ x: 0, y: 0, k: 1 })
  const rafRef = useRef<number | null>(null)
  const fitAnimRef = useRef<number | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const dragging = useRef(false)

  // Full rebuild only on a new dataset (dataVersion bump); appends are folded
  // into the live model below without touching existing positions.
  const model = useMemo(
    () => buildModel(nodes, edges, layoutRootRefId),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nodes/edges/layoutRootRefId change together with dataVersion
    [dataVersion]
  )
  const [structVersion, setStructVersion] = useState(0)

  const [hoveredRefId, setHoveredRefId] = useState<string | null>(null)
  const [hoverCardNode, setHoverCardNode] = useState<ApiNode | null>(null)
  // Cursor is only tracked while a hover card is up, so plain mouse travel
  // over a few hundred SVG nodes never re-renders the tree.
  const [cursor, setCursor] = useState({ x: 0, y: 0 })
  const hoverCardOpen = useRef(false)
  hoverCardOpen.current = hoverCardNode !== null
  // Pin state lives on the mutable sim node; bump to repaint the pin dot.
  const [, repaint] = useReducer((v: number) => v + 1, 0)

  const registerNodeEl = useCallback((refId: string, el: SVGGElement | null) => {
    if (el) nodeEls.current.set(refId, el)
    else nodeEls.current.delete(refId)
  }, [])

  const applyTransform = useCallback(() => {
    const { x, y, k } = transform.current
    viewportRef.current?.setAttribute("transform", `translate(${x} ${y}) scale(${k})`)
    if (relLabelsRef.current) {
      relLabelsRef.current.style.display = k < EDGE_LABEL_MIN_ZOOM ? "none" : ""
    }
  }, [])

  const applyPositions = useCallback(() => {
    for (const n of model.nodes) {
      nodeEls.current.get(n.refId)?.setAttribute("transform", `translate(${n.x} ${n.y})`)
    }
    for (const r of model.rels) {
      const els = relEls.current.get(r.key)
      if (!els) continue
      const g = relGeometry(r)
      els.path?.setAttribute("d", g.d)
      els.label?.setAttribute("transform", `translate(${g.lx} ${g.ly}) rotate(${g.angle})`)
    }
  }, [model])

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const ensureRunning = useCallback(() => {
    if (rafRef.current !== null) return
    const step = () => {
      const hot = model.sim.tick()
      applyPositions()
      if (hot) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = null
        releaseHeldNodes(model)
      }
    }
    rafRef.current = requestAnimationFrame(step)
  }, [model, applyPositions])

  const animateTransformTo = useCallback(
    (to: Transform, ms = 350) => {
      if (fitAnimRef.current !== null) cancelAnimationFrame(fitAnimRef.current)
      const from = { ...transform.current }
      if (ms <= 0) {
        transform.current = to
        applyTransform()
        return
      }
      const start = performance.now()
      const frame = (now: number) => {
        const p = Math.min(1, (now - start) / ms)
        const e = 1 - Math.pow(1 - p, 3)
        transform.current = {
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
          k: from.k + (to.k - from.k) * e,
        }
        applyTransform()
        fitAnimRef.current = p < 1 ? requestAnimationFrame(frame) : null
      }
      fitAnimRef.current = requestAnimationFrame(frame)
    },
    [applyTransform]
  )

  const fitToView = useCallback(
    (animate = true) => {
      const svg = svgRef.current
      if (!svg || model.nodes.length === 0) return
      const rect = svg.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const n of model.nodes) {
        minX = Math.min(minX, n.x - R)
        minY = Math.min(minY, n.y - R)
        maxX = Math.max(maxX, n.x + R)
        maxY = Math.max(maxY, n.y + R)
      }
      const bw = Math.max(1, maxX - minX)
      const bh = Math.max(1, maxY - minY)
      const k = Math.max(
        MIN_ZOOM,
        Math.min(FIT_MAX_ZOOM, (rect.width - FIT_PADDING * 2) / bw, (rect.height - FIT_PADDING * 2) / bh)
      )
      const x = rect.width / 2 - ((minX + maxX) / 2) * k
      const y = rect.height / 2 - ((minY + maxY) / 2) * k
      animateTransformTo({ x, y, k }, animate ? 350 : 0)
    },
    [model, animateTransformTo]
  )

  // New dataset: lay positions into the DOM, fit, and stop any old loop.
  useLayoutEffect(() => {
    stopLoop()
    applyPositions()
    fitToView(false)
    if (model.sim.active) ensureRunning()
    return stopLoop
  }, [model, applyPositions, fitToView, ensureRunning, stopLoop])

  // Appends (neighbor fetch after a click): grow the model in place.
  const countsRef = useRef({ nodes: nodes.length, edges: edges.length, model })
  useEffect(() => {
    const last = countsRef.current
    if (last.model !== model) {
      countsRef.current = { nodes: nodes.length, edges: edges.length, model }
      return
    }
    if (nodes.length <= last.nodes && edges.length <= last.edges) return
    countsRef.current = { nodes: nodes.length, edges: edges.length, model }
    if (appendToModel(model, nodes, edges)) {
      setStructVersion((v) => v + 1)
    }
  }, [nodes, edges, model])

  // After React has mounted new elements for appended nodes, position them
  // and let the simulation settle them in.
  useLayoutEffect(() => {
    applyPositions()
    if (model.sim.active) ensureRunning()
  }, [structVersion, model, applyPositions, ensureRunning])

  useEffect(
    () => () => {
      stopLoop()
      if (fitAnimRef.current !== null) cancelAnimationFrame(fitAnimRef.current)
    },
    [stopLoop]
  )

  // Wheel zoom about the cursor. Native listener: React registers wheel as
  // passive, so preventDefault (to stop page scroll) needs a manual one.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (fitAnimRef.current !== null) {
        cancelAnimationFrame(fitAnimRef.current)
        fitAnimRef.current = null
      }
      const rect = svg.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const t = transform.current
      const factor = Math.exp(-e.deltaY * 0.0015)
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k * factor))
      const ratio = k / t.k
      transform.current = { x: px - (px - t.x) * ratio, y: py - (py - t.y) * ratio, k }
      applyTransform()
    }
    svg.addEventListener("wheel", onWheel, { passive: false })
    return () => svg.removeEventListener("wheel", onWheel)
  }, [applyTransform])

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    const t = transform.current
    const px = clientX - (rect?.left ?? 0)
    const py = clientY - (rect?.top ?? 0)
    return { x: (px - t.x) / t.k, y: (py - t.y) / t.k }
  }, [])

  const onBackgroundPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const t = transform.current
    gesture.current = { kind: "pan", startX: e.clientX, startY: e.clientY, tx: t.x, ty: t.y, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onNodePointerDown = useCallback((node: N4Node, e: React.PointerEvent<SVGGElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    gesture.current = {
      kind: "node",
      node,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      wasPinned: node.userPinned,
    }
    svgRef.current?.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (hoverCardOpen.current) setCursor({ x: e.clientX, y: e.clientY })
      const g = gesture.current
      if (!g) return
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      g.moved = true
      if (g.kind === "pan") {
        transform.current = { ...transform.current, x: g.tx + dx, y: g.ty + dy }
        applyTransform()
        return
      }
      if (!dragging.current) {
        dragging.current = true
        setHoverCardNode(null)
        anchorAllExcept(model, g.node)
        model.sim.alphaTarget = DRAG_ALPHA
        model.sim.reheat(DRAG_ALPHA)
        ensureRunning()
      }
      const w = toWorld(e.clientX, e.clientY)
      g.node.fx = w.x
      g.node.fy = w.y
      g.node.x = w.x
      g.node.y = w.y
    },
    [applyTransform, ensureRunning, model, toWorld]
  )

  const handleNodeClick = useCallback(
    (node: N4Node) => {
      const store = useGraphStore.getState()
      store.setSidebarSelectedNode(null)
      store.setHoveredNode(null)
      onNodeSelect?.(node.api)
    },
    [onNodeSelect]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const g = gesture.current
      gesture.current = null
      if (!g) return
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      if (g.kind === "pan") {
        if (!g.moved) {
          const store = useGraphStore.getState()
          store.setSidebarSelectedNode(null)
          store.setHoveredNode(null)
        }
        return
      }
      if (g.moved) {
        // Neo4j keeps a dragged node where you left it.
        dragging.current = false
        g.node.userPinned = true
        model.sim.alphaTarget = 0
        ensureRunning()
        repaint()
        return
      }
      if (!g.wasPinned) {
        g.node.fx = null
        g.node.fy = null
      }
      handleNodeClick(g.node)
    },
    [ensureRunning, handleNodeClick, model]
  )

  const onNodeDoubleClick = useCallback(
    (node: N4Node, e: React.MouseEvent) => {
      e.stopPropagation()
      if (!node.userPinned) return
      node.userPinned = false
      node.fx = null
      node.fy = null
      // Let the released node drift back while everything else stays put.
      anchorAllExcept(model, node)
      model.sim.reheat(DRAG_ALPHA)
      ensureRunning()
      repaint()
    },
    [ensureRunning, model]
  )

  const onNodeEnter = useCallback((node: N4Node, e: React.PointerEvent) => {
    if (dragging.current || gesture.current) return
    setCursor({ x: e.clientX, y: e.clientY })
    setHoveredRefId(node.refId)
    setHoverCardNode(node.api)
  }, [])

  const onNodeLeave = useCallback(() => {
    setHoveredRefId(null)
    setHoverCardNode(null)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") fitToView(true)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [fitToView])

  const captions = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const n of model.nodes) m.set(n.refId, wrapCaption(resolveNodeTitle(n.api, schemas)))
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps -- structVersion tracks in-place growth of model.nodes
  }, [model, schemas, structVersion])

  const legend = useMemo(() => {
    const labels = new Map<string, number>()
    const relTypes = new Map<string, number>()
    for (const n of model.nodes) labels.set(n.type, (labels.get(n.type) ?? 0) + 1)
    for (const r of model.rels) relTypes.set(r.type, (relTypes.get(r.type) ?? 0) + 1)
    return {
      labels: [...labels.entries()].sort((a, b) => b[1] - a[1]),
      relTypes: [...relTypes.entries()].sort((a, b) => b[1] - a[1]),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- structVersion tracks in-place growth
  }, [model, structVersion])

  const highlightedRefs = useMemo(() => {
    const s = new Set<string>()
    if (selectedRefId) s.add(selectedRefId)
    if (sidebarSelectedRefId) s.add(sidebarSelectedRefId)
    return s
  }, [selectedRefId, sidebarSelectedRefId])

  const hotRef = hoveredRefId ?? sidebarHoveredRefId

  return (
    <div className="relative h-full w-full select-none">
      <svg
        ref={svgRef}
        className="h-full w-full touch-none"
        style={{ cursor: "grab" }}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHoverCardNode(null)}
        data-testid="neo4j-canvas"
      >
        <defs>
          <marker
            id="neo4j-arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={NEO4J_RELATIONSHIP_COLOR} />
          </marker>
        </defs>
        <g ref={viewportRef}>
          <g className="neo4j-rels" fill="none" stroke={NEO4J_RELATIONSHIP_COLOR} strokeWidth={1}>
            {model.rels.map((r) => {
              const lit =
                highlightedRefs.has(r.source.refId) ||
                highlightedRefs.has(r.target.refId) ||
                (hotRef !== null && (r.source.refId === hotRef || r.target.refId === hotRef))
              const g = relGeometry(r)
              return (
                <path
                  key={r.key}
                  ref={(el) => {
                    const cur = relEls.current.get(r.key) ?? { path: null, label: null }
                    cur.path = el
                    relEls.current.set(r.key, cur)
                  }}
                  d={g.d}
                  strokeWidth={lit ? 2 : 1}
                  strokeOpacity={lit ? 1 : 0.85}
                  markerEnd="url(#neo4j-arrow)"
                />
              )
            })}
          </g>
          <g
            ref={relLabelsRef}
            className="neo4j-rel-labels"
            fontSize={NEO4J_RELATIONSHIP_FONT_SIZE}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fill={NEO4J_RELATIONSHIP_COLOR}
            textAnchor="middle"
            style={{ pointerEvents: "none" }}
          >
            {model.rels.map((r) => {
              const g = relGeometry(r)
              return (
                <text
                  key={r.key}
                  ref={(el) => {
                    const cur = relEls.current.get(r.key) ?? { path: null, label: null }
                    cur.label = el
                    relEls.current.set(r.key, cur)
                  }}
                  transform={`translate(${g.lx} ${g.ly}) rotate(${g.angle})`}
                  dy="0.32em"
                  style={{ stroke: "var(--background)", strokeWidth: 3, paintOrder: "stroke", strokeLinejoin: "round" }}
                >
                  {r.type}
                </text>
              )
            })}
          </g>
          <g className="neo4j-nodes" fontFamily="ui-sans-serif, system-ui, sans-serif">
            {model.nodes.map((n) => (
              <NodeGlyph
                key={n.refId}
                node={n}
                lines={captions.get(n.refId) ?? EMPTY_CAPTION}
                selected={highlightedRefs.has(n.refId)}
                hot={hotRef === n.refId}
                pinned={n.userPinned}
                register={registerNodeEl}
                onPointerDown={onNodePointerDown}
                onEnter={onNodeEnter}
                onLeave={onNodeLeave}
                onDoubleClick={onNodeDoubleClick}
              />
            ))}
          </g>
        </g>
      </svg>

      <div className="absolute bottom-4 left-4 right-24 z-20 flex flex-wrap items-center gap-1.5 pointer-events-none">
        {legend.labels.map(([label, count]) => {
          const c = colorForLabel(label)
          return (
            <span
              key={`l:${label}`}
              className="rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-4"
              style={{ background: c.fill, color: c.text, border: `1px solid ${c.border}` }}
            >
              {label} ({count})
            </span>
          )
        })}
        {legend.relTypes.map(([type, count]) => (
          <span
            key={`r:${type}`}
            className="rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-4"
            style={{ background: NEO4J_RELATIONSHIP_COLOR, color: "#2A2C34", border: "1px solid #8d939e" }}
          >
            {type} ({count})
          </span>
        ))}
      </div>

      <button
        onClick={() => fitToView(true)}
        className="absolute bottom-4 right-4 z-20 rounded-md bg-background/80 px-3 py-1.5 text-xs text-foreground backdrop-blur hover:bg-background"
      >
        Fit
      </button>

      <HoverPreviewCard node={hoverCardNode} schemas={schemas} x={cursor.x} y={cursor.y} />
    </div>
  )
}
