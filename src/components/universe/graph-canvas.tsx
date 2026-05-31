"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { CameraControls, Html } from "@react-three/drei"
import { EffectComposer, Bloom } from "@react-three/postprocessing"
import { Vector3 } from "three"
import * as THREE from "three"
import CameraControlsImpl from "camera-controls"
import {
  buildGraph,
  computeRadialLayout,
  extractInitialSubgraph,
  extractSubgraph,
  VIRTUAL_CENTER,
  GraphView,
  OffscreenIndicators,
  PrevNodeIndicator,
} from "@/graph-viz-kit"
import type { Graph, ViewState, RawNode, RawEdge } from "@/graph-viz-kit"
import type { GraphNode as ApiNode, GraphEdge as ApiEdge } from "@/lib/graph-api"
import { useGraphStore } from "@/stores/graph-store"
import { useAppStore } from "@/stores/app-store"
import type { SchemaNode } from "@/app/ontology/page"
import { HoverPreviewCard } from "./hover-preview-card"
import {
  NodeMorph,
  CaseBoardAnimator,
  useCaseBoardStore,
  GroupMorph,
  computeBalancedLayout,
} from "@/components/case-board"
import { DISPLAY_KEY_FALLBACKS } from "@/lib/node-display"
import { metroSeries } from "@/data/metro"
import {
  MetroLinesLayer,
  MetroStationBullets,
  MetroLegend,
  METRO_FORCE_GROUPED_TYPES,
  LORE_Y_LIFT,
  statusToState,
  type StationState,
} from "./metro-overlay"

function nodeLabel(node: ApiNode, schemas: SchemaNode[]): string {
  const props = node.properties
  const schema = schemas.find((s) => s.type === node.node_type)

  if (schema?.title_key) {
    const v = props?.[schema.title_key]
    if (typeof v === "string" && v.length > 0) return v
  }
  if (schema?.index) {
    const v = props?.[schema.index]
    if (typeof v === "string" && v.length > 0) return v
  }
  if (props) {
    for (const key of DISPLAY_KEY_FALLBACKS) {
      const v = props[key]
      if (typeof v === "string" && v.length > 0) return v
    }
  }
  return node.ref_id
}

const MAX_LABEL_LENGTH = 30

function truncateLabel(label: string): string {
  return label.length > MAX_LABEL_LENGTH ? label.slice(0, MAX_LABEL_LENGTH) + "\u2026" : label
}

// When a single source has this many neighbors of the same (edge_type,
// target_type), insert a synthetic cluster junction so the bundle reads as
// "source → cluster → 20 leaves" instead of 20 individual lines fanning out.
const CLUSTER_THRESHOLD = 5

// Edge types whose data direction is "child → parent" — flip them so the
// hierarchy reads parent → child. The container/originator should end up
// as the visual parent:
//   SOURCE        Claim → Chapter         (Chapter is the source, parent of the claim)
//   MENTIONED_IN  Product/Topic → Section (Section is the container, parent of the mention)
const INVERT_FOR_HIERARCHY = new Set(["SOURCE", "MENTIONED_IN"])

function apiToGraph(
  nodes: ApiNode[],
  edges: ApiEdge[],
  schemas: SchemaNode[]
): {
  graph: Graph
  indexMap: Map<number, string>
  refIdToIndex: Map<string, number>
  fixedPositions: Map<number, { x: number; y: number; z: number }>
} {
  const rawNodes: RawNode[] = nodes.map((n) => ({
    id: n.ref_id,
    label: truncateLabel(nodeLabel(n, schemas)),
  }))

  const nodeTypeById = new Map(nodes.map((n) => [n.ref_id, n.node_type || "Unknown"]))

  // Rewrite child→parent edges (e.g. SOURCE: Claim→Chapter) into parent→child
  // form so every downstream pass — incoming-count, bundles, rawEdges — sees
  // the same hierarchy. The render arrow ends up pointing parent→child, which
  // matches the visual we want.
  edges = edges.map((e) =>
    INVERT_FOR_HIERARCHY.has(e.edge_type)
      ? { ...e, source: e.target, target: e.source }
      : e
  )

  // ─── 1. Roots + orphan reachability ────────────────────────────────────
  // Compute on the original `edges` (cluster routing happens later and
  // doesn't change reachability). Only count incoming from known sources —
  // edges referencing nodes outside the loaded subgraph would otherwise
  // mark a real node as "non-root" without contributing to reachability,
  // leaving its subgraph stranded as orphans.
  const incomingCount = new Map<string, number>()
  for (const n of nodes) incomingCount.set(n.ref_id, 0)
  for (const e of edges) {
    if (incomingCount.has(e.target) && incomingCount.has(e.source)) {
      incomingCount.set(e.target, (incomingCount.get(e.target) ?? 0) + 1)
    }
  }
  const roots = nodes.filter((n) => (incomingCount.get(n.ref_id) ?? 0) === 0)

  const undAdj = new Map<string, string[]>()
  for (const n of nodes) undAdj.set(n.ref_id, [])
  for (const e of edges) {
    if (undAdj.has(e.source) && undAdj.has(e.target)) {
      undAdj.get(e.source)!.push(e.target)
      undAdj.get(e.target)!.push(e.source)
    }
  }
  const reached = new Set<string>()
  const reachQ: string[] = []
  for (const r of roots) {
    reached.add(r.ref_id)
    reachQ.push(r.ref_id)
  }
  let reachI = 0
  while (reachI < reachQ.length) {
    const cur = reachQ[reachI++]
    for (const nb of undAdj.get(cur) ?? []) {
      if (!reached.has(nb)) {
        reached.add(nb)
        reachQ.push(nb)
      }
    }
  }
  const orphans = nodes.filter((n) => !reached.has(n.ref_id))

  // Nodes carrying explicit `mapX`/`mapZ` properties opt out of layout —
  // their position is data-driven (e.g. metro stations on a schematic map),
  // so they should not be folded into __group_<type> hubs or stray-ring
  // fallbacks, and their root count shouldn't trigger crowd grouping.
  const fixedRefIds = new Set<string>()
  for (const n of nodes) {
    const p = n.properties as Record<string, unknown> | undefined
    if (p && typeof p.mapX === "number" && typeof p.mapZ === "number") {
      fixedRefIds.add(n.ref_id)
    }
  }
  // Metro view is only activated when actual fixed-position data is present.
  // This keeps the standard graph behavior unchanged for non-metro datasets.
  const isMetroView = fixedRefIds.size > 0

  // ─── 2. Decide which types get a __group_<type> ────────────────────────
  // A type gets its own synthetic group node when it either has orphans or
  // — under the existing crowd-control rule — when there are >10 roots and
  // the type has ≥2 leaf-like roots. "Leaf-like" = none of the type's roots
  // have outgoing edges to known nodes. This keeps hierarchy parents (e.g.
  // Episode, which has outgoing HAS → Chapter) surfacing as individuals
  // instead of being collapsed into __group_Episode.
  const orphanTypes = new Set(
    orphans.filter((o) => !fixedRefIds.has(o.ref_id)).map((o) => o.node_type || "Unknown")
  )
  const hasKnownOut = new Set<string>()
  for (const e of edges) {
    if (incomingCount.has(e.source) && incomingCount.has(e.target)) {
      hasKnownOut.add(e.source)
    }
  }
  const crowdGroupedTypes = new Set<string>()
  if (roots.length > 10) {
    const leafRootCountByType = new Map<string, number>()
    for (const r of roots) {
      if (fixedRefIds.has(r.ref_id)) continue
      if (hasKnownOut.has(r.ref_id)) continue
      const type = r.node_type || "Unknown"
      leafRootCountByType.set(type, (leafRootCountByType.get(type) ?? 0) + 1)
    }
    for (const [type, count] of leafRootCountByType) {
      if (count >= 2) crowdGroupedTypes.add(type)
    }
  }
  // In the metro view, force-group lore types under labeled hubs regardless
  // of root status — Artyom etc. would otherwise stay as individual nodes and
  // pull the hop-1 ring into a single arc instead of distributing evenly.
  const forceGroupedTypes = isMetroView ? METRO_FORCE_GROUPED_TYPES : new Set<string>()
  const groupedTypes = new Set([...orphanTypes, ...crowdGroupedTypes, ...forceGroupedTypes])

  // ─── 3. Bundle by (source, edge_type, target_type) ─────────────────────
  const bundles = new Map<string, ApiEdge[]>()
  for (const e of edges) {
    const tgtType = nodeTypeById.get(e.target)
    if (!tgtType) continue
    const key = `${e.source}::${e.edge_type}::${tgtType}`
    let arr = bundles.get(key)
    if (!arr) {
      arr = []
      bundles.set(key, arr)
    }
    arr.push(e)
  }

  // ─── 4. Process bundles ────────────────────────────────────────────────
  // Bundles ≥ CLUSTER_THRESHOLD become a per-source cluster — the parent
  // keeps ownership ("Episode → Chapter × 9 → 9 chapters"), and the type's
  // own __group_<type> stays reserved for nodes with no real parent (roots
  // and orphans).
  const clusterizedEdges = new Set<ApiEdge>()
  const clusteredTargets = new Set<string>()
  const extraNodes: RawNode[] = []
  const extraEdges: RawEdge[] = []

  for (const [key, arr] of bundles) {
    if (arr.length < CLUSTER_THRESHOLD) continue
    const [source, edge_type, target_type] = key.split("::")
    // Skip clusters whose source isn't in the loaded payload — buildGraph drops
    // edges with unknown endpoints, so the cluster's parent edge would vanish
    // and the proxy would end up as an orphan synthetic root with no visible
    // parent. Let the targets fall back to __group_<type> grouping instead.
    if (!nodeTypeById.has(source)) continue
    const clusterId = `__cluster_${source}_${edge_type}_${target_type}`
    extraNodes.push({ id: clusterId, label: `${target_type} × ${arr.length} · ${edge_type}` })
    extraEdges.push({ source, target: clusterId, label: edge_type })
    for (const e of arr) {
      extraEdges.push({ source: clusterId, target: e.target, label: edge_type })
      clusterizedEdges.add(e)
      clusteredTargets.add(e.target)
    }
  }

  // ─── 5. Build rawEdges (excluding clusterized) ─────────────────────────
  const rawEdges: RawEdge[] = []
  for (const e of edges) {
    if (clusterizedEdges.has(e)) continue
    rawEdges.push({ source: e.source, target: e.target, label: e.edge_type })
  }
  rawNodes.push(...extraNodes)
  rawEdges.push(...extraEdges)

  // ─── 6. Add __group_<type> nodes + member edges ────────────────────────
  // Members = roots of type + orphans of type, minus anything already wired
  // into a per-source cluster. Without that exclusion, when a cluster's
  // source isn't in the loaded subgraph the cluster's children look like
  // roots and end up double-bound: once under `__cluster_…_T × N` and again
  // under `__group_T`, producing two visual representations of the same type.
  if (groupedTypes.size > 0) {
    const memberByType = new Map<string, Set<string>>()
    for (const t of groupedTypes) memberByType.set(t, new Set())
    for (const r of roots) {
      if (clusteredTargets.has(r.ref_id)) continue
      if (fixedRefIds.has(r.ref_id)) continue
      const t = r.node_type || "Unknown"
      if (groupedTypes.has(t)) memberByType.get(t)!.add(r.ref_id)
    }
    for (const o of orphans) {
      if (clusteredTargets.has(o.ref_id)) continue
      if (fixedRefIds.has(o.ref_id)) continue
      const t = o.node_type || "Unknown"
      if (groupedTypes.has(t)) memberByType.get(t)!.add(o.ref_id)
    }
    // Force-grouped types: pull in every node of that type, not just
    // roots/orphans, so well-connected members still cluster under the hub.
    if (forceGroupedTypes.size > 0) {
      for (const n of nodes) {
        if (clusteredTargets.has(n.ref_id)) continue
        if (fixedRefIds.has(n.ref_id)) continue
        const t = n.node_type || "Unknown"
        if (forceGroupedTypes.has(t) && memberByType.has(t)) {
          memberByType.get(t)!.add(n.ref_id)
        }
      }
    }
    for (const [t, members] of memberByType) {
      if (members.size === 0) continue
      const groupId = `__group_${t}`
      rawNodes.push({ id: groupId, label: t })
      for (const m of members) {
        rawEdges.push({ source: groupId, target: m })
      }
    }
  }

  const graph = buildGraph(rawNodes, rawEdges)

  // Set nodeType on real nodes
  for (let i = 0; i < nodes.length; i++) {
    graph.nodes[i].nodeType = nodes[i].node_type
  }
  // Mark synthetic nodes — clusters get their own marker so renderers can
  // distinguish them from the older top-level type bundlers (`_group`).
  // Also record the underlying member type so the shader can pick a
  // type-specific glyph (Person clusters render differently from Tweet
  // clusters, etc.).
  for (let i = nodes.length; i < graph.nodes.length; i++) {
    const id = rawNodes[i].id
    if (id.startsWith("__cluster_")) {
      graph.nodes[i].nodeType = "_cluster"
      // id = __cluster_<source>_<edge_type>_<target_type> — target_type is last.
      const lastUnderscore = id.lastIndexOf("_")
      graph.nodes[i].clusterMemberType = id.slice(lastUnderscore + 1)
    } else {
      graph.nodes[i].nodeType = "_group"
      // id = __group_<type>
      graph.nodes[i].clusterMemberType = id.slice("__group_".length)
    }
  }

  // Only map real nodes — synthetic nodes have no API counterpart
  const indexMap = new Map<number, string>()
  const refIdToIndex = new Map<string, number>()
  for (let i = 0; i < nodes.length; i++) {
    indexMap.set(i, nodes[i].ref_id)
    refIdToIndex.set(nodes[i].ref_id, i)
  }

  // Resolve cluster-absorbed edges against the same index map and stash them
  // on the graph as `extraEdges` so the hover/select highlight can surface
  // them without polluting the base render or layout.
  const idToIndex = new Map<string, number>()
  for (let i = 0; i < rawNodes.length; i++) idToIndex.set(rawNodes[i].id, i)
  graph.extraEdges = []
  for (const e of clusterizedEdges) {
    const src = idToIndex.get(e.source)
    const dst = idToIndex.get(e.target)
    if (src === undefined || dst === undefined) continue
    graph.extraEdges.push({ src, dst, label: e.edge_type })
  }

  // Map graph-node-index → fixed (x, y, z) for nodes that opted out of layout.
  // `mapY` is optional — defaults to 0 if absent. Consumed by applyLayout to
  // override the radial-computed position.
  const fixedPositions = new Map<number, { x: number; y: number; z: number }>()
  for (let i = 0; i < nodes.length; i++) {
    if (!fixedRefIds.has(nodes[i].ref_id)) continue
    const p = nodes[i].properties as Record<string, unknown>
    const y = typeof p.mapY === "number" ? (p.mapY as number) : 0
    fixedPositions.set(i, { x: p.mapX as number, y, z: p.mapZ as number })
  }

  return { graph, indexMap, refIdToIndex, fixedPositions }
}

