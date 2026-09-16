"use client"

// Neo4j Browser-style graph view: force-directed 2D layout, fixed-radius
// circles colored per label with captions underneath, straight/arced
// relationships with arrowheads and the type written along the line, a
// label/relationship legend, drag-to-pin, wheel zoom and drag-to-pan.
//
// Rendering is plain SVG. React owns the element structure (which nodes and
// relationships exist); positions and the viewport transform are written
// imperatively each simulation tick so a hot layout never re-renders React.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react"
import { Minus, Plus, Maximize, Scan, Hash, Quote, Box, BookOpen, Scissors, User, Building2, Radio, AtSign, Video, FileText, MapPin, Calendar, CircleDot, type LucideIcon } from "lucide-react"
import { getSchemaIcon } from "@/lib/schema-icons"
import type { GraphNode as ApiNode, GraphEdge as ApiEdge } from "@/lib/graph-api"
import type { SchemaNode } from "@/lib/schema-types"
import { useGraphStore } from "@/stores/graph-store"
import { resolveNodeTitle } from "@/lib/node-display"
import { isWebKit } from "@/lib/sphinx/detect"
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
  NEO4J_NEUTRAL_COLOR,
  NEO4J_NODE_RADIUS,
  NEO4J_RELATIONSHIP_COLOR,
  NEO4J_RELATIONSHIP_FONT_SIZE,
  type LabelColor,
} from "@/lib/neo4j-style"
import { HoverPreviewCard } from "./hover-preview-card"

const TYPE_ICONS: Record<string, LucideIcon> = {
  topic: Hash, claim: Quote, product: Box, chapter: BookOpen,
  clip: Scissors, person: User, organization: Building2,
  episode: Radio, show: Radio, tweet: AtSign, video: Video,
  document: FileText, place: MapPin, event: Calendar,
}

function typeIcon(type: string, schemas: SchemaNode[]): LucideIcon {
  // Known types use semantic icons; legacy schema icons can be unrelated
  // (for example, InterestsIcon renders a heart for a chapter).
  const semantic = TYPE_ICONS[type.toLowerCase()]
  if (semantic) return semantic
  const configured = schemas.find((schema) => schema.type.toLowerCase() === type.toLowerCase())?.icon
  return configured && configured !== "NodesIcon"
    ? getSchemaIcon(configured)
    : TYPE_ICONS[type.toLowerCase()] ?? CircleDot
}

