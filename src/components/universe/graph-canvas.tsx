"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { CameraControls } from "@react-three/drei"
import { EffectComposer, Bloom } from "@react-three/postprocessing"
import { Vector3 } from "three"
import * as THREE from "three"
import type CameraControlsImpl from "camera-controls"
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
import { DISPLAY_KEY_FALLBACKS } from "@/lib/node-display"
import { isMetroTheme } from "@/lib/theme"
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

function computeCamTarget(graph: Graph, nodeId: number): CamTarget {
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
  return {
    posX: p.x,
    posY: p.y + cameraHeight,
    posZ: p.z + 0.1,
    lookX: p.x,
    lookY: p.y,
    lookZ: p.z,
  }
}

const OVERVIEW_CAM: CamTarget = {
  posX: 0, posY: 80, posZ: 0.1,
  lookX: 0, lookY: 0, lookZ: 0,
}

function smoothstep(x: number) {
  return x * x * (3 - 2 * x)
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
  useFrame((_, delta) => {
    const cam = camRef.current
    if (!cam) return
    const state = targetRef.current
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

  // The metro overlay is theme-driven, not data-driven. We want the
  // schematic to stay visible even when search replaces the graph store
  // with results that don't include Station nodes — so the lines, bullets
  // and legend always render from the local metro fixture in metro theme,
  // independent of whatever the current dataset is.
  const isMetroView = isMetroTheme()
  const overlayNodes = isMetroView ? (metroSeries.nodes as ApiNode[]) : []
  const overlayEdges = isMetroView ? (metroSeries.edges as ApiEdge[]) : []

  // In metro theme, the *interactive* station layer (3D spheres + labels +
  // hover behavior provided by GraphView) also has to persist through
  // search, not just the schematic bullets. So we splice fixture stations
  // and TUNNEL_TO edges into whatever the graph store currently has before
  // running the radial layout. De-dupe by ref_id / edge identity so a
  // future search that does return a station won't double-render it.
  const effectiveNodes = useMemo(() => {
    if (!isMetroView) return nodes
    const seen = new Set(nodes.map((n) => n.ref_id))
    const fixtureStations = (metroSeries.nodes as ApiNode[]).filter(
      (n) => n.node_type === "Station" && !seen.has(n.ref_id)
    )
    return fixtureStations.length > 0 ? [...nodes, ...fixtureStations] : nodes
  }, [isMetroView, nodes])

  const effectiveEdges = useMemo(() => {
    if (!isMetroView) return edges
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
  }, [isMetroView, edges, effectiveNodes])

  const { graph, indexMap, refIdToIndex } = useMemo(() => {
    const result = apiToGraph(effectiveNodes, effectiveEdges, schemas)
    // Force the Y-lift on the lore graph in metro theme even when the
    // dataset doesn't carry fixed-position nodes (e.g. after a search).
    // Otherwise search results would drop to y=0 where the schematic sits.
    applyLayout(result.graph, result.fixedPositions, isMetroView)
    return result
  }, [effectiveNodes, effectiveEdges, schemas, isMetroView])

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
  const [hoveredCardNode, setHoveredCardNode] = useState<ApiNode | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  // Metro overlay focus state — driven by hovering the lines (3D) or the
  // legend (DOM). null when nothing is hovered, which leaves every line and
  // bullet at full opacity.
  const [hoveredLine, setHoveredLine] = useState<string | null>(null)
  const [hoveredState, setHoveredState] = useState<StationState | null>(null)

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
  }, [dataVersion, setCamTarget])

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
  // rest). Returns null outside the metro view.
  const stateHoverMatches = useMemo(() => {
    if (!isMetroView || !hoveredState) return null
    const set = new Set<number>()
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].node_type !== "Station") continue
      const p = nodes[i].properties as Record<string, unknown> | undefined
      if (!p) continue
      const status = p.station_status ?? p.status
      if (statusToState(status, p.faction) === hoveredState) set.add(i)
    }
    return set.size > 0 ? set : null
  }, [nodes, hoveredState, isMetroView])

  // Hovering a metro line spotlights every node tagged with that line.
  const lineHoverMatches = useMemo(() => {
    if (!isMetroView || !hoveredLine) return null
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
  }, [nodes, hoveredLine, isMetroView])

  // ref_id → set of metro line colors the node is associated with. Stations
  // contribute their own line property; non-station nodes inherit lines from
  // any station they share an edge with (1-hop). Used to dim unrelated
  // lines/bullets when a node is hovered or selected.
  const nodeToLines = useMemo(() => {
    if (!isMetroView) return new Map<string, Set<string>>()
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
  }, [nodes, edges, isMetroView])

  // Lines currently in focus. Hovering a line directly wins; otherwise the
  // active node (hover beats select; canvas beats sidebar) contributes its
  // associated lines. `null` means no dimming — every line at full opacity.
  const activeLines = useMemo<Set<string> | null>(() => {
    if (!isMetroView) return null
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
    isMetroView,
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
    setCamTarget(computeCamTarget(graph, topIdx))
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
      // anchor were moving in opposite directions.
      setCamTarget(computeCamTarget(graph, nodeId))

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && viewState.mode === "subgraph") handleReset()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [viewState.mode, handleReset])

  return (
    <div
      className="relative h-full w-full"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <Canvas
        camera={{ position: [0, 80, 0.1], fov: 50 }}
        style={{ background: "oklch(0.06 0.02 260)" }}
      >
        <ambientLight intensity={0.3} />
        {isMetroView && (
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
        <CameraControls
          ref={cameraRef}
          makeDefault
          dollySpeed={0.5}
          truckSpeed={1}
          dollyToCursor
        />
        <CameraSync camRef={cameraRef} targetRef={camAnim} />
        <EffectComposer>
          <Bloom
            luminanceThreshold={0.2}
            luminanceSmoothing={0.9}
            intensity={0.6}
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

      <HoverPreviewCard node={hoveredCardNode} schemas={schemas} x={cursor.x} y={cursor.y} />

      {isMetroView && (
        <MetroLegend hoveredState={hoveredState} onHoverState={setHoveredState} />
      )}
    </div>
  )
}