function applyLayout(
  graph: Graph,
  fixedPositions?: Map<number, { x: number; y: number; z: number }>,
  forceLift = false
) {
  // Metro view lifts the lore graph onto a higher Y plane so it floats above
  // the schematic. Lift when either: stations are present in the dataset
  // (fixedPositions has entries) OR the caller forces it (metro theme,
  // dataset replaced by a search result that doesn't include stations).
  const hasFixed = !!fixedPositions && fixedPositions.size > 0
  const loreLift = hasFixed || forceLift ? LORE_Y_LIFT : 0

  // Bumped from the 30 default — transcript/conversation graphs have chains
  // 40+ deep; truncating leaves the tail at buildGraph's (0,0,0) default.
  const sub = extractInitialSubgraph(graph, 1000)

  // Strip fixed-position nodes out of the radial layout's input layers so
  // they don't claim slots in the hop-1 angular budget. depthMap is left
  // intact — GraphView reads it to size/dim each node.
  if (hasFixed) {
    const fixed = fixedPositions!
    sub.neighborsByDepth = sub.neighborsByDepth.map((layer) =>
      layer.filter((id) => !fixed.has(id))
    )
  }

  const { positions, treeEdgeSet, childrenOf } = computeRadialLayout(
    sub.centerId,
    sub.neighborsByDepth,
    graph.edges,
    { parentId: sub.parentId }
  )

  for (const [id, pos] of positions) {
    if (id !== VIRTUAL_CENTER && id < graph.nodes.length) {
      const fixed = fixedPositions?.get(id)
      graph.nodes[id].position = fixed ?? { x: pos.x, y: pos.y + loreLift, z: pos.z }
    }
  }

  // Fixed-position nodes the BFS never reached (e.g. stations connected only
  // to other stations in their own subgraph) still need their coords applied.
  if (hasFixed) {
    for (const [id, pos] of fixedPositions!) {
      if (!positions.has(id) && id < graph.nodes.length) {
        graph.nodes[id].position = pos
      }
    }
  }

  // Anything BFS never reached (cycle-only components, synthetic nodes the
  // layout missed) keeps the (0,0,0) default from buildGraph and piles at the
  // origin. Park them on an outer ring so they stay visible and selectable.
  const stray: number[] = []
  for (let i = 0; i < graph.nodes.length; i++) {
    if (positions.has(i)) continue
    if (fixedPositions?.has(i)) continue
    stray.push(i)
  }
  if (stray.length > 0) {
    let maxR = 0
    for (const [id, p] of positions) {
      if (id === VIRTUAL_CENTER) continue
      const r = Math.hypot(p.x, p.z)
      if (r > maxR) maxR = r
    }
    const ringR = (maxR || 22) * 1.5 + 30
    const angleStep = (Math.PI * 2) / stray.length
    for (let i = 0; i < stray.length; i++) {
      const angle = i * angleStep
      graph.nodes[stray[i]].position = {
        x: Math.cos(angle) * ringR,
        y: loreLift,
        z: Math.sin(angle) * ringR,
      }
    }
  }

  graph.initialDepthMap = sub.depthMap
  graph.treeEdgeSet = treeEdgeSet
  graph.childrenOf = childrenOf

  // Snapshot every node's laid-out position. Click handler scales these by
  // an inflation factor so deeper nodes get R1-sized rings without relaying
  // out. Fixed-position nodes are omitted — they have data-driven coords
  // that must not stretch with the rest of the graph.
  const snapshot = new Map<number, { x: number; y: number; z: number }>()
  for (let i = 0; i < graph.nodes.length; i++) {
    if (fixedPositions?.has(i)) continue
    const p = graph.nodes[i].position
    snapshot.set(i, { x: p.x, y: p.y, z: p.z })
  }
  graph.originalPositions = snapshot
}


// Matches DEPTH_SHRINK in computeRadialLayout. Click inflation is the
// inverse: 1/0.45^d makes the ring around a depth-d node land at R1 again.
const DEPTH_SHRINK = 0.45

// Re-scale the graph about a fixed anchor node. The anchor (the clicked
// node) stays at its current position; every other node's offset *from the
// anchor* in the original layout is multiplied by `scale`. With
// scale = 1/0.45^d, the anchor's children land on a true R1 ring while the
// anchor itself doesn't move on screen — no camera motion required.
function rescaleAroundAnchor(graph: Graph, anchorId: number, scale: number) {
  if (!graph.originalPositions) return
  const origAnchor = graph.originalPositions.get(anchorId)
  const liveAnchor = graph.nodes[anchorId]?.position
  if (!origAnchor || !liveAnchor) return
  const ax = liveAnchor.x
  const ay = liveAnchor.y
  const az = liveAnchor.z
  for (const [id, orig] of graph.originalPositions) {
    if (id >= graph.nodes.length) continue
    graph.nodes[id].position = {
      x: ax + (orig.x - origAnchor.x) * scale,
      y: ay + (orig.y - origAnchor.y) * scale,
      z: az + (orig.z - origAnchor.z) * scale,
    }
  }
}

function restoreOriginalPositions(graph: Graph) {
  if (!graph.originalPositions) return
  for (const [id, orig] of graph.originalPositions) {
    if (id < graph.nodes.length) {
      graph.nodes[id].position = { x: orig.x, y: orig.y, z: orig.z }
    }
  }
}

interface CamTarget {
  posX: number
  posY: number
  posZ: number
  lookX: number
  lookY: number
  lookZ: number
}

function computeCamTarget(graph: Graph, nodeId: number, currentAzimuth: number): CamTarget {
  const p = graph.nodes[nodeId].position
  const treeKids = graph.childrenOf?.get(nodeId) ?? []
  const kidPts = treeKids.map((nid) => graph.nodes[nid]?.position).filter(Boolean)
  let maxRadius = 0
  for (const pt of kidPts) {
    const dx = pt.x - p.x
    const dz = pt.z - p.z
    maxRadius = Math.max(maxRadius, Math.sqrt(dx * dx + dz * dz))
  }
  const fovRad = (50 / 2) * (Math.PI / 180)
  const cameraHeight = Math.max(5, (maxRadius * 1.05) / Math.tan(fovRad))
  // Tiny in-plane offset so setLookAt's up-vector math (worldUp × forward)
  // doesn't go degenerate when the camera ends up directly above the node.
  // Direction follows the user's *current* camera azimuth so the final view
  // preserves their orbit angle instead of snapping to a canonical +Z bias.
  const offset = 0.1
  const ox = Math.sin(currentAzimuth) * offset
  const oz = Math.cos(currentAzimuth) * offset
  return {
    posX: p.x + ox,
    posY: p.y + cameraHeight,
    posZ: p.z + oz,
    lookX: p.x,
    lookY: p.y,
    lookZ: p.z,
  }
}

const OVERVIEW_CAM: CamTarget = {
  posX: 0, posY: 80, posZ: 0.1,
  lookX: 0, lookY: 0, lookZ: 0,
}

// World-units distance from camera to the selected node at which continuous
// zoom flips into the 2D case view. Post-click rest distance is ~46 units
// (cameraHeight from computeCamTarget); the trigger is well below that so
// settling after a click doesn't accidentally fire it.
const CASE_VIEW_TRIGGER_DISTANCE = 8

function smoothstep(x: number) {
  return x * x * (3 - 2 * x)
}

// Lives inside the R3F Canvas so it can read state.controls — which only
// becomes non-null after drei's <CameraControls makeDefault /> has actually
// mounted and registered itself. A useEffect in the outer component would
// race the mount and miss the instance entirely.
function CameraInteractionTracker({
  onChange,
}: {
  onChange: (active: boolean) => void
}) {
  const controls = useThree((s) => s.controls) as
    | (CameraControlsImpl & {
        addEventListener: (t: string, fn: () => void) => void
        removeEventListener: (t: string, fn: () => void) => void
      })
    | null
  useEffect(() => {
    if (!controls) return
    const onStart = () => onChange(true)
    const onEnd = () => onChange(false)
    controls.addEventListener("controlstart", onStart)
    controls.addEventListener("controlend", onEnd)
    return () => {
      controls.removeEventListener("controlstart", onStart)
      controls.removeEventListener("controlend", onEnd)
    }
  }, [controls, onChange])
  return null
}