interface N4Node extends SimNode {
  refId: string
  radius: number
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
const FIT_PADDING = 32
const FIT_MAX_ZOOM = 1.4
const DRAG_THRESHOLD_PX = 3
const LANE_SPACING = 28
const EDGE_LABEL_MIN_ZOOM = 0.85
const SELF_LOOP_SIZE = 40
// Angle between neighboring self-loops on one node, so each keeps its own arc and label.
const SELF_LOOP_SPREAD = (55 * Math.PI) / 180
// Simulation heat while a node is dragged. Neo4j Browser keeps the rest of the
// graph nearly still: low heat so only direct neighbors nudge, plus anchors
// (below) that tether every other node to where it was.
const DRAG_ALPHA = 0.1
// Heat used to settle an appended neighborhood, and the ring the new nodes
// start on around the node they attach to.
const APPEND_ALPHA = 0.5
const APPEND_RING_RADIUS = 150

function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`
}

function relKey(e: ApiEdge): string {
  return `${e.source} ${e.target} ${e.edge_type}`
}

function makeNode(api: ApiNode): N4Node {
  return {
    refId: api.ref_id,
    radius: R,
    type: api.node_type,
    api,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    fx: null,
    fy: null,
    r: R + 20,
    userPinned: false,
    heldForAppend: false,
  }
}

// Parallel relationships between one pair fan out into lanes so each stays
// visible; a single relationship stays straight. Lane sign is expressed in
// the pair's canonical (sorted) orientation and flipped per edge direction.
function assignLanes(rels: N4Rel[]) {
  const degrees = new Map<N4Node, Set<N4Node>>()
  for (const rel of rels) {
    if (!degrees.has(rel.source)) degrees.set(rel.source, new Set())
    if (!degrees.has(rel.target)) degrees.set(rel.target, new Set())
    degrees.get(rel.source)!.add(rel.target)
    degrees.get(rel.target)!.add(rel.source)
  }
  for (const [node, neighbors] of degrees) {
    node.radius = R + Math.min(22, Math.log2(Math.max(1, neighbors.size)) * 5)
    node.r = node.radius + 20
  }
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
    rels.map((r) => ({ source: simNodes.indexOf(r.source), target: simNodes.indexOf(r.target) })),
    { linkDistance: APPEND_RING_RADIUS, collidePadding: 12, gravity: 0.012, charge: -900 }
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
  if (!root) packComponents(simNodes, rels)
  return { nodes: simNodes, rels, byRef, sim }
}

// Pack disconnected components after settling, preserving each component's
// internal layout so isolated nodes cannot force the entire graph to zoom out.
function packComponents(nodes: N4Node[], rels: N4Rel[]) {
  const adjacency = new Map(nodes.map((n) => [n, new Set<N4Node>()]))
  for (const r of rels) {
    adjacency.get(r.source)!.add(r.target)
    adjacency.get(r.target)!.add(r.source)
  }
  const visited = new Set<N4Node>()
  const groups: N4Node[][] = []
  const isolated: N4Node[] = []
  for (const n of nodes) {
    if (visited.has(n)) continue
    const group = [n]
    visited.add(n)
    for (let i = 0; i < group.length; i++) {
      for (const next of adjacency.get(group[i])!) {
        if (!visited.has(next)) { visited.add(next); group.push(next) }
      }
    }
    if (group.length === 1) isolated.push(n)
    else groups.push(group)
  }
  if (isolated.length) {
    const columns = Math.ceil(Math.sqrt(isolated.length * 1.5))
    isolated.forEach((n, i) => { n.x = (i % columns) * 110; n.y = Math.floor(i / columns) * 110 })
    groups.push(isolated)
  }
  if (groups.length < 2) return
  const boxes = groups.map((group) => {
    const minX = Math.min(...group.map((n) => n.x))
    const minY = Math.min(...group.map((n) => n.y))
    return { group, minX, minY, width: Math.max(...group.map((n) => n.x)) - minX + 150, height: Math.max(...group.map((n) => n.y)) - minY + 150 }
  }).sort((a, b) => b.height - a.height)
  const targetWidth = Math.max(boxes[0].width, Math.sqrt(boxes.reduce((sum, b) => sum + b.width * b.height, 0)) * 1.4)
  let x = 0, y = 0, rowHeight = 0
  for (const box of boxes) {
    if (x > 0 && x + box.width > targetWidth) { y += rowHeight + 70; x = 0; rowHeight = 0 }
    for (const n of box.group) { n.x += x - box.minX; n.y += y - box.minY }
    x += box.width + 70
    rowHeight = Math.max(rowHeight, box.height)
  }
  const cx = (Math.min(...nodes.map((n) => n.x)) + Math.max(...nodes.map((n) => n.x))) / 2
  const cy = (Math.min(...nodes.map((n) => n.y)) + Math.max(...nodes.map((n) => n.y))) / 2
  for (const n of nodes) { n.x -= cx; n.y -= cy }
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
    // Loops fan out around the top of the node by lane: the loop is drawn
    // pointing up, then rotated to its direction; the label sits on its apex,
    // along the arc, kept upright.
    const direction = -Math.PI / 2 + r.curve * SELF_LOOP_SPREAD
    const cos = Math.cos(direction + Math.PI / 2)
    const sin = Math.sin(direction + Math.PI / 2)
    const at = (x: number, y: number) => `${s.x + x * cos - y * sin} ${s.y + x * sin + y * cos}`
    const top = -s.radius
    const d = `M ${at(-6, top + 2)} C ${at(-SELF_LOOP_SIZE, top - SELF_LOOP_SIZE)}, ${at(SELF_LOOP_SIZE, top - SELF_LOOP_SIZE)}, ${at(6, top + 2)}`
    const apex = s.radius + SELF_LOOP_SIZE * 0.75
    let labelAngle = (direction * 180) / Math.PI + 90
    if (labelAngle > 90) labelAngle -= 180
    if (labelAngle < -90) labelAngle += 180
    return { d, lx: s.x + Math.cos(direction) * apex, ly: s.y + Math.sin(direction) * apex, angle: labelAngle }
  }
  const dx = t.x - s.x
  const dy = t.y - s.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const ux = dx / len
  const uy = dy / len
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI
  if (angle > 90 || angle < -90) angle += 180

  if (r.curve === 0) {
    const sx = s.x + ux * s.radius
    const sy = s.y + uy * s.radius
    const tx = t.x - ux * t.radius
    const ty = t.y - uy * t.radius
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
  const sx = s.x + (sdx / sl) * s.radius
  const sy = s.y + (sdy / sl) * s.radius
  const tdx = cx - t.x
  const tdy = cy - t.y
  const tl = Math.sqrt(tdx * tdx + tdy * tdy) || 1
  const tx = t.x + (tdx / tl) * t.radius
  const ty = t.y + (tdy / tl) * t.radius
  // Point on the curve at t = 0.5.
  const lx = 0.25 * sx + 0.5 * cx + 0.25 * tx
  const ly = 0.25 * sy + 0.5 * cy + 0.25 * ty
  return { d: `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`, lx, ly, angle }
}

// Relationship stroke opacity. With a focused node, its own relationships are
// lit, the ones between its neighbors stay readable as context, and the rest
// fade out. Quiet (hierarchy) edges stay a step below real relationships.
function relOpacity(lit: boolean, quiet: boolean, focused: boolean, inNeighborhood: boolean): number {
  const rest = quiet ? 0.4 : 0.6
  if (lit) return quiet ? 0.8 : 1
  if (!focused) return rest
  return inNeighborhood ? rest * 0.75 : 0.18
}

type Gesture =
  | { kind: "pan"; startX: number; startY: number; tx: number; ty: number; moved: boolean }
  | { kind: "node"; node: N4Node; startX: number; startY: number; moved: boolean; wasPinned: boolean }

const EMPTY_CAPTION: string[] = [""]

// Palette color for a color group; a null group draws neutral grey.
function groupColor(group: string | null): LabelColor {
  return group === null ? NEO4J_NEUTRAL_COLOR : colorForLabel(group)
}

interface NodeGlyphProps {
  node: N4Node
  color: LabelColor
  lines: string[]
  selected: boolean
  hot: boolean
  pinned: boolean
  dimmed: boolean
  title: string
  prominent: boolean
  icon: LucideIcon
  register: (refId: string, el: SVGGElement | null) => void
  onPointerDown: (node: N4Node, e: React.PointerEvent<SVGGElement>) => void
  onEnter: (node: N4Node, e: React.PointerEvent) => void
  onLeave: () => void
  onDoubleClick: (node: N4Node, e: React.MouseEvent) => void
}

// One node: colored disc, caption underneath, selection halo, pin dot. Memoized so
// hover/selection changes only repaint the nodes whose props actually changed.
const NodeGlyph = memo(function NodeGlyph({
  node,
  color,
  lines,
  selected,
  hot,
  pinned,
  dimmed,
  title,
  prominent,
  icon: Icon,
  register,
  onPointerDown,
  onEnter,
  onLeave,
  onDoubleClick,
}: NodeGlyphProps) {
  return (
    <g
      ref={(el) => register(node.refId, el)}
      transform={`translate(${node.x} ${node.y})`}
      style={{ cursor: "pointer", opacity: dimmed ? 0.25 : 1, transition: "opacity 150ms" }}
      onPointerDown={(e) => onPointerDown(node, e)}
      onPointerEnter={(e) => onEnter(node, e)}
      onPointerLeave={onLeave}
      onDoubleClick={(e) => onDoubleClick(node, e)}
      data-node-ref={node.refId}
      data-node-type={node.type}
      data-prominent={prominent}
      data-active={hot || selected}
    >
      <title>{`${node.type}: ${title}`}</title>
      {selected && <circle r={node.radius + 6} fill="none" stroke={color.fill} strokeOpacity={0.35} strokeWidth={10} />}
      <circle r={node.radius + 5} fill={color.fill} fillOpacity={hot || selected ? 0.14 : 0.04} />
      <circle r={node.radius} fill={color.fill} fillOpacity={0.3} stroke={hot || selected ? "#ffffff" : color.fill} style={{ strokeWidth: `calc(${hot || selected ? 2 : 1.2}px * var(--ring-stroke, 1))` }} />
      <circle className="neo4j-node-dot" r={prominent ? 9 : 5} fill={color.fill} />
      <Icon className="neo4j-node-icon" x={-node.radius * 0.6} y={-node.radius * 0.6} width={node.radius * 1.2} height={node.radius * 1.2} color={color.fill} strokeWidth={1.8} aria-hidden="true" style={{ pointerEvents: "none" }} />
      <g className="neo4j-caption" style={{ transform: `translateY(${node.radius + 16}px) scale(var(--caption-scale, 1))`, pointerEvents: "none" }}>
      <text fill="var(--foreground)" fontSize={12} textAnchor="middle" style={{ pointerEvents: "none", stroke: "var(--background)", strokeWidth: 4, paintOrder: "stroke", strokeLinejoin: "round" }}>
        {lines.map((line, i) => (
          <tspan key={i} x={0} y={i * 14} dy="0.35em">
            {line}
          </tspan>
        ))}
      </text>
      </g>
      {pinned && <circle cx={node.radius * 0.7} cy={-node.radius * 0.7} r={3} fill="#ffffff" stroke={color.border} strokeWidth={1} />}
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
  /**
   * Standalone use outside the main graph (the ontology page): the layout
   * rebuilds whenever this key changes, and the canvas neither reads nor
   * writes the graph store — selection comes from `selectedRefId` instead.
   */
  layoutKey?: string
  selectedRefId?: string | null
  /**
   * Color + legend group per node ref_id; null draws the node neutral grey.
   * Defaults to each node's type.
   */
  nodeGroups?: Map<string, string | null>
  /** Relationship type drawn as a quiet skeleton: thin dashed line, no arrowhead, no label. */
  quietRelType?: string
  /** Every caption is a candidate (collision-culled in input order), not only the best-connected nodes'. */
  allCaptions?: boolean
}

export function Neo4jCanvas({
  nodes,
  edges,
  schemas,
  onNodeSelect,
  layoutRootRefId,
  layoutKey,
  selectedRefId: standaloneSelectedRefId = null,
  nodeGroups,
  quietRelType,
  allCaptions = false,
}: Neo4jCanvasProps) {
  const standalone = layoutKey !== undefined
  const dataVersion = useGraphStore((s) => s.dataVersion)
  const storeSelectedRefId = useGraphStore((s) => s.selectedNode?.ref_id ?? null)
  const storeSidebarSelectedRefId = useGraphStore((s) => s.sidebarSelectedNode?.ref_id ?? null)
  const storeSidebarHoveredRefId = useGraphStore((s) => s.hoveredNode?.ref_id ?? null)
  const selectedRefId = standalone ? standaloneSelectedRefId : storeSelectedRefId
  const sidebarSelectedRefId = standalone ? null : storeSidebarSelectedRefId
  const sidebarHoveredRefId = standalone ? null : storeSidebarHoveredRefId

  const containerRef = useRef<HTMLDivElement>(null)
  const zoomLabelRef = useRef<HTMLSpanElement>(null)
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

  // Full rebuild only on a new dataset (dataVersion bump, or a new layoutKey
  // when standalone); appends are folded into the live model below without
  // touching existing positions.
  const rebuildKey = standalone ? layoutKey : dataVersion
  const model = useMemo(
    () => buildModel(nodes, edges, layoutRootRefId),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nodes/edges/layoutRootRefId change together with the rebuild key
    [rebuildKey]
  )
  const [structVersion, setStructVersion] = useState(0)

  // WebKit leaves stale pixels ("ghost trails") behind SVG elements whose
  // transform attribute changes every frame, which is what the settle loop
  // does to every node. Promoting the whole <svg> to its own compositing
  // layer makes WebKit repaint it as a unit. Gated to WebKit because the
  // layer costs GPU memory and drops subpixel text AA, and Chromium doesn't
  // need it. Set in an effect so server and first client render match.
  const [compositeSvg, setCompositeSvg] = useState(false)
  useEffect(() => {
    setCompositeSvg(isWebKit())
  }, [])

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

  const updateLabelVisibility = useCallback(() => {
    const { k } = transform.current
    const scale = Math.min(4, Math.max(1, 0.85 / k))
    const occupied: { x: number; y: number; w: number; h: number }[] = []
    const candidates = model.nodes.map((n) => {
      const el = nodeEls.current.get(n.refId)
      return { n, el, active: el?.getAttribute("data-active") === "true", prominent: el?.getAttribute("data-prominent") === "true" }
    }).sort((a, b) => Number(b.active) - Number(a.active) || Number(b.prominent) - Number(a.prominent))
    for (const { n, el, active, prominent } of candidates) {
      el?.setAttribute("data-show-icon", String(n.radius * k >= 7))
      const label = el?.querySelector<SVGGElement>(".neo4j-caption")
      if (!label) continue
      const lines = [...label.querySelectorAll("tspan")]
      const w = Math.max(...lines.map((line) => (line.textContent?.length ?? 0) * 6.7)) * scale * k + 10
      const h = lines.length * 14 * scale * k + 8
      const box = { x: n.x * k - w / 2, y: (n.y + n.radius + 16) * k - 5, w, h }
      const collides = occupied.some((b) => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y)
      const visible = active || ((k >= 0.7 || prominent) && !collides)
      label.style.visibility = visible ? "visible" : "hidden"
      if (visible) occupied.push(box)
    }
  }, [model])

  useLayoutEffect(() => { updateLabelVisibility() })

  const applyTransform = useCallback(() => {
    const { x, y, k } = transform.current
    viewportRef.current?.setAttribute("transform", `translate(${x} ${y}) scale(${k})`)
    viewportRef.current?.setAttribute("data-overview", String(k < 0.7))
    viewportRef.current?.style.setProperty("--caption-scale", String(Math.min(4, Math.max(1, 0.85 / k))))
    // Ring stroke stays a constant screen width without vector-effect
    // non-scaling-stroke, whose paint-invalidation bounds are unreliable in
    // Chromium while a node is moved every frame (left ghost trails).
    viewportRef.current?.style.setProperty("--ring-stroke", String(1 / k))
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(k * 100)}%`
    updateLabelVisibility()
    if (relLabelsRef.current) {
      relLabelsRef.current.setAttribute("data-detailed", String(k >= EDGE_LABEL_MIN_ZOOM))
    }
  }, [updateLabelVisibility])

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
    updateLabelVisibility()
  }, [model, updateLabelVisibility])

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

  function zoomBy(factor: number) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const from = transform.current
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, from.k * factor))
    const cx = rect.width / 2
    const cy = rect.height / 2
    animateTransformTo({ x: cx - (cx - from.x) * k / from.k, y: cy - (cy - from.y) * k / from.k, k }, 180)
  }

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
        minX = Math.min(minX, n.x - 72)
        minY = Math.min(minY, n.y - n.radius)
        maxX = Math.max(maxX, n.x + 72)
        maxY = Math.max(maxY, n.y + n.radius + 44)
      }
      const bw = Math.max(1, maxX - minX)
      const bh = Math.max(1, maxY - minY)
      // Leave room for the view switch, right action rail, and bottom controls.
      const right = rect.width >= 400 ? 88 : FIT_PADDING
      const top = 64
      const bottom = 72
      const width = Math.max(1, rect.width - FIT_PADDING - right)
      const height = Math.max(1, rect.height - top - bottom)
      const k = Math.max(MIN_ZOOM, Math.min(FIT_MAX_ZOOM, width / bw, height / bh))
      const x = FIT_PADDING + width / 2 - ((minX + maxX) / 2) * k
      const y = top + height / 2 - ((minY + maxY) / 2) * k
      animateTransformTo({ x, y, k }, animate ? 350 : 0)
    },
    [model, animateTransformTo]
  )

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => fitToView(false))
    })
    observer.observe(svg)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [fitToView])

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
      if (!standalone) {
        const store = useGraphStore.getState()
        store.setSidebarSelectedNode(null)
        store.setHoveredNode(null)
      }
      onNodeSelect?.(node.api)
    },
    [onNodeSelect, standalone]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const g = gesture.current
      gesture.current = null
      if (!g) return
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      if (g.kind === "pan") {
        if (!g.moved && !standalone) {
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
    [ensureRunning, handleNodeClick, model, standalone]
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
    for (const n of model.nodes) m.set(n.refId, wrapCaption(resolveNodeTitle(n.api, schemas), 72, 2, 12))
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps -- structVersion tracks in-place growth of model.nodes
  }, [model, schemas, structVersion])

  const groupOf = useCallback(
    (n: N4Node): string | null => (nodeGroups ? nodeGroups.get(n.refId) ?? null : n.type),
    [nodeGroups]
  )

  const legend = useMemo(() => {
    const labels = new Map<string | null, number>()
    const relTypes = new Map<string, number>()
    for (const n of model.nodes) {
      const group = groupOf(n)
      labels.set(group, (labels.get(group) ?? 0) + 1)
    }
    for (const r of model.rels) {
      if (r.type !== quietRelType) relTypes.set(r.type, (relTypes.get(r.type) ?? 0) + 1)
    }
    return {
      labels: [...labels.entries()].sort((a, b) => b[1] - a[1]),
      relTypes: [...relTypes.entries()].sort((a, b) => b[1] - a[1]),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- structVersion tracks in-place growth
  }, [model, structVersion, groupOf, quietRelType])

  const highlightedRefs = useMemo(() => {
    const s = new Set<string>()
    if (selectedRefId) s.add(selectedRefId)
    if (sidebarSelectedRefId) s.add(sidebarSelectedRefId)
    return s
  }, [selectedRefId, sidebarSelectedRefId])

  const degrees = new Map<string, number>()
  for (const r of model.rels) {
    degrees.set(r.source.refId, (degrees.get(r.source.refId) ?? 0) + 1)
    degrees.set(r.target.refId, (degrees.get(r.target.refId) ?? 0) + 1)
  }
  const prominentRefs = new Set(
    [...model.nodes].sort((a, b) => (degrees.get(b.refId) ?? 0) - (degrees.get(a.refId) ?? 0))
      .slice(0, Math.min(12, Math.max(3, Math.ceil(model.nodes.length / 8))))
      .map((n) => n.refId)
  )
  const hotRef = hoveredRefId ?? sidebarHoveredRefId
  const focusRef = hotRef ?? selectedRefId ?? sidebarSelectedRefId
  const neighborhood = new Set<string>()
  if (focusRef && model.byRef.has(focusRef)) {
    neighborhood.add(focusRef)
    for (const r of model.rels) {
      if (r.source.refId === focusRef) neighborhood.add(r.target.refId)
      if (r.target.refId === focusRef) neighborhood.add(r.source.refId)
    }
  }

  return (
    <div ref={containerRef} className="relative h-full w-full select-none bg-background [&:fullscreen]:h-screen [&:fullscreen]:w-screen">
      <style>{`
         .neo4j-rel-labels[data-detailed="false"] text:not([data-active="true"]) { display: none; }
        [data-show-icon="false"] .neo4j-node-icon { display: none; }
        [data-show-icon="true"] .neo4j-node-dot { display: none; }
        [data-overview="true"] [data-prominent="false"][data-active="false"] .neo4j-caption { display: none; }

      `}</style>
      <svg
        ref={svgRef}
        className="h-full w-full touch-none"
        style={{ cursor: "grab", willChange: compositeSvg ? "transform" : undefined }}
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
              const quiet = r.type === quietRelType
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
                  strokeWidth={quiet ? (lit ? 1.5 : 1) : lit ? 2.5 : 1.5}
                  strokeOpacity={relOpacity(
                    lit,
                    quiet,
                    neighborhood.size > 0,
                    neighborhood.has(r.source.refId) && neighborhood.has(r.target.refId)
                  )}
                  strokeDasharray={quiet ? "4 4" : undefined}
                  markerEnd={quiet ? undefined : "url(#neo4j-arrow)"}
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
              if (r.type === quietRelType) return null
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
                  data-active={r.source.refId === focusRef || r.target.refId === focusRef}
                  opacity={
                    !neighborhood.size || r.source.refId === focusRef || r.target.refId === focusRef
                      ? 1
                      : neighborhood.has(r.source.refId) && neighborhood.has(r.target.refId)
                        ? 0.7
                        : 0.15
                  }
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
                color={groupColor(groupOf(n))}
                lines={captions.get(n.refId) ?? EMPTY_CAPTION}
                selected={highlightedRefs.has(n.refId)}
                hot={hotRef === n.refId}
                pinned={n.userPinned}
                title={resolveNodeTitle(n.api, schemas)}
                prominent={allCaptions || model.nodes.length <= 20 || prominentRefs.has(n.refId)}
                icon={typeIcon(n.type, schemas)}
                dimmed={neighborhood.size > 0 && !neighborhood.has(n.refId)}
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

      <details className="absolute bottom-4 left-4 z-20 max-w-[calc(100%-15rem)] rounded-lg border border-border/50 bg-background/95 text-xs backdrop-blur">
        <summary className="cursor-pointer px-3 py-2 text-muted-foreground">Legend · {legend.labels.length} {nodeGroups ? "groups" : "node types"}</summary>
        <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto p-3 pt-1">
        {legend.labels.map(([label, count]) => {
          const c = groupColor(label)
          const Icon = label === null ? CircleDot : typeIcon(label, schemas)
          return (
            <span
              key={`l:${label ?? ""}`}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-4"
              style={{ background: c.fill, color: c.text, border: `1px solid ${c.border}` }}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label ?? "Other"} ({count})
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
      </details>

      <div className="absolute bottom-4 right-4 z-20 flex items-center gap-0.5 rounded-lg border border-border/60 bg-background/95 p-1 text-muted-foreground shadow-lg backdrop-blur">
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / 1.4)} className="rounded-md p-2 hover:bg-muted hover:text-foreground"><Minus className="h-4 w-4" /></button>
        <span ref={zoomLabelRef} className="w-10 text-center font-mono text-[10px] tabular-nums">100%</span>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.4)} className="rounded-md p-2 hover:bg-muted hover:text-foreground"><Plus className="h-4 w-4" /></button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" aria-label="Fit graph" title="Fit graph" onClick={() => fitToView(true)} className="rounded-md p-2 hover:bg-muted hover:text-foreground"><Scan className="h-4 w-4" /></button>
        <button type="button" aria-label="Toggle fullscreen" title="Fullscreen" onClick={() => {
          if (document.fullscreenElement) void document.exitFullscreen()
          else void containerRef.current?.requestFullscreen().catch(() => {})
        }} className="rounded-md p-2 hover:bg-muted hover:text-foreground"><Maximize className="h-4 w-4" /></button>
      </div>

      <HoverPreviewCard node={hoverCardNode} schemas={schemas} x={cursor.x} y={cursor.y} />
    </div>
  )
}