// Drives the camera with GraphView's exact lerp formula so the camera
// arrives in lockstep with the geometry inflation. Without this the camera
// (CameraControls smoothDamp) and the nodes (smoothstep + delta/1.2 in
// GraphView) use different curves, and the selected node visibly drifts off
// to the side mid-transition.
function CameraSync({
  camRef,
  targetRef,
}: {
  camRef: React.RefObject<CameraControlsImpl | null>
  targetRef: React.RefObject<{
    target: CamTarget
    progress: number
    pos: [number, number, number]
    look: [number, number, number]
  }>
}) {
  // While the case board is opening/open, the CaseBoardAnimator owns the
  // camera (it pulls back to the board pose). CameraSync must yield — otherwise
  // its in-flight select fly-in keeps overriding the board move every frame,
  // leaving the camera stuck close to the focal (huge focal card, tiny faraway
  // group cards). This was the "first open looks broken, reopen fixes it" bug:
  // on reopen the fly-in had already settled so there was nothing to fight.
  const morphActive = useCaseBoardStore((s) => s.morphTarget > 0.001)
  useFrame((_, delta) => {
    const cam = camRef.current
    if (!cam) return
    const state = targetRef.current
    if (morphActive) {
      // Mark the fly-in done so it doesn't resume when the board closes.
      state.progress = 1
      return
    }
    // Only drive the camera while a transition is in flight. Once it settles,
    // hand control back to CameraControls so the user can orbit/pan/zoom.
    if (state.progress >= 1) return
    state.progress = Math.min(1, state.progress + delta / 1.2)
    const t = smoothstep(state.progress)
    const tgt = state.target
    state.pos[0] += (tgt.posX - state.pos[0]) * t
    state.pos[1] += (tgt.posY - state.pos[1]) * t
    state.pos[2] += (tgt.posZ - state.pos[2]) * t
    state.look[0] += (tgt.lookX - state.look[0]) * t
    state.look[1] += (tgt.lookY - state.look[1]) * t
    state.look[2] += (tgt.lookZ - state.look[2]) * t
    cam.setLookAt(
      state.pos[0], state.pos[1], state.pos[2],
      state.look[0], state.look[1], state.look[2],
      false,
    )
  })
  return null
}

// Watches camera-to-target distance for the selected node. When the user
// keeps dollying past CASE_VIEW_TRIGGER_DISTANCE the case view opens —
// continuous zoom IS the navigation. Also renders the discoverability button
// near the selected node so users who don't know about the gesture have an
// explicit affordance. Both paths call the same onOpen callback.
function CaseViewTrigger({
  graph,
  selectedNodeId,
  selectedApiNode,
  onOpen,
  disabled,
  camAnim,
  suppressedRef,
}: {
  graph: Graph
  selectedNodeId: number | null
  selectedApiNode: ApiNode | null
  onOpen: (node: ApiNode) => void
  disabled: boolean
  camAnim: React.RefObject<{ progress: number }>
  // Set true by handleCloseCaseBoard so closing doesn't immediately re-fire:
  // after close, computeCamTarget can park the camera inside the trigger
  // distance (leaf nodes rest at ~5 < 8), which would auto-reopen. Cleared
  // when the camera genuinely pulls back out past the re-arm threshold.
  suppressedRef: React.RefObject<boolean>
}) {
  const camera = useThree((s) => s.camera)
  // Start DISARMED so selecting a node (whose click-to-select camera move can
  // land inside the trigger distance for close-resting/leaf nodes) doesn't
  // auto-open the board. It only arms once the camera has settled far out, so
  // opening requires a deliberate dolly-in (or the zoom-in button).
  const firedRef = useRef(true)

  useFrame(() => {
    if (selectedNodeId === null || !selectedApiNode) {
      // Disarm when nothing is selected, so the next selection's click-to-
      // select camera move can't leave the trigger armed and auto-open.
      firedRef.current = true
      return
    }
    const node = graph.nodes[selectedNodeId]
    if (!node) return
    const p = node.position
    const dx = camera.position.x - p.x
    const dy = camera.position.y - p.y
    const dz = camera.position.z - p.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    // Arm only when the camera has SETTLED (progress >= 1) beyond the trigger
    // distance — never mid-animation. This is what stops a click-to-select
    // move (which sweeps in from far out) from arming and then auto-firing the
    // instant it lands on a close-resting / leaf node.
    if (camAnim.current.progress >= 1 && dist > CASE_VIEW_TRIGGER_DISTANCE) {
      firedRef.current = false
      // Camera settled back out — a manual close is re-armed, so a deliberate
      // dolly-in can reopen the board again.
      suppressedRef.current = false
    }
    if (disabled) return
    // Skip the click-to-select lerp. computeCamTarget can land the rest
    // position below the trigger threshold (Math.max(5, …) for leaf nodes)
    // and the lerp would falsely fire mid-flight. Wait until the user is in
    // control before considering the gesture intentional.
    if (camAnim.current.progress < 1) return
    if (dist < CASE_VIEW_TRIGGER_DISTANCE && !firedRef.current && !suppressedRef.current) {
      firedRef.current = true
      onOpen(selectedApiNode)
    }
  })

  if (disabled || selectedNodeId === null || !selectedApiNode) return null
  const node = graph.nodes[selectedNodeId]
  if (!node) return null
  const p = node.position
  return (
    <Html
      position={[p.x, p.y, p.z]}
      center
      style={{ pointerEvents: "none" }}
      zIndexRange={[20, 0]}
    >
      <div style={{ position: "relative", width: 0, height: 0 }}>
        <button
          onClick={() => onOpen(selectedApiNode)}
          title="Open case view"
          style={{
            position: "absolute",
            top: -68,
            left: -22,
            width: 44,
            height: 44,
            borderRadius: "50%",
            border: "1.5px solid rgba(77, 217, 232, 0.5)",
            background: "rgba(10, 10, 20, 0.85)",
            backdropFilter: "blur(12px)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "auto",
            boxShadow: "0 0 20px rgba(77, 217, 232, 0.2)",
            color: "#4dd9e8",
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ⤢
        </button>
        <div
          style={{
            position: "absolute",
            top: -22,
            left: -22,
            whiteSpace: "nowrap",
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
            color: "rgba(77, 217, 232, 0.75)",
            textShadow: "0 0 8px rgba(0, 0, 0, 0.9)",
            pointerEvents: "none",
          }}
        >
          zoom in
        </div>
      </div>
    </Html>
  )
}

// Debug overlay — fixed world reference + per-frame crosshairs for camera and
// click-anchor positions. Lets you see whether the selected node, the camera
// target, and the camera look-at are converging or diverging across a layout
// rebuild. Render *after* GraphView so the markers draw on top.
function DebugMarkers({
  graph,
  selectedNodeId,
  camAnim,
  clickAnchorRef,
  cameraRef,
}: {
  graph: Graph
  selectedNodeId: number | null
  camAnim: React.RefObject<{
    target: CamTarget
    progress: number
    pos: [number, number, number]
    look: [number, number, number]
  }>
  clickAnchorRef: React.RefObject<{
    refId: string
    pos: { x: number; y: number; z: number }
  } | null>
  cameraRef: React.RefObject<CameraControlsImpl | null>
}) {
  const ghostRef = useRef<THREE.Group>(null)
  const liveSelRef = useRef<THREE.Group>(null)
  const camTargetRef = useRef<THREE.Group>(null)
  const camLookRef = useRef<THREE.Group>(null)
  const lookTmp = useRef(new Vector3())

  useFrame(() => {
    // Yellow: click-anchor ghost. World-fixed at the position the node had
    // when the user clicked. Hidden until the first click.
    const anchor = clickAnchorRef.current
    if (ghostRef.current) {
      if (anchor) {
        ghostRef.current.position.set(anchor.pos.x, 0.1, anchor.pos.z)
        ghostRef.current.visible = true
      } else {
        ghostRef.current.visible = false
      }
    }

    // Green: where the selected node IS right now (live position from graph).
    // If this diverges from yellow, the layout has moved the node since click.
    if (liveSelRef.current) {
      if (selectedNodeId != null && graph.nodes[selectedNodeId]) {
        const p = graph.nodes[selectedNodeId].position
        liveSelRef.current.position.set(p.x, 0.15, p.z)
        liveSelRef.current.visible = true
      } else {
        liveSelRef.current.visible = false
      }
    }

    // Magenta: where the camera is heading (target.lookX/Y/Z). Frozen once
    // setCamTarget runs, so if the node moves after click, this stays behind.
    if (camTargetRef.current) {
      const t = camAnim.current.target
      camTargetRef.current.position.set(t.lookX, 0.2, t.lookZ)
    }

    // Cyan: where the camera is actually looking RIGHT NOW. Read from the
    // controls so we see the lerped value, not the target.
    if (camLookRef.current) {
      const cam = cameraRef.current
      if (cam) {
        cam.getTarget(lookTmp.current)
        camLookRef.current.position.set(
          lookTmp.current.x,
          0.25,
          lookTmp.current.z
        )
      }
    }
  })

  // Rings lie flat in XZ plane (rotated -π/2 on X) so the overhead camera
  // sees them as circles. Different radii so they don't fully overlap.
  return (
    <>
      {/* World axes at the origin (R=X, G=Y, B=Z), length 30. */}
      <axesHelper args={[30]} />
      {/* Ground grid at y=0. 200u total, 40 divisions. */}
      <gridHelper args={[200, 40, 0x444466, 0x222233]} position={[0, -0.05, 0]} />

      {/* Yellow — click anchor ghost */}
      <group ref={ghostRef} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.6, 2.0, 48]} />
          <meshBasicMaterial color={0xffd11a} transparent opacity={0.85} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Green — live selected node tracker */}
      <group ref={liveSelRef} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.2, 2.55, 48]} />
          <meshBasicMaterial color={0x33ff66} transparent opacity={0.9} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Magenta — camera target (where camera is heading) */}
      <group ref={camTargetRef}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.75, 3.1, 48]} />
          <meshBasicMaterial color={0xff33dd} transparent opacity={0.9} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Cyan — camera look-at (where camera is looking right now) */}
      <group ref={camLookRef}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[3.3, 3.65, 48]} />
          <meshBasicMaterial color={0x33e6ff} transparent opacity={0.9} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  )
}

// Camera placement for the case-board view, expressed as an offset from the
// focal node. The same vector is used by CaseBoardAnimator (to setLookAt the
// camera) and by CaseBoardMorphLayer (to compute the plane the neighbor ring
// sits in). Keep them in sync so cards face the camera at full morph.
export const CASE_BOARD_CAM_OFFSET = new Vector3(28, 14, 11.2)
// World-units multiplier for the normalized layout positions — the radius of
// the group ring around the focal. Tune so groups clear the focal card and
// fill the viewport at the resting camera distance.
const CASE_BOARD_SPREAD = 9

// Groups with this many members or fewer render as individual cards instead of
// a group container. 1 = don't wrap a lone node in a group; bump higher to also
// un-group small clusters.
const HYBRID_THRESHOLD = 1
// Approximate on-screen pixels per 1 layout (spread) unit at the resting board
// pose. Cards are sized in px; the layout works in spread units — this converts
// between them so the rectangle collision matches what's actually rendered.
// Lower = cards occupy MORE spread units = more spacing between them.
const BOARD_PX_PER_UNIT = 150

// A single-neighbor card or a collapsed group card placed on the board.
type BoardItem =
  | { kind: "node"; id: string; type: string; edgeLabel: string; node: ApiNode }
  | { kind: "group"; id: string; type: string; edgeLabel: string; members: ApiNode[] }

// Real card footprint in PIXELS — half-width/half-height — kept in sync with
// the actual CaseCard / CaseGroup CSS dimensions. Estimating height honestly is
// what prevents tall cards (e.g. a Person card with a description) from
// overlapping their neighbors. Circular collision can't capture aspect ratio.
function boardItemBoxPx(item: BoardItem): { w: number; h: number } {
  if (item.kind === "node") {
    // Neighbor CaseCard: width 240; height = hero(132) + padding + pill + title
    // (+ up to 3 field rows ~46px each). Estimate from the fields present.
    const props = item.node.properties as Record<string, unknown> | undefined
    let fieldRows = 0
    if (props) {
      for (const k of Object.keys(props)) {
        if (fieldRows >= 3) break
        const v = props[k]
        if ((typeof v === "string" && v.length > 0) || typeof v === "number") fieldRows++
      }
    }
    const h = 132 + 64 + fieldRows * 50
    return { w: 240, h }
  }
  // Group CaseGroup: width 256; header ~40 + rows (capped at 7) ~44px each,
  // clamped to the LIST_MAX_HEIGHT scroll cap.
  const rows = item.members.length
  const bodyH = Math.min(rows, 7) * 44
  return { w: 256, h: 40 + Math.min(bodyH, 360) }
}

function pxToHalfUnits(box: { w: number; h: number }): { hw: number; hh: number } {
  return {
    hw: box.w / 2 / BOARD_PX_PER_UNIT,
    hh: box.h / 2 / BOARD_PX_PER_UNIT,
  }
}

// Focal CaseCard footprint (width 300; hero 170 + body with description +
// up to 4 fields). Generous height so neighbors keep clear of it.
const BOARD_FOCAL_BOX_PX = { w: 300, h: 470 }

// Peak opacity of the cream backdrop. Below 1 lets a hint of the 3D scene
// bleed through so the board reads as "on top of the world" rather than a
// hard cut. Lower = more visible 3D ghost; 1 = fully opaque cream.
export const CASE_BOARD_BACKDROP_OPACITY = 0.92

// Z-index layering for the case-board overlays. drei's <Html /> defaults to
// zIndexRange [16777271, 0] for its label portals, so anything that has to
// occlude or sit above GraphView's labels needs values past 16.77M.
export const CASE_BOARD_Z = {
  backdrop: 16777300, // cream paper above 3D labels
  connectors: 16777350, // SVG between cream + cards
  cardFar: 16777400,
  cardNear: 16777500,
  button: 16778000,
}

// World→screen projection shared between the in-Canvas emitter and the
// out-of-Canvas connectors SVG. Mutable ref so the SVG can update path d
// attributes via its own rAF without re-rendering React 60fps. One entry
// per visible node (focal + neighbors); the SVG looks each end up by refId
// when drawing per-edge connectors.
export type ProjectionsRef = {
  positions: Map<string, { x: number; y: number }>
}

// Inside Canvas: each frame, project every visible (focal + neighbor)
// interpolated world position to screen coords and write into the shared
// ref. Renders nothing — purely a side-effect bridge to the SVG outside
// the Canvas.
function ProjectionEmitter({
  projectionsRef,
  items,
  morphProgress,
}: {
  projectionsRef: React.RefObject<ProjectionsRef>
  items: { id: string; origin: [number, number, number]; target: [number, number, number] }[]
  morphProgress: number
}) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  useFrame(() => {
    const r = projectionsRef.current
    if (!r) return
    const t = Math.max(0, Math.min(1, morphProgress))
    const next = new Map<string, { x: number; y: number }>()
    for (const item of items) {
      const wx = item.origin[0] + (item.target[0] - item.origin[0]) * t
      const wy = item.origin[1] + (item.target[1] - item.origin[1]) * t
      const wz = item.origin[2] + (item.target[2] - item.origin[2]) * t
      const v = new Vector3(wx, wy, wz).project(camera)
      next.set(item.id, {
        x: (v.x + 1) * 0.5 * size.width,
        y: (-v.y + 1) * 0.5 * size.height,
      })
    }
    r.positions = next
  })
  return null
}

// Renders the in-3D case board. The focal node + 1-hop neighbors get laid
// out via a force-directed sim in the plane perpendicular to the case-
// board camera direction — neighbors that share edges cluster naturally
// instead of all hanging off a perfect star. Mounts the camera animator
// + projection emitter alongside the cards.
function CaseBoardMorphLayer({
  graph,
  refIdToIndex,
  nodes,
  selectedRefId,
  morphProgress,
  cameraRef,
  projectionsRef,
  cardPortalRef,
  cardElsRef,
  items,
}: {
  graph: Graph
  refIdToIndex: Map<string, number>
  nodes: ApiNode[]
  selectedRefId: string
  morphProgress: number
  cameraRef: React.RefObject<CameraControlsImpl | null>
  projectionsRef: React.RefObject<ProjectionsRef>
  cardPortalRef: React.RefObject<HTMLDivElement | null>
  cardElsRef: React.RefObject<Map<string, HTMLElement>>
  items: BoardItem[]
}) {
  const selectedIdx = refIdToIndex.get(selectedRefId)
  const selectedNode = nodes.find((n) => n.ref_id === selectedRefId) ?? null
  const focalWorld = useMemo<[number, number, number] | null>(() => {
    if (selectedIdx === undefined) return null
    const p = graph.nodes[selectedIdx]?.position
    if (!p) return null
    return [p.x, p.y, p.z]
  }, [graph, selectedIdx])

  // World-space anchor for each GROUP: focal at center, groups on a ring
  // around it (radial hub & spokes). Same camera-facing plane mapping as the
  // focal — right/up basis derived from the case-board camera offset.
  const itemTargets = useMemo(() => {
    type Entry = {
      item: BoardItem
      origin: [number, number, number]
      target: [number, number, number]
    }
    if (!focalWorld) return [] as Entry[]
    const focal = new Vector3(focalWorld[0], focalWorld[1], focalWorld[2])
    const camPos = focal.clone().add(CASE_BOARD_CAM_OFFSET)
    const forward = focal.clone().sub(camPos).normalize()
    const worldUp = new Vector3(0, 1, 0)
    const right = new Vector3().crossVectors(worldUp, forward).normalize()
    const up = new Vector3().crossVectors(forward, right).normalize()
    const placement = computeBalancedLayout({
      items: items.map((it) => ({ id: it.id, ...pxToHalfUnits(boardItemBoxPx(it)) })),
      focalHalf: pxToHalfUnits(BOARD_FOCAL_BOX_PX),
      seed: selectedRefId,
    })
    const entries: Entry[] = []
    for (const item of items) {
      const pos = placement.get(item.id) ?? { x: 0, y: 0 }
      const offset = right
        .clone()
        .multiplyScalar(pos.x * CASE_BOARD_SPREAD)
        .add(up.clone().multiplyScalar(pos.y * CASE_BOARD_SPREAD))
      const target = focal.clone().add(offset)
      entries.push({
        item,
        origin: focalWorld,
        target: [target.x, target.y, target.z],
      })
    }
    return entries
  }, [focalWorld, items, selectedRefId])

  // Projection inputs — focal + each group anchor (id = group key) so the
  // connectors SVG can draw focal → group beziers each frame.
  const projectionInput = useMemo(() => {
    if (!focalWorld) return []
    const list: { id: string; origin: [number, number, number]; target: [number, number, number] }[] = [
      { id: selectedRefId, origin: focalWorld, target: focalWorld },
    ]
    for (const e of itemTargets) {
      list.push({ id: e.item.id, origin: e.origin, target: e.target })
    }
    return list
  }, [focalWorld, selectedRefId, itemTargets])

  // Which groups are expanded (showing the full list vs the compressed pile).
  // Local to the open session — resets on close since the layer unmounts.
  // Groups default to expanded (member list shown); the header toggle collapses
  // to the header only. Tracking the collapsed set keeps "expanded" the default
  // without seeding state from the (changing) group list.
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set())
  const toggleGroup = useCallback((key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  return (
    <>
      <CaseBoardAnimator focalWorld={focalWorld} cameraRef={cameraRef} />
      <ProjectionEmitter
        projectionsRef={projectionsRef}
        items={projectionInput}
        morphProgress={morphProgress}
      />
      {selectedNode && focalWorld && (
        <NodeMorph
          node={selectedNode}
          originPosition={focalWorld}
          targetPosition={focalWorld}
          variant="selected"
          morphProgress={morphProgress}
          portal={cardPortalRef}
          registerEl={(el) => {
            const m = cardElsRef.current
            if (el) m.set(selectedRefId, el)
            else m.delete(selectedRefId)
          }}
        />
      )}
      {itemTargets.map(({ item, origin, target }) =>
        item.kind === "node" ? (
          <NodeMorph
            key={item.id}
            node={item.node}
            originPosition={origin}
            targetPosition={target}
            variant="neighbor"
            morphProgress={morphProgress}
            onClick={() => useCaseBoardStore.getState().open(item.id)}
            portal={cardPortalRef}
            registerEl={(el) => {
              const m = cardElsRef.current
              if (el) m.set(item.id, el)
              else m.delete(item.id)
            }}
          />
        ) : (
          <GroupMorph
            key={item.id}
            type={item.type}
            members={item.members}
            edgeLabel={item.edgeLabel}
            expanded={!collapsedKeys.has(item.id)}
            onToggle={() => toggleGroup(item.id)}
            onMemberClick={(refId) => useCaseBoardStore.getState().open(refId)}
            originPosition={origin}
            targetPosition={target}
            morphProgress={morphProgress}
            portal={cardPortalRef}
            registerEl={(el) => {
              const m = cardElsRef.current
              if (el) m.set(item.id, el)
              else m.delete(item.id)
            }}
          />
        ),
      )}
    </>
  )
}

// SVG overlay that hosts the connector graphics — dashed lines, endpoint
// dots, mid-edge "linked to" pills. Each frame, an in-Canvas projection
// emitter writes focal + neighbor screen coords to a shared ref; this
// component's own rAF reads that ref and updates the SVG element attrs
// imperatively (no React re-renders during pan/zoom/morph).
const CONNECTOR_COLOR = "#4a90e2"
const CONNECTOR_COLOR_DIM = "rgba(74, 144, 226, 0.55)"
const CONNECTOR_LABEL_BG = "#0a0e15"
const CONNECTOR_LABEL_TEXT = "rgba(180, 210, 240, 0.85)"

function CaseBoardConnectorsSvg({
  cardElsRef,
  edges,
  morphProgress,
}: {
  cardElsRef: React.RefObject<Map<string, HTMLElement>>
  // One per visible-pair edge. id is a stable key (e.g. `${a}|${b}|${label}`)
  // so React can keep DOM stable across renders. a/b are refIds.
  edges: { id: string; a: string; b: string; label: string }[]
  morphProgress: number
}) {
  // One ref per dynamic element per edge id: path, two endpoint circles,
  // label group, label rect.
  const pathRefs = useRef<Map<string, SVGPathElement>>(new Map())
  const dotARefs = useRef<Map<string, SVGCircleElement>>(new Map())
  const dotBRefs = useRef<Map<string, SVGCircleElement>>(new Map())
  const labelGRefs = useRef<Map<string, SVGGElement>>(new Map())
  const labelRectRefs = useRef<Map<string, SVGRectElement>>(new Map())
  const labelTextRefs = useRef<Map<string, SVGTextElement>>(new Map())

  useEffect(() => {
    let raf = 0
    function tick() {
      const els = cardElsRef.current
      if (els) {
        for (const e of edges) {
          const ea = els.get(e.a)
          const eb = els.get(e.b)
          if (!ea || !eb) continue
          // Measure the real on-screen card rectangles (viewport px). This is
          // the only space that matches what's rendered — drei's distanceFactor
          // and the board's CSS zoom both feed into getBoundingClientRect.
          const ra = ea.getBoundingClientRect()
          const rb = eb.getBoundingClientRect()
          const pa = { x: ra.left + ra.width / 2, y: ra.top + ra.height / 2 }
          const pb = { x: rb.left + rb.width / 2, y: rb.top + rb.height / 2 }
          const halfA = { x: ra.width / 2, y: ra.height / 2 }
          const halfB = { x: rb.width / 2, y: rb.height / 2 }
          const dx = pb.x - pa.x
          const dy = pb.y - pa.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const nx = dx / dist
          const ny = dy / dist
          // Clip each endpoint to its card rectangle so the line spans only
          // the gap between cards instead of tunnelling under them. A is the
          // focal card (big), B a group container (smaller) — every edge here
          // runs focal → group, so the roles are fixed.
          const clip = (hx: number, hy: number) =>
            Math.min(
              hx / Math.max(Math.abs(nx), 1e-3),
              hy / Math.max(Math.abs(ny), 1e-3),
            )
          let insetA = clip(halfA.x, halfA.y)
          let insetB = clip(halfB.x, halfB.y)
          const room = dist - 10
          if (room <= 0) {
            insetA = 0
            insetB = 0
          } else if (insetA + insetB > room) {
            const s = room / (insetA + insetB)
            insetA *= s
            insetB *= s
          }
          const ax = pa.x + nx * insetA
          const ay = pa.y + ny * insetA
          const bx = pb.x - nx * insetB
          const by = pb.y - ny * insetB

          // Smooth cubic bezier with horizontal tangents — control points
          // extend sideways from each endpoint toward the other, so the line
          // leaves the focal and enters the card cleanly (React-Flow style).
          const cdx = bx - ax
          const dirX = cdx >= 0 ? 1 : -1
          const ctrl = Math.max(40, Math.abs(cdx) * 0.5)
          const c1x = ax + ctrl * dirX
          const c1y = ay
          const c2x = bx - ctrl * dirX
          const c2y = by

          const path = pathRefs.current.get(e.id)
          if (path) {
            path.setAttribute(
              "d",
              `M ${ax.toFixed(1)} ${ay.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`,
            )
          }
          const da = dotARefs.current.get(e.id)
          if (da) {
            da.setAttribute("cx", ax.toFixed(1))
            da.setAttribute("cy", ay.toFixed(1))
          }
          const db = dotBRefs.current.get(e.id)
          if (db) {
            db.setAttribute("cx", bx.toFixed(1))
            db.setAttribute("cy", by.toFixed(1))
          }
          const labelG = labelGRefs.current.get(e.id)
          if (labelG) {
            // Cubic midpoint (t = 0.5): (A + 3·C1 + 3·C2 + B) / 8.
            const lx = (ax + 3 * c1x + 3 * c2x + bx) / 8
            const ly = (ay + 3 * c1y + 3 * c2y + by) / 8
            labelG.setAttribute("transform", `translate(${lx.toFixed(1)}, ${ly.toFixed(1)})`)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cardElsRef, edges])

  return (
    <svg
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        opacity: morphProgress,
        zIndex: CASE_BOARD_Z.connectors,
      }}
    >
      {edges.map((e) => {
        // Width of the label pill grows with text length so long edge
        // types ("ANTAGONIST_OF") don't truncate.
        const label = (e.label || "linked to").toLowerCase()
        const pillW = Math.max(48, label.length * 6 + 16)
        return (
          <g key={e.id}>
            <path
              ref={(el) => {
                if (el) pathRefs.current.set(e.id, el)
                else pathRefs.current.delete(e.id)
              }}
              stroke={CONNECTOR_COLOR_DIM}
              strokeWidth={1.3}
              strokeDasharray="6 5"
              fill="none"
              strokeLinecap="round"
            />
            <circle
              ref={(el) => {
                if (el) dotARefs.current.set(e.id, el)
                else dotARefs.current.delete(e.id)
              }}
              r={4}
              fill={CONNECTOR_COLOR}
              stroke={CARD_BG_FOR_DOT}
              strokeWidth={1.5}
            />
            <circle
              ref={(el) => {
                if (el) dotBRefs.current.set(e.id, el)
                else dotBRefs.current.delete(e.id)
              }}
              r={4}
              fill={CONNECTOR_COLOR}
              stroke={CARD_BG_FOR_DOT}
              strokeWidth={1.5}
            />
            <g
              ref={(el) => {
                if (el) labelGRefs.current.set(e.id, el)
                else labelGRefs.current.delete(e.id)
              }}
            >
              <rect
                ref={(el) => {
                  if (el) labelRectRefs.current.set(e.id, el)
                  else labelRectRefs.current.delete(e.id)
                }}
                x={-pillW / 2}
                y={-9}
                width={pillW}
                height={18}
                rx={9}
                fill={CONNECTOR_LABEL_BG}
                stroke={CONNECTOR_COLOR_DIM}
                strokeWidth={0.75}
              />
              <text
                ref={(el) => {
                  if (el) labelTextRefs.current.set(e.id, el)
                  else labelTextRefs.current.delete(e.id)
                }}
                x={0}
                y={1}
                textAnchor="middle"
                dominantBaseline="central"
                fill={CONNECTOR_LABEL_TEXT}
                fontSize={9}
                fontFamily='"Space Grotesk", system-ui, sans-serif'
                letterSpacing={0.5}
              >
                {label}
              </text>
            </g>
          </g>
        )
      })}
    </svg>
  )
}

// Small dark border around endpoint dots so they read as distinct chips
// rather than blending into the dashed line. Matches the case-board's
// dark backdrop.
const CARD_BG_FOR_DOT = "#0a0e15"

interface GraphCanvasProps {
  nodes: ApiNode[]
  edges: ApiEdge[]
  schemas: SchemaNode[]
  onNodeSelect?: (node: ApiNode) => void
}

export function GraphCanvas({ nodes, edges, schemas, onNodeSelect }: GraphCanvasProps) {
  const cameraRef = useRef<CameraControlsImpl>(null)
  const sidebarHoveredNode = useGraphStore((s) => s.hoveredNode)
  const sidebarSelectedNode = useGraphStore((s) => s.sidebarSelectedNode)
  const dataVersion = useGraphStore((s) => s.dataVersion)
  const searchTerm = useAppStore((s) => s.searchTerm)

  // Metro overlay is opt-in via NEXT_PUBLIC_METRO_OVERLAY=1. When off, no
  // fixture data is spliced into the graph and the schematic layers don't
  // render — useful when pointing at a non-metro backend dataset.
  const metroEnabled = process.env.NEXT_PUBLIC_METRO_OVERLAY === "1"

  // The metro overlay always renders from the local fixture so the
  // schematic stays visible even when search replaces the graph store
  // with results that don't include Station nodes.
  const overlayNodes = metroEnabled ? (metroSeries.nodes as ApiNode[]) : []
  const overlayEdges = metroEnabled ? (metroSeries.edges as ApiEdge[]) : []

  // The *interactive* station layer (3D spheres + labels + hover behavior
  // provided by GraphView) also has to persist through search. Splice fixture
  // stations and TUNNEL_TO edges into whatever the graph store currently has
  // before running the radial layout. De-dupe by ref_id / edge identity so a
  // future search that does return a station won't double-render it.
  const effectiveNodes = useMemo(() => {
    if (!metroEnabled) return nodes
    const seen = new Set(nodes.map((n) => n.ref_id))
    const fixtureStations = (metroSeries.nodes as ApiNode[]).filter(
      (n) => n.node_type === "Station" && !seen.has(n.ref_id)
    )
    return fixtureStations.length > 0 ? [...nodes, ...fixtureStations] : nodes
  }, [nodes, metroEnabled])

  const effectiveEdges = useMemo(() => {
    if (!metroEnabled) return edges
    const refIds = new Set(effectiveNodes.map((n) => n.ref_id))
    const seen = new Set(
      edges.map((e) => `${e.source}|${e.target}|${e.edge_type}`)
    )
    // Pull in every fixture edge whose endpoints both exist in the effective
    // node set. That covers two cases at once:
    //   1. Station↔Station TUNNEL_TO edges (both stations are in fixture).
    //   2. Cross-edges from search results to stations — e.g. when the user
    //      searches "Librarian", the result has the Librarian node but no
    //      INHABITS edge to Biblioteka, because the backend only returns
    //      edges between nodes in the result set. The fixture has the edge.
    // Edges whose other endpoint isn't in the dataset would just dangle,
    // so we skip them.
    const extras = (metroSeries.edges as ApiEdge[]).filter(
      (e) =>
        !seen.has(`${e.source}|${e.target}|${e.edge_type}`) &&
        refIds.has(e.source) &&
        refIds.has(e.target)
    )
    return extras.length > 0 ? [...edges, ...extras] : edges
  }, [edges, effectiveNodes, metroEnabled])

  const { graph, indexMap, refIdToIndex } = useMemo(() => {
    const result = apiToGraph(effectiveNodes, effectiveEdges, schemas)
    // Force the Y-lift on the lore graph even when the dataset doesn't carry
    // fixed-position nodes (e.g. after a search). Otherwise search results
    // would drop to y=0 where the schematic sits.
    applyLayout(result.graph, result.fixedPositions, true)
    return result
  }, [effectiveNodes, effectiveEdges, schemas])

  // Lowercase type → schema icon name (e.g. "EpisodeIcon"). The pill in
  // GraphView resolves this through schema-icons to a Lucide component.
  const nodeTypeIcons = useMemo(() => {
    const map: Record<string, string> = {}
    for (const s of schemas) {
      if (s.icon) map[s.type.toLowerCase()] = s.icon
    }
    return map
  }, [schemas])

  const [viewState, setViewState] = useState<ViewState>({ mode: "overview" })

  // In-3D case board state — subscribed via the case-board store. Open is
  // triggered by either the close-up zoom (CaseViewTrigger) or the manual
  // "open case board" button. The whole transition stays in the 3D scene:
  // cards appear as Html overlays at node world positions, camera tilts to
  // a front-of-node view, morphProgress drives card opacity + scale-in.
  const morphSelectedRefId = useCaseBoardStore((s) => s.selectedRefId)
  const morphProgress = useCaseBoardStore((s) => s.morphProgress)
  const morphTarget = useCaseBoardStore((s) => s.morphTarget)
  const morphOpen = morphTarget > 0.001 || morphProgress > 0.001

  // Shared between the in-Canvas ProjectionEmitter (writer) and the
  // out-of-Canvas CaseBoardConnectorsSvg (reader). Holds the most recent
  // world→screen projection of the focal + each neighbor's interpolated
  // position. Mutable ref so the SVG can repaint via its own rAF without
  // touching React state per frame.
  const projectionsRef = useRef<ProjectionsRef>({ positions: new Map() })
  // Maps focal refId + each group key to its rendered card DOM element, so the
  // connector overlay can measure real card rectangles and attach edges to the
  // actual borders (works at any zoom — getBoundingClientRect includes it).
  const cardElsRef = useRef<Map<string, HTMLElement>>(new Map())

  // Board pan + zoom — applied as a CSS transform on the layer that hosts
  // the Html cards + SVG connectors. Lives entirely in DOM so the 3D
  // camera stays locked and the underlying scene doesn't move at all.
  const boardLayerRef = useRef<HTMLDivElement>(null)
  const boardPanRef = useRef({ x: 0, y: 0 })
  const boardZoomRef = useRef(1)
  // Apply pan/zoom imperatively to the board layer's transform — NOT via React
  // state. Driving it through setState re-rendered the entire GraphCanvas tree
  // (heavy, especially with the metro overlay's extra nodes) on every drag-move
  // / wheel tick — that was the lag, the dead drag, and the stale-until-resize
  // layout. The connector overlay already tracks via rAF + measured rects, so
  // the DOM transform is fine as the single source of truth.
  const applyBoardTransform = useCallback(() => {
    const el = boardLayerRef.current
    if (!el) return
    const p = boardPanRef.current
    el.style.transform = `translate(${p.x}px, ${p.y}px) scale(${boardZoomRef.current})`
  }, [])
  const setBoard = useCallback(
    (pan: { x: number; y: number }, zoom: number) => {
      boardPanRef.current = pan
      boardZoomRef.current = zoom
      applyBoardTransform()
    },
    [applyBoardTransform],
  )
  const dragStateRef = useRef<{
    startX: number
    startY: number
    startPanX: number
    startPanY: number
    moved: boolean
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Snap pan/zoom back to identity whenever the morph closes so the next
  // open always starts centered. Without this, the board would remember
  // the pan/zoom from the last session.
  useEffect(() => {
    // Reset to identity whenever the board opens or closes so each open starts
    // centered at scale 1. Pure imperative now — no setState, no re-render.
    setBoard({ x: 0, y: 0 }, 1)
  }, [morphOpen, setBoard])

  const handleBoardMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only start a pan gesture on left button. Right-click / middle stay
      // available for browser context menu / future tools.
      if (e.button !== 0) return
      dragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPanX: boardPanRef.current.x,
        startPanY: boardPanRef.current.y,
        moved: false,
      }
    },
    [],
  )

  const handleBoardMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current
      if (!drag) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      // 3px threshold so a clean click on a card doesn't register as a
      // micro-drag and consume the click event.
      if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      if (!drag.moved) {
        drag.moved = true
        setIsDragging(true)
      }
      setBoard(
        { x: drag.startPanX + dx, y: drag.startPanY + dy },
        boardZoomRef.current,
      )
    },
    [setBoard],
  )

  const handleBoardMouseUp = useCallback(() => {
    dragStateRef.current = null
    setIsDragging(false)
  }, [])

  const handleBoardWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      // If the wheel is over a scrollable group list, let it scroll its rows
      // natively instead of zooming the board. Checked per-event from the
      // target so there's no persistent flag that can get stuck and
      // permanently disable zoom.
      let scrollEl: HTMLElement | null = e.target as HTMLElement | null
      while (scrollEl && scrollEl !== e.currentTarget) {
        if (
          scrollEl.scrollHeight > scrollEl.clientHeight + 1 &&
          getComputedStyle(scrollEl).overflowY !== "visible"
        ) {
          return
        }
        scrollEl = scrollEl.parentElement
      }
      // Miro-style zoom: the step scales with the actual wheel delta (so a
      // trackpad's many small events stay gentle and a mouse notch is one
      // smooth bump), and the zoom anchors on the cursor instead of the
      // viewport center.
      e.stopPropagation()
      // Normalize across deltaMode: pixels (0), lines (1), pages (2).
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const delta = e.deltaY * unit
      const factor = Math.exp(-delta * 0.0015)

      const z = boardZoomRef.current
      const next = Math.max(0.25, Math.min(4, z * factor))
      // Clamping can shrink the effective factor — recompute it so the
      // cursor-anchor math stays exact at the zoom limits.
      const applied = next / z

      const rect = e.currentTarget.getBoundingClientRect()
      const cx = e.clientX - rect.left - rect.width / 2
      const cy = e.clientY - rect.top - rect.height / 2
      // Keep the content point under the cursor fixed: pan' = c - f·(c - pan).
      const p = boardPanRef.current
      setBoard(
        {
          x: cx - applied * (cx - p.x),
          y: cy - applied * (cy - p.y),
        },
        next,
      )
    },
    [setBoard],
  )

  // 1-hop neighbor ref_ids of the morph-selected node. Hoisted out of
  // CaseBoardMorphLayer so the connectors SVG (sibling, not child) can
  // share the same set without duplicating the edge scan.
  const morphNeighborIds = useMemo(() => {
    if (!morphSelectedRefId) return []
    const out: string[] = []
    const seen = new Set<string>([morphSelectedRefId])
    for (const e of effectiveEdges) {
      let nb: string | null = null
      if (e.source === morphSelectedRefId) nb = e.target
      else if (e.target === morphSelectedRefId) nb = e.source
      if (nb && !seen.has(nb)) {
        seen.add(nb)
        out.push(nb)
      }
    }
    return out
  }, [morphSelectedRefId, effectiveEdges])

  // Edges to render on the case board: every edge whose both endpoints
  // are part of the visible set (focal + 1-hop neighbors). Includes
  // neighbor-to-neighbor edges so the board reads as a network instead of
  // a star. De-duped by canonical key.
  const morphVisibleEdges = useMemo(() => {
    if (!morphSelectedRefId) return []
    const visible = new Set<string>([morphSelectedRefId, ...morphNeighborIds])
    const out: { id: string; a: string; b: string; label: string }[] = []
    const seen = new Set<string>()
    for (const e of effectiveEdges) {
      if (!visible.has(e.source) || !visible.has(e.target)) continue
      const lo = e.source < e.target ? e.source : e.target
      const hi = e.source < e.target ? e.target : e.source
      const key = `${lo}|${hi}|${e.edge_type}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ id: key, a: e.source, b: e.target, label: e.edge_type })
    }
    return out
  }, [morphSelectedRefId, morphNeighborIds, effectiveEdges])

  // Group the focal's 1-hop neighbors by node_type into case-board groups.
  // The dominant relationship (edge_type) to the focal becomes the group's
  // connector label + header subtitle.
  const boardItems = useMemo<BoardItem[]>(() => {
    if (!morphSelectedRefId) return []
    const relFor = new Map<string, string>()
    for (const e of morphVisibleEdges) {
      let nb: string | null = null
      if (e.a === morphSelectedRefId) nb = e.b
      else if (e.b === morphSelectedRefId) nb = e.a
      if (nb && !relFor.has(nb)) relFor.set(nb, e.label ?? "")
    }
    // Group by (node_type + relationship) so members of a group genuinely share
    // the same edge to the focal. Grouping by type alone mislabels members — a
    // spouse and a child both end up under whichever relationship is dominant.
    const byKey = new Map<string, { type: string; rel: string; members: ApiNode[] }>()
    const order: string[] = []
    for (const refId of morphNeighborIds) {
      const node = effectiveNodes.find((n) => n.ref_id === refId)
      if (!node) continue
      const type = node.node_type || "Node"
      const rel = relFor.get(refId) ?? ""
      const key = `${type}|${rel}`
      let g = byKey.get(key)
      if (!g) {
        g = { type, rel, members: [] }
        byKey.set(key, g)
        order.push(key)
      }
      g.members.push(node)
    }
    // Hybrid: sparse groups → individual cards; dense ones → one group card.
    const items: BoardItem[] = []
    for (const key of order) {
      const g = byKey.get(key)!
      if (g.members.length <= HYBRID_THRESHOLD) {
        for (const node of g.members) {
          items.push({ kind: "node", id: node.ref_id, type: g.type, edgeLabel: g.rel, node })
        }
      } else {
        items.push({ kind: "group", id: `grp:${key}`, type: g.type, edgeLabel: g.rel, members: g.members })
      }
    }
    return items
  }, [morphSelectedRefId, morphNeighborIds, morphVisibleEdges, effectiveNodes])

  // One connector per board item: focal → item.
  const boardConnectorEdges = useMemo(
    () =>
      boardItems.map((it) => ({
        id: it.id,
        a: morphSelectedRefId ?? "",
        b: it.id,
        label: it.edgeLabel || "linked to",
      })),
    [boardItems, morphSelectedRefId],
  )
  const [hoveredCardNode, setHoveredCardNode] = useState<ApiNode | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  // Metro overlay focus state — driven by hovering the lines (3D) or the
  // legend (DOM). null when nothing is hovered, which leaves every line and
  // bullet at full opacity.
  const [hoveredLine, setHoveredLine] = useState<string | null>(null)
  const [hoveredState, setHoveredState] = useState<StationState | null>(null)

  // True while the user is actively dragging/rotating/dollying the camera.
  // Suppresses hover firing on whatever nodes happen to sweep under the
  // (otherwise stationary) cursor during the gesture. Wired via a tracker
  // component inside the Canvas (see <CameraInteractionTracker/>) because
  // an outer useEffect races drei's makeDefault registration.
  const [cameraInteracting, setCameraInteracting] = useState(false)
  const handleCameraInteractingChange = useCallback((v: boolean) => {
    setCameraInteracting(v)
  }, [])

  // Debug overlay: world-fixed markers + per-frame camera/anchor crosshairs.
  // Gated entirely behind NEXT_PUBLIC_DEBUG_MARKERS so production builds carry
  // no debug UI. When the env is set, markers default on and a toggle button
  // appears for in-session A/B'ing.
  const debugAvailable = process.env.NEXT_PUBLIC_DEBUG_MARKERS === "1"
  const [debugMarkers, setDebugMarkers] = useState<boolean>(debugAvailable)
  // Click anchor: world position of the node the user clicked, captured at
  // click time. Stays fixed after the click so a layout rebuild moves the
  // node away from it visibly.
  const clickAnchorRef = useRef<{
    refId: string
    pos: { x: number; y: number; z: number }
  } | null>(null)

  // CameraSync drives this each frame using the same lerp curve as GraphView,
  // so geometry inflation and camera dolly stay in lockstep.
  const camAnim = useRef<{
    target: CamTarget
    progress: number
    pos: [number, number, number]
    look: [number, number, number]
  }>({
    target: OVERVIEW_CAM,
    progress: 1,
    pos: [OVERVIEW_CAM.posX, OVERVIEW_CAM.posY, OVERVIEW_CAM.posZ],
    look: [OVERVIEW_CAM.lookX, OVERVIEW_CAM.lookY, OVERVIEW_CAM.lookZ],
  })

  const setCamTarget = useCallback((target: CamTarget) => {
    const cam = cameraRef.current
    if (cam) {
      // Seed from where the camera actually is right now — the user may have
      // orbited since the last transition, so the previous interpolated
      // values are stale.
      const pos = cam.getPosition(new Vector3())
      const tgt = cam.getTarget(new Vector3())
      camAnim.current.pos = [pos.x, pos.y, pos.z]
      camAnim.current.look = [tgt.x, tgt.y, tgt.z]
    }
    camAnim.current.target = target
    camAnim.current.progress = 0
  }, [])

  // Reset view only on full data replacement (new search), not on appends
  // from sidebar-driven neighbor fetches — otherwise focusing the camera on
  // a clicked node would be undone every time a neighborhood arrives.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- paired with an imperative camera reset; remount would drop GL state
    setViewState({ mode: "overview" })
    setCamTarget(OVERVIEW_CAM)
    useCaseBoardStore.getState().close()
  }, [dataVersion, setCamTarget])

  const selectedApiNode = useMemo<ApiNode | null>(() => {
    if (viewState.mode !== "subgraph") return null
    const refId = indexMap.get(viewState.selectedNodeId)
    if (!refId) return null
    return nodes.find((n) => n.ref_id === refId) ?? null
  }, [viewState, indexMap, nodes])

  // Opens the in-3D case board (morph + camera tilt + Html cards) on the
  // node the user has been zooming into. apparentRadius is unused now —
  // kept in the trigger's signature for back-compat, but the morph doesn't
  // need it since cards are sized in screen-space via distanceFactor.
  const handleOpenCaseView = useCallback(
    (node: ApiNode) => {
      useCaseBoardStore.getState().open(node.ref_id)
    },
    [],
  )

  // Closes the in-3D case board: drops morph state and pulls the camera back
  // to the selected node's rest distance so the trigger re-arms and the user
  // has room to maneuver before the next dolly-in.
  // Disarm the dolly-in auto-trigger across a manual close. computeCamTarget
  // below parks the camera at the node's rest distance, which for leaf nodes
  // is inside CASE_VIEW_TRIGGER_DISTANCE — without this guard the trigger
  // would see "camera is close" and reopen the board immediately. Cleared in
  // CaseViewTrigger once the camera pulls back out past the re-arm threshold.
  const caseTriggerSuppressedRef = useRef(false)
  const handleCloseCaseBoard = useCallback(() => {
    caseTriggerSuppressedRef.current = true
    useCaseBoardStore.getState().close()
    if (viewState.mode === "subgraph") {
      setCamTarget(
        computeCamTarget(
          graph,
          viewState.selectedNodeId,
          cameraRef.current?.azimuthAngle ?? 0,
        ),
      )
    }
  }, [viewState, graph, setCamTarget])

  const externalHoveredId = sidebarHoveredNode ? (refIdToIndex.get(sidebarHoveredNode.ref_id) ?? null) : null
  const externalSelectedId = sidebarSelectedNode ? (refIdToIndex.get(sidebarSelectedNode.ref_id) ?? null) : null

  // Backend sets `matched_property` on actual search hits; expanded 1-hop
  // neighbors don't have it. Map those onto graph indices for the spotlight.
  const searchMatches = useMemo(() => {
    const set = new Set<number>()
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].matched_property !== undefined) set.add(i)
    }
    return set.size > 0 ? set : null
  }, [nodes])

  // Hovering a legend row spotlights every station in that state — reuses
  // the search-match plumbing in GraphView (highlights members, dims the
  // rest).
  const stateHoverMatches = useMemo(() => {
    if (!hoveredState) return null
    const set = new Set<number>()
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].node_type !== "Station") continue
      const p = nodes[i].properties as Record<string, unknown> | undefined
      if (!p) continue
      const status = p.station_status ?? p.status
      if (statusToState(status, p.faction) === hoveredState) set.add(i)
    }
    return set.size > 0 ? set : null
  }, [nodes, hoveredState])

  // Hovering a metro line spotlights every node tagged with that line.
  const lineHoverMatches = useMemo(() => {
    if (!hoveredLine) return null
    const set = new Set<number>()
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i].properties as Record<string, unknown> | undefined
      const lineStr =
        (p && typeof p.metro_line === "string" ? p.metro_line : null) ??
        (p && typeof p.line === "string" ? p.line : null) ??
        ""
      const lines = lineStr.split(",").map((s: string) => s.trim().toLowerCase())
      if (lines.includes(hoveredLine)) set.add(i)
    }
    return set.size > 0 ? set : null
  }, [nodes, hoveredLine])

  // ref_id → set of metro line colors the node is associated with. Stations
  // contribute their own line property; non-station nodes inherit lines from
  // any station they share an edge with (1-hop). Used to dim unrelated
  // lines/bullets when a node is hovered or selected.
  const nodeToLines = useMemo(() => {
    const stationLines = new Map<string, Set<string>>()
    for (const n of nodes) {
      if (n.node_type !== "Station") continue
      const p = n.properties as Record<string, unknown> | undefined
      const raw =
        (p && typeof p.metro_line === "string" ? p.metro_line : null) ??
        (p && typeof p.line === "string" ? p.line : null) ??
        ""
      const lines = new Set(
        raw.split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean)
      )
      if (lines.size > 0) stationLines.set(n.ref_id, lines)
    }
    const map = new Map<string, Set<string>>()
    for (const [refId, lines] of stationLines) map.set(refId, new Set(lines))
    for (const e of edges) {
      const srcLines = stationLines.get(e.source)
      const dstLines = stationLines.get(e.target)
      if (srcLines && !stationLines.has(e.target)) {
        let arr = map.get(e.target)
        if (!arr) {
          arr = new Set()
          map.set(e.target, arr)
        }
        for (const l of srcLines) arr.add(l)
      }
      if (dstLines && !stationLines.has(e.source)) {
        let arr = map.get(e.source)
        if (!arr) {
          arr = new Set()
          map.set(e.source, arr)
        }
        for (const l of dstLines) arr.add(l)
      }
    }
    return map
  }, [nodes, edges])

  // Lines currently in focus. Hovering a line directly wins; otherwise the
  // active node (hover beats select; canvas beats sidebar) contributes its
  // associated lines. `null` means no dimming — every line at full opacity.
  const activeLines = useMemo<Set<string> | null>(() => {
    if (hoveredLine) return new Set([hoveredLine])
    let activeRefId: string | null = null
    if (hoveredCardNode) activeRefId = hoveredCardNode.ref_id
    else if (sidebarHoveredNode) activeRefId = sidebarHoveredNode.ref_id
    else if (viewState.mode === "subgraph") {
      activeRefId = indexMap.get(viewState.selectedNodeId) ?? null
    } else if (sidebarSelectedNode) activeRefId = sidebarSelectedNode.ref_id
    if (!activeRefId) return null
    return nodeToLines.get(activeRefId) ?? new Set()
  }, [
    hoveredLine,
    hoveredCardNode,
    sidebarHoveredNode,
    sidebarSelectedNode,
    viewState,
    indexMap,
    nodeToLines,
  ])

  // Top-3 ranked search hits, by descending score. GraphView amplifies their
  // size + color and tints their labels (rank 0 gold, ranks 1-2 cool blue).
  const topMatchRanks = useMemo<Map<number, number> | null>(() => {
    const hits: { i: number; score: number }[] = []
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].matched_property === undefined) continue
      hits.push({ i, score: typeof nodes[i].score === "number" ? nodes[i].score! : 0 })
    }
    if (hits.length === 0) return null
    hits.sort((a, b) => b.score - a.score)
    const m = new Map<number, number>()
    for (let r = 0; r < Math.min(3, hits.length); r++) m.set(hits[r].i, r)
    return m
  }, [nodes])

  // Feature 2 (GRAPH_FEATURES.md): pan to the rank-0 search hit once per new
  // search query. Tracks the last search term we've already panned for, so a
  // neighbor-fetch payload that arrives later (same query, fresher graph)
  // doesn't re-pan and override a user click in between. handleNodeClick
  // consumes the pending pan by writing the current searchTerm into the ref —
  // see below.
  const lastPannedSearchTerm = useRef<string>("")
  useEffect(() => {
    if (!searchTerm) return
    if (searchTerm === lastPannedSearchTerm.current) return
    if (!topMatchRanks) return
    let topIdx = -1
    for (const [idx, rank] of topMatchRanks) {
      if (rank === 0) { topIdx = idx; break }
    }
    if (topIdx < 0 || !graph.nodes[topIdx]) return
    setCamTarget(computeCamTarget(graph, topIdx, cameraRef.current?.azimuthAngle ?? 0))
    lastPannedSearchTerm.current = searchTerm
  }, [searchTerm, topMatchRanks, graph, setCamTarget])

  const handleHoverChange = useCallback(
    (nodeId: number | null) => {
      if (nodeId === null) {
        setHoveredCardNode(null)
        return
      }
      const refId = indexMap.get(nodeId)
      if (!refId) {
        setHoveredCardNode(null)
        return
      }
      const apiNode = nodes.find((n) => n.ref_id === refId)
      setHoveredCardNode(apiNode ?? null)
    },
    [indexMap, nodes]
  )

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    setCursor({ x: e.clientX, y: e.clientY })
  }, [])

  const handlePointerLeave = useCallback(() => {
    setHoveredCardNode(null)
  }, [])

  const handleNodeClick = useCallback(
    (nodeId: number) => {
      useGraphStore.getState().setSidebarSelectedNode(null)
      useGraphStore.getState().setHoveredNode(null)
      const refId = indexMap.get(nodeId)
      if (refId && onNodeSelect) {
        const apiNode = nodes.find((n) => n.ref_id === refId)
        if (apiNode) onNodeSelect(apiNode)
      }

      // Debug: snapshot the clicked node's world position BEFORE rescale.
      // The yellow ghost marker lives here so layout rebuilds become visible.
      const preClickPos = graph.nodes[nodeId]?.position
      if (refId && preClickPos) {
        clickAnchorRef.current = {
          refId,
          pos: { x: preClickPos.x, y: preClickPos.y, z: preClickPos.z },
        }
      }

      // Re-scale the world around the clicked node. Selected stays put on
      // screen; descendants' offsets from selected grow to R1-sized rings,
      // ancestors push outward. No camera motion — the anchor doesn't move.
      const initialDepth = graph.initialDepthMap?.get(nodeId) ?? 0
      const scale = Math.pow(1 / DEPTH_SHRINK, Math.max(0, initialDepth))
      rescaleAroundAnchor(graph, nodeId, scale)

      const sub = extractSubgraph(graph, nodeId, 30, { useAdj: "undirected" })

      // Intentionally do NOT promote extraEdge (cluster-absorbed) endpoints
      // to depth 1. The cluster proxy is the 1-hop stand-in for its members;
      // promoting members would label every absorbed clip at once. Members
      // become labelable when the user hovers the proxy directly.

      setViewState((prev) => {
        const prevHistory = prev.mode === "subgraph" ? prev.navigationHistory : []
        const existingIdx = prevHistory.indexOf(nodeId)
        const newHistory =
          existingIdx !== -1
            ? prevHistory.slice(0, existingIdx + 1)
            : [...prevHistory, nodeId]

        const prevVisible = prev.mode === "subgraph" ? prev.visibleNodeIds : []
        const prevSet = new Set(prevVisible)
        const newNodes = sub.nodeIds.filter((n) => !prevSet.has(n))
        const allVisible = [...prevVisible, ...newNodes]
        const visibleSet = new Set(allVisible)
        for (const hid of newHistory) {
          if (!visibleSet.has(hid)) {
            allVisible.push(hid)
            visibleSet.add(hid)
          }
        }

        const depthMap = new Map(sub.depthMap)
        const prevNodeId = newHistory.length >= 2 ? newHistory[newHistory.length - 2] : null
        if (prevNodeId !== null && !depthMap.has(prevNodeId)) {
          depthMap.set(prevNodeId, -1)
        }

        return {
          mode: "subgraph" as const,
          selectedNodeId: nodeId,
          navigationHistory: newHistory,
          depthMap,
          neighborsByDepth: sub.neighborsByDepth,
          parentId: sub.parentId,
          visibleNodeIds: allVisible,
        }
      })

      // Camera dollies to look at selected. Anchor's world position is
      // fixed by rescaleAroundAnchor, so the camera target is constant
      // through the lerp — no drift like when both the camera and the
      // anchor were moving in opposite directions. Capture the current
      // orbit azimuth so the final view preserves it rather than snapping
      // to a canonical orientation when the camera lands above the node.
      setCamTarget(computeCamTarget(graph, nodeId, cameraRef.current?.azimuthAngle ?? 0))

      // Consume any pending search-pan: if results haven't landed yet, a
      // later payload would otherwise yank the camera off the node the
      // user just clicked. Marking this term as "already panned for" stops
      // the search-pan effect from firing for it.
      lastPannedSearchTerm.current = searchTerm
    },
    [graph, indexMap, nodes, onNodeSelect, setCamTarget, searchTerm]
  )

  const handleReset = useCallback(() => {
    restoreOriginalPositions(graph)
    setViewState({ mode: "overview" })
    setCamTarget(OVERVIEW_CAM)
    // Clear hover + sidebar selection so highlight edges / external-selected
    // beziers from the previously focused node don't linger after the reset.
    useGraphStore.getState().setSidebarSelectedNode(null)
    useGraphStore.getState().setHoveredNode(null)
  }, [graph, setCamTarget])

  // Lock CameraControls into a 2D-feeling pan + zoom mode while the case
  // board is open: drag = truck (parallel to view plane), wheel = dolly,
  // rotate disabled. Reverts to the default 3D orbit controls on close.
  useEffect(() => {
    const cc = cameraRef.current
    if (!cc) return
    if (morphOpen) {
      // 3D camera fully locked while the board is up. Pan + zoom for the
      // board happen on a separate DOM layer (BoardPanZoom below) so they
      // don't move the underlying 3D scene at all — true Miro-style
      // independent whiteboard.
      cc.mouseButtons.left = CameraControlsImpl.ACTION.NONE
      cc.mouseButtons.right = CameraControlsImpl.ACTION.NONE
      cc.mouseButtons.middle = CameraControlsImpl.ACTION.NONE
      cc.mouseButtons.wheel = CameraControlsImpl.ACTION.NONE
      cc.touches.one = CameraControlsImpl.ACTION.NONE
      cc.touches.two = CameraControlsImpl.ACTION.NONE
      cc.touches.three = CameraControlsImpl.ACTION.NONE
    } else {
      cc.mouseButtons.left = CameraControlsImpl.ACTION.ROTATE
      cc.mouseButtons.right = CameraControlsImpl.ACTION.TRUCK
      cc.mouseButtons.middle = CameraControlsImpl.ACTION.DOLLY
      cc.mouseButtons.wheel = CameraControlsImpl.ACTION.DOLLY
      cc.touches.one = CameraControlsImpl.ACTION.TOUCH_ROTATE
      cc.touches.two = CameraControlsImpl.ACTION.TOUCH_DOLLY_TRUCK
      cc.touches.three = CameraControlsImpl.ACTION.TOUCH_TRUCK
    }
  }, [morphOpen])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      // Two-stage Esc: while the case board is open it closes the board
      // first (keeping the subgraph view); a second Esc resets to overview.
      if (morphOpen) {
        handleCloseCaseBoard()
        return
      }
      if (viewState.mode === "subgraph") handleReset()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [viewState.mode, handleReset, morphOpen, handleCloseCaseBoard])

  return (
    <div
      className="relative h-full w-full"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <Canvas
        camera={{ position: [0, 80, 0.1], fov: 50 }}
        style={{ background: "#05080c" }}
      >
        <ambientLight intensity={0.3} />
        {metroEnabled && (
          <>
            <MetroLinesLayer
              nodes={overlayNodes}
              edges={overlayEdges}
              onLineHover={setHoveredLine}
              activeLines={activeLines}
            />
            <MetroStationBullets
              nodes={overlayNodes}
              activeLines={activeLines}
              activeState={hoveredState}
            />
          </>
        )}
        <GraphView
          graph={graph}
          viewState={viewState}
          onNodeClick={handleNodeClick}
          onHoverChange={handleHoverChange}
          externalHoveredId={externalHoveredId}
          externalSelectedId={externalSelectedId}
          searchMatches={lineHoverMatches ?? stateHoverMatches ?? searchMatches}
          topMatchRanks={topMatchRanks}
          searchTerm={searchTerm}
          nodeTypeIcons={nodeTypeIcons}
          onResetView={handleReset}
          suppressHover={cameraInteracting}
          onGraphClick={() => {
            useGraphStore.getState().setSidebarSelectedNode(null)
            useGraphStore.getState().setHoveredNode(null)
          }}
        />
        {debugMarkers && (
          <DebugMarkers
            graph={graph}
            selectedNodeId={viewState.mode === "subgraph" ? viewState.selectedNodeId : null}
            camAnim={camAnim}
            clickAnchorRef={clickAnchorRef}
            cameraRef={cameraRef}
          />
        )}
        <OffscreenIndicators
          graph={graph}
          viewState={viewState}
          onNodeClick={handleNodeClick}
        />
        <PrevNodeIndicator
          graph={graph}
          viewState={viewState}
          onNodeClick={handleNodeClick}
        />
        <CaseViewTrigger
          graph={graph}
          selectedNodeId={
            viewState.mode === "subgraph" ? viewState.selectedNodeId : null
          }
          selectedApiNode={selectedApiNode}
          onOpen={handleOpenCaseView}
          disabled={morphOpen}
          camAnim={camAnim}
          suppressedRef={caseTriggerSuppressedRef}
        />
        {morphOpen && morphSelectedRefId && (
          <CaseBoardMorphLayer
            graph={graph}
            refIdToIndex={refIdToIndex}
            nodes={effectiveNodes}
            selectedRefId={morphSelectedRefId}
            morphProgress={morphProgress}
            cameraRef={cameraRef}
            projectionsRef={projectionsRef}
            cardPortalRef={boardLayerRef}
            cardElsRef={cardElsRef}
            items={boardItems}
          />
        )}
        <CameraControls
          ref={cameraRef}
          makeDefault
          dollySpeed={0.5}
          truckSpeed={1}
          dollyToCursor
        />
        <CameraInteractionTracker onChange={handleCameraInteractingChange} />
        <CameraSync camRef={cameraRef} targetRef={camAnim} />
        <EffectComposer>
          <Bloom
            luminanceThreshold={0.7}
            luminanceSmoothing={0.9}
            intensity={0.5}
          />
        </EffectComposer>
      </Canvas>

      {viewState.mode === "subgraph" && (
        <button
          onClick={handleReset}
          className="absolute bottom-4 right-4 rounded-md bg-background/80 px-3 py-1.5 text-xs text-foreground backdrop-blur hover:bg-background"
        >
          Reset view
        </button>
      )}

      {debugAvailable && (
        <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-md bg-background/80 px-2 py-1.5 text-xs text-foreground backdrop-blur">
          <button
            onClick={() => setDebugMarkers((v) => !v)}
            className={`rounded px-2 py-0.5 transition-colors ${
              debugMarkers
                ? "bg-foreground text-background"
                : "hover:bg-foreground/10"
            }`}
          >
            Debug markers {debugMarkers ? "on" : "off"}
          </button>
          {debugMarkers && (
            <div className="flex items-center gap-3 text-[10px] leading-none">
              <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ background: "#ffd11a" }} /> click anchor</span>
              <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ background: "#33ff66" }} /> live node</span>
              <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ background: "#ff33dd" }} /> cam target</span>
              <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ background: "#33e6ff" }} /> cam look</span>
            </div>
          )}
        </div>
      )}

      {/* Cream whiteboard backdrop — fades in to cover the 3D scene. Must
          outrank drei's default Html zIndexRange (~16.77M) so GraphView's
          node + edge labels disappear behind it, not bleed through. The
          case-board cards + SVG sit above this layer. */}
      {morphOpen && (
        <div
          className="absolute inset-0"
          style={{
            // Same hue family as the 3D scene bg (#05080c) plus a subtle
            // radial-gradient dot grid every 24px. Reads as graph paper /
            // case-board surface without being noisy.
            background: `
              radial-gradient(circle at center, rgba(180,200,220,0.06) 1px, transparent 1.4px) 0 0 / 24px 24px,
              #0a0e15
            `,
            // Cap below 1 so a faint ghost of the 3D scene shows through.
            opacity: morphProgress * CASE_BOARD_BACKDROP_OPACITY,
            zIndex: CASE_BOARD_Z.backdrop,
            pointerEvents: "none",
          }}
        />
      )}
      {/* Persistent layer that hosts the case-board cards (Html portals
          from NodeMorph) and the SVG connectors. Stays mounted so the
          drei portal ref is always populated; only takes pointer events
          + applies pan/zoom transform when the morph is open. Translate +
          scale happen here so the 3D camera underneath stays still. */}
      <div
        ref={boardLayerRef}
        onMouseDown={morphOpen ? handleBoardMouseDown : undefined}
        onMouseMove={morphOpen ? handleBoardMouseMove : undefined}
        onMouseUp={morphOpen ? handleBoardMouseUp : undefined}
        onMouseLeave={morphOpen ? handleBoardMouseUp : undefined}
        onWheel={morphOpen ? handleBoardWheel : undefined}
        style={{
          position: "absolute",
          inset: 0,
          // Always above the cream backdrop so cards + connectors render
          // on top; inert when the morph isn't open.
          zIndex: CASE_BOARD_Z.cardFar,
          pointerEvents: morphOpen ? "auto" : "none",
          cursor: morphOpen ? (isDragging ? "grabbing" : "grab") : "default",
          // transform applied imperatively via applyBoardTransform (above) so
          // dragging / zooming never re-renders this tree.
          transformOrigin: "center center",
          willChange: "transform",
          // No transform transition: zoom is cursor-anchored and applied
          // per wheel event, so a lagging transition would make the anchor
          // point visibly drift. Smoothness comes from the delta-scaled
          // exponential step instead.
          transition: "none",
        }}
      >
      </div>
      {morphOpen && (
        <CaseBoardConnectorsSvg
          cardElsRef={cardElsRef}
          edges={boardConnectorEdges}
          morphProgress={morphProgress}
        />
      )}
      {morphOpen && (
        <button
          onClick={handleCloseCaseBoard}
          title="Close case board (Esc)"
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            width: 36,
            height: 36,
            borderRadius: 18,
            border: "1px solid rgba(180,195,210,0.2)",
            background: "rgba(15,20,28,0.85)",
            color: "#e6edf3",
            backdropFilter: "blur(8px)",
            fontSize: 18,
            lineHeight: 1,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            opacity: morphProgress,
            transition: "opacity 200ms",
            zIndex: CASE_BOARD_Z.button,
          }}
        >
          ✕
        </button>
      )}

      <HoverPreviewCard node={hoveredCardNode} schemas={schemas} x={cursor.x} y={cursor.y} />

      {metroEnabled && (
        <MetroLegend hoveredState={hoveredState} onHoverState={setHoveredState} />
      )}

    </div>
  )
}
