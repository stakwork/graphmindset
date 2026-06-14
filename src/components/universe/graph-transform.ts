// Pure data → graph → layout pipeline for the universe view.
//
// This module is intentionally free of React/three: it maps the flat backend
// API payload (nodes + edges) into a `Graph` ready for the radial layout, runs
// the layout, and provides the click-time re-scale helpers. Keeping it pure
// makes the transform logic (grouping, clustering, hierarchy inversion) easy to
// reason about and test in isolation from the renderer.

import {
  buildGraph,
  computeRadialLayout,
  extractInitialSubgraph,
  extractSubgraph,
  adaptiveRadius,
  VIRTUAL_CENTER,
} from "@/graph-viz-kit"
import type { Graph, RawNode, RawEdge, Vec3, GraphNode as VizNode, GraphEdge as VizEdge } from "@/graph-viz-kit"
import type { GraphNode as ApiNode, GraphEdge as ApiEdge } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"
import { DISPLAY_KEY_FALLBACKS, resolveNodeThumbnail } from "@/lib/node-display"
import { METRO_FORCE_GROUPED_TYPES, LORE_Y_LIFT } from "./metro-overlay"

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
  return label.length > MAX_LABEL_LENGTH ? label.slice(0, MAX_LABEL_LENGTH) + "…" : label
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

export function apiToGraph(
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
  // A type gets its own synthetic group node when it has orphans, OR when it
  // has ≥ CLUSTER_THRESHOLD top-level (parentless / root) nodes in the CURRENT
  // payload. Crowd-grouping keys purely on count: no overall root-count gate
  // and no "leaf-like" filter — a parentless node is top-level *right now*
  // regardless of whether it has children loaded or a parent that exists only
  // in the DB. Fixed-position (metro) nodes never count toward or get folded
  // into a hub — their position is data-driven.
  const orphanTypes = new Set(
    orphans.filter((o) => !fixedRefIds.has(o.ref_id)).map((o) => o.node_type || "Unknown")
  )
  const rootCountByType = new Map<string, number>()
  for (const r of roots) {
    if (fixedRefIds.has(r.ref_id)) continue
    const type = r.node_type || "Unknown"
    rootCountByType.set(type, (rootCountByType.get(type) ?? 0) + 1)
  }
  const crowdGroupedTypes = new Set<string>()
  for (const [type, count] of rootCountByType) {
    if (count >= CLUSTER_THRESHOLD) crowdGroupedTypes.add(type)
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

  // Set nodeType (and thumbnail, when present) on real nodes
  for (let i = 0; i < nodes.length; i++) {
    graph.nodes[i].nodeType = nodes[i].node_type
    const thumb = resolveNodeThumbnail(nodes[i])
    if (thumb) graph.nodes[i].imageUrl = thumb
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

export function applyLayout(
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
export const DEPTH_SHRINK = 0.45

// Re-scale the graph about a fixed anchor node. The anchor (the clicked
// node) stays at its current position; every other node's offset *from the
// anchor* in the original layout is multiplied by `scale`. With
// scale = 1/0.45^d, the anchor's children land on a true R1 ring while the
// anchor itself doesn't move on screen — no camera motion required.
export function rescaleAroundAnchor(graph: Graph, anchorId: number, scale: number) {
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

export function restoreOriginalPositions(graph: Graph) {
  if (!graph.originalPositions) return
  for (const [id, orig] of graph.originalPositions) {
    if (id < graph.nodes.length) {
      graph.nodes[id].position = { x: orig.x, y: orig.y, z: orig.z }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Incremental append + descendant relayout (ported from upstream
// reposition-on-load). Adds fetched nodes WITHOUT a global rebuild/rescale,
// then re-lays-out only the selected node's subtree. This is the camera fix.
// ─────────────────────────────────────────────────────────────────────
const APPEND_CHILD_R = 33
// Small per-depth vertical drop so appended children tier below their parent,
// mirroring computeRadialLayout's y-offset feel without recomputing it.
const APPEND_Y_DROP = 4.5

// Place a batch of freshly-appended `kids` on a ring around their already-placed
// `parent`, updating the derived layout structures (depth, originals, tree
// edges, childrenOf) so the new nodes behave like first-class layout members on
// subsequent clicks/rescales.
function placeChildren(
  nodes: VizNode[],
  parent: number,
  kids: number[],
  initialDepthMap: Map<number, number>,
  originalPositions: Map<number, Vec3>,
  childrenOf: Map<number, number[]>,
  treeEdgeSet: Set<string>
): void {
  const pPos = nodes[parent].position
  const childDepth = (initialDepthMap.get(parent) ?? 0) + 1

  const existingKids = childrenOf.get(parent) ?? []
  const existingCount = existingKids.length
  const total = existingCount + kids.length

  // Radius sized by the total child count — same adaptiveRadius hop-1 uses — so
  // a parent that fetches many neighbors gets a proportionally larger ring
  // instead of crowding them all onto a fixed-radius circle (the center-clump
  // bug). If the parent already has placed children, average their radius
  // instead so appended nodes stay on the subtree's established ring.
  let R = Math.max(APPEND_CHILD_R, adaptiveRadius(total))
  if (existingCount > 0) {
    let sum = 0
    let cnt = 0
    for (const k of existingKids) {
      const kp = nodes[k]?.position
      if (!kp) continue
      sum += Math.hypot(kp.x - pPos.x, kp.z - pPos.z)
      cnt++
    }
    if (cnt > 0) R = sum / cnt
  }

  // Fan outward (away from origin), continuing past any existing children so
  // new arrivals don't stack on top of them.
  const outward = Math.atan2(pPos.z, pPos.x) || 0
  const step = (Math.PI * 2) / Math.max(total, 1)

  if (!childrenOf.has(parent)) childrenOf.set(parent, [])
  const kidList = childrenOf.get(parent)!

  for (let j = 0; j < kids.length; j++) {
    const v = kids[j]
    const phi = outward + (existingCount + j) * step
    const pos: Vec3 = {
      x: pPos.x + Math.cos(phi) * R,
      y: pPos.y - APPEND_Y_DROP,
      z: pPos.z + Math.sin(phi) * R,
    }
    nodes[v].position = pos
    originalPositions.set(v, { ...pos })
    initialDepthMap.set(v, childDepth)
    kidList.push(v)
    treeEdgeSet.add(parent < v ? `${parent}-${v}` : `${v}-${parent}`)
  }
}

export interface GraphModel {
  graph: Graph
  indexMap: Map<number, string>
  refIdToIndex: Map<string, number>
}

interface AppendResult {
  model: GraphModel
  /** Indices of the nodes added by this append. */
  newNodeIds: number[]
  /** For each appended node, the node it was placed under (absent for strays). */
  parentOf: Map<number, number>
}

// Fold freshly-fetched nodes/edges into an existing graph WITHOUT re-running
// apiToGraph or the global radial layout. Existing node objects are reused
// verbatim (same positions, same indices) so a click-driven 1-hop fetch just
// attaches the new nodes around their parent — no reshuffle, no camera jump.
// This is the path GraphView's `nodeCountGrew` snap branch was written for.
//
// Grouping IS applied, but only to the freshly-arriving batch: new children of
// the same (source, edge_type, target_type) that cross CLUSTER_THRESHOLD get a
// synthetic `_cluster` proxy (source → proxy → members), mirroring apiToGraph.
// Because append never rebuilds, a proxy created here becomes a permanent node
// with a fixed index — no cross-rebuild identity drift, which is what sank the
// old position-cache attempts. Existing nodes (and their existing clustering)
// are never re-evaluated.
export function appendToGraph(
  model: GraphModel,
  apiNodes: ApiNode[],
  apiEdges: ApiEdge[],
  schemas: SchemaNode[]
): AppendResult | null {
  const prev = model.graph
  const oldCount = prev.nodes.length

  const refIdToIndex = new Map(model.refIdToIndex)
  const indexMap = new Map(model.indexMap)

  // ── New real nodes (members). Append-only: existing indices stay put. ──
  // Drill-down rule: a fetched node is kept ONLY if it can attach as a
  // descendant of something already on screen — i.e. it is reachable, through
  // the freshly-fetched edges, from an existing node. New nodes that connect
  // only to other new nodes with no path back into the current graph are
  // strays that don't belong under the selected node's hierarchy, so they are
  // dropped outright (not parked on an outer ring). Reachability is undirected
  // — we are grafting the new material below the selection, regardless of the
  // original edge direction.
  const existingRefIds = new Set(refIdToIndex.keys())
  const refAdj = new Map<string, string[]>()
  const linkRef = (a: string, b: string) => {
    const l = refAdj.get(a)
    if (l) l.push(b)
    else refAdj.set(a, [b])
  }
  for (const e of apiEdges) {
    linkRef(e.source, e.target)
    linkRef(e.target, e.source)
  }
  const reachableNew = new Set<string>()
  const visited = new Set<string>(existingRefIds)
  const queue: string[] = []
  for (const ref of existingRefIds) if (refAdj.has(ref)) queue.push(ref)
  for (let qi = 0; qi < queue.length; qi++) {
    for (const nb of refAdj.get(queue[qi]) ?? []) {
      if (visited.has(nb)) continue
      visited.add(nb)
      reachableNew.add(nb) // existing refs were pre-seeded, so nb is always new
      queue.push(nb)
    }
  }
  const newApiNodes = apiNodes.filter(
    (n) => !refIdToIndex.has(n.ref_id) && reachableNew.has(n.ref_id)
  )
  const memberObjs: VizNode[] = newApiNodes.map((n, k) => {
    const thumb = resolveNodeThumbnail(n)
    return {
      id: oldCount + k,
      label: truncateLabel(nodeLabel(n, schemas)),
      position: { x: 0, y: 0, z: 0 },
      degree: 0,
      nodeType: n.node_type,
      ...(thumb != null && { imageUrl: thumb }),
    }
  })
  for (let k = 0; k < newApiNodes.length; k++) {
    const idx = oldCount + k
    refIdToIndex.set(newApiNodes[k].ref_id, idx)
    indexMap.set(idx, newApiNodes[k].ref_id)
  }

  const typeOf = (i: number): string =>
    (i < oldCount ? prev.nodes[i].nodeType : newApiNodes[i - oldCount]?.node_type) || "Unknown"
  const isNew = (i: number): boolean => i >= oldCount

  // ── Resolve candidate new edges (hierarchy rewrite, resolve, dedupe) ──
  interface Cand {
    src: number
    dst: number
    edge_type: string
  }
  // Dedup against BOTH live edges and cluster-absorbed originals. The absorbed
  // source→member edges live in extraEdges (pulled out of graph.edges when the
  // cluster formed); if we don't count them here, a re-fetch that returns the
  // same source→member edge re-adds it as a live direct edge, bypassing the
  // proxy and flattening the hierarchy (chapters/locations jump back to hop-1).
  const seen = new Set([
    ...prev.edges.map((e) => `${e.src} ${e.dst}`),
    ...(prev.extraEdges ?? []).map((e) => `${e.src} ${e.dst}`),
  ])
  const candidates: Cand[] = []
  for (const raw of apiEdges) {
    const e = INVERT_FOR_HIERARCHY.has(raw.edge_type)
      ? { source: raw.target, target: raw.source, edge_type: raw.edge_type }
      : raw
    const src = refIdToIndex.get(e.source)
    const dst = refIdToIndex.get(e.target)
    if (src === undefined || dst === undefined || src === dst) continue
    const key = `${src} ${dst}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ src, dst, edge_type: e.edge_type })
  }

  if (memberObjs.length === 0 && candidates.length === 0) return null

  // ── Bundle fresh child edges by (source, edge_type, target_type). ──
  const bundles = new Map<
    string,
    { src: number; edge_type: string; tgtType: string; edges: Cand[] }
  >()
  for (const c of candidates) {
    if (!isNew(c.dst)) continue
    const tgtType = typeOf(c.dst)
    const key = `${c.src} ${c.edge_type} ${tgtType}`
    let b = bundles.get(key)
    if (!b) {
      b = { src: c.src, edge_type: c.edge_type, tgtType, edges: [] }
      bundles.set(key, b)
    }
    b.edges.push(c)
  }

  // ── Reconcile each bundle against what the source ALREADY has for the same
  //    key, so a relationship never ends up split across direct edges + one-or-
  //    more proxies (the cluster-bypass bug). Two things get merged in:
  //      • an existing `_cluster` proxy for the key → reuse it (no second
  //        proxy); new members route through it.
  //      • the source's existing *direct leaf* children of the key → absorb
  //        them: their direct edge moves to extraEdges and they re-home onto
  //        the proxy ring (a localized move of just those leaves).
  //    A key clusters when existing-direct + existing-proxy-members + new
  //    members together cross the threshold — not just the fresh batch. ──
  const edgeLabelOf = new Map<string, string>()
  for (const e of prev.edges) edgeLabelOf.set(`${e.src} ${e.dst}`, e.label ?? "")
  const isSynthetic = (i: number): boolean => {
    const t = i < oldCount ? prev.nodes[i].nodeType : typeOf(i)
    return t === "_cluster" || t === "_group"
  }
  const isProxyChild = (i: number): boolean =>
    (prev.inAdj[i] ?? []).some((p) => p < oldCount && prev.nodes[p].nodeType === "_cluster")
  // Real, non-synthetic leaf (no real children of its own) — safe to re-home
  // onto a proxy without stranding a subtree underneath it.
  const isAbsorbableLeaf = (i: number): boolean => {
    if (i >= oldCount || isSynthetic(i)) return false
    for (const ch of prev.outAdj[i] ?? []) if (!isSynthetic(ch)) return false
    return true
  }

  // Existing same-key proxies in the prev graph, keyed exactly like `bundles`.
  const existingProxyByKey = new Map<string, number>()
  for (let i = 0; i < oldCount; i++) {
    if (prev.nodes[i].nodeType !== "_cluster") continue
    const psrc = (prev.inAdj[i] ?? [])[0]
    if (psrc === undefined) continue
    const et = edgeLabelOf.get(`${psrc} ${i}`) ?? ""
    const tt = prev.nodes[i].clusterMemberType ?? ""
    existingProxyByKey.set(`${psrc} ${et} ${tt}`, i)
  }

  const absorbed = new Set<Cand>()
  const proxyObjs: VizNode[] = []
  const proxyRouting: {
    proxy: number
    src: number
    members: number[]
    absorb: number[]
    edge_type: string
    isExisting: boolean
  }[] = []
  let proxyCursor = oldCount + memberObjs.length
  for (const b of bundles.values()) {
    const key = `${b.src} ${b.edge_type} ${b.tgtType}`
    const existingProxy = existingProxyByKey.get(key)

    // Source's existing direct leaf children of the same key, eligible to absorb.
    const absorb: number[] = []
    for (const m of prev.outAdj[b.src] ?? []) {
      if (!isAbsorbableLeaf(m)) continue
      if (typeOf(m) !== b.tgtType) continue
      if ((edgeLabelOf.get(`${b.src} ${m}`) ?? "") !== b.edge_type) continue
      if (isProxyChild(m)) continue
      absorb.push(m)
    }

    const existingMembers =
      existingProxy !== undefined ? (prev.outAdj[existingProxy]?.length ?? 0) : 0
    const prospective = b.edges.length + absorb.length + existingMembers

    // No existing proxy and not enough to form one → leave as direct edges.
    if (existingProxy === undefined && prospective < CLUSTER_THRESHOLD) continue

    let proxy: number
    if (existingProxy !== undefined) {
      proxy = existingProxy
    } else {
      proxy = proxyCursor++
      proxyObjs.push({
        id: proxy,
        label: "", // finalized from the true member count once edges are wired
        position: { x: 0, y: 0, z: 0 },
        degree: 0,
        nodeType: "_cluster",
        clusterMemberType: b.tgtType,
      })
    }

    proxyRouting.push({
      proxy,
      src: b.src,
      members: b.edges.map((e) => e.dst),
      absorb,
      edge_type: b.edge_type,
      isExisting: existingProxy !== undefined,
    })
    for (const e of b.edges) absorbed.add(e)
  }

  // Each clustered member → its cluster source. Used to drop ANY direct edge
  // between the two (including the reciprocal member→source the backend often
  // also returns) so it doesn't bypass the proxy with a direct line.
  const memberSource = new Map<number, number>()
  for (const r of proxyRouting) for (const m of r.members) memberSource.set(m, r.src)

  const nodes: VizNode[] = [...prev.nodes, ...memberObjs, ...proxyObjs]
  const total = nodes.length

  // Absorbed existing leaves get re-positioned, and reused existing proxies get
  // a fresh label/degree — clone those node objects so prev's stay untouched.
  for (const r of proxyRouting) {
    if (r.isExisting) nodes[r.proxy] = { ...nodes[r.proxy] }
    for (const m of r.absorb) nodes[m] = { ...nodes[m] }
  }

  // ── Adjacency: copy existing rows, empty rows for new members + proxies ──
  const adj: number[][] = new Array(total)
  const outAdj: number[][] = new Array(total)
  const inAdj: number[][] = new Array(total)
  for (let i = 0; i < total; i++) {
    adj[i] = i < oldCount ? prev.adj[i].slice() : []
    outAdj[i] = i < oldCount ? prev.outAdj[i].slice() : []
    inAdj[i] = i < oldCount ? prev.inAdj[i].slice() : []
  }

  const edges: VizEdge[] = prev.edges.slice()
  const extraEdges: VizEdge[] = (prev.extraEdges ?? []).slice()
  const addEdge = (src: number, dst: number, label: string) => {
    edges.push({ src, dst, label })
    adj[src].push(dst)
    adj[dst].push(src)
    outAdj[src].push(dst)
    inAdj[dst].push(src)
  }
  const removeOne = (arr: number[], val: number) => {
    const k = arr.indexOf(val)
    if (k !== -1) arr.splice(k, 1)
  }
  // Strip the direct edge between two nodes (either direction) from the live
  // edge list + adjacency, so an absorbed leaf no longer connects to its old
  // source — its relation lives on the proxy spoke + extraEdges instead.
  const detachDirect = (s: number, d: number) => {
    for (let k = edges.length - 1; k >= 0; k--) {
      const e = edges[k]
      if ((e.src === s && e.dst === d) || (e.src === d && e.dst === s)) edges.splice(k, 1)
    }
    removeOne(adj[s], d)
    removeOne(adj[d], s)
    removeOne(outAdj[s], d)
    removeOne(inAdj[d], s)
    removeOne(outAdj[d], s)
    removeOne(inAdj[s], d)
  }

  // Proxy routing: source → proxy → members in the layout; the absorbed
  // source → member originals move to extraEdges (surfaced on hover/select,
  // matching apiToGraph). GraphView drops the proxy → member spokes from the
  // render automatically (edges out of a `_cluster` node).
  for (const r of proxyRouting) {
    // Reused proxies already carry the source → proxy edge; only new ones need it.
    if (!r.isExisting) addEdge(r.src, r.proxy, r.edge_type)
    for (const m of r.members) {
      addEdge(r.proxy, m, r.edge_type)
      extraEdges.push({ src: r.src, dst: m, label: r.edge_type })
    }
    // Absorb existing direct leaves: cut the bypassing source → leaf edge and
    // re-route it through the proxy (spoke + extraEdge), exactly like a new
    // member, so nothing connects to the source except via the cluster.
    for (const m of r.absorb) {
      detachDirect(r.src, m)
      addEdge(r.proxy, m, r.edge_type)
      extraEdges.push({ src: r.src, dst: m, label: r.edge_type })
    }
  }
  // Non-clustered new edges go in directly — except a direct member↔source
  // edge (either direction), which the proxy routing already represents.
  for (const c of candidates) {
    if (absorbed.has(c)) continue
    if (memberSource.get(c.src) === c.dst || memberSource.get(c.dst) === c.src) continue
    addEdge(c.src, c.dst, c.edge_type)
  }

  for (let i = oldCount; i < total; i++) nodes[i].degree = adj[i].length

  // Proxy label + degree reflect the FINAL member count (existing + absorbed +
  // new) — outAdj[proxy] now holds every spoke, so its length IS the count.
  for (const r of proxyRouting) {
    const p = nodes[r.proxy]
    p.label = `${p.clusterMemberType ?? ""} × ${outAdj[r.proxy].length} · ${r.edge_type}`
    p.degree = adj[r.proxy].length
  }

  // ── Clone derived structures so prev stays intact ──
  const childrenOf = new Map<number, number[]>()
  if (prev.childrenOf) for (const [k, v] of prev.childrenOf) childrenOf.set(k, v.slice())
  const treeEdgeSet = new Set(prev.treeEdgeSet ?? [])
  const initialDepthMap = new Map(prev.initialDepthMap ?? [])
  const originalPositions = new Map(prev.originalPositions ?? [])

  // Re-home absorbed leaves in the tree structures: drop their old source link
  // so placeChildren re-attaches them under the proxy (with a fresh position)
  // in the placement pass below.
  const absorbSet = new Set<number>()
  for (const r of proxyRouting) {
    for (const m of r.absorb) {
      absorbSet.add(m)
      const sibs = childrenOf.get(r.src)
      if (sibs) removeOne(sibs, m)
      treeEdgeSet.delete(r.src < m ? `${r.src}-${m}` : `${m}-${r.src}`)
    }
  }

  // ── Place new nodes around an already-placed parent, in waves so chains of
  //    new nodes (A→B→C) place parents before their children. Absorbed leaves
  //    are treated like new nodes here so they re-home onto the proxy ring. ──
  const parentOf = new Map<number, number>()
  const placed = new Set<number>()
  for (let i = 0; i < oldCount; i++) if (!absorbSet.has(i)) placed.add(i)

  // A clustered member must hang off its proxy, never a cross-edge neighbor —
  // so it waits for the proxy rather than falling back to inAdj/adj.
  const forcedParent = new Map<number, number>()
  for (const r of proxyRouting) {
    for (const m of r.members) forcedParent.set(m, r.proxy)
    for (const m of r.absorb) forcedParent.set(m, r.proxy)
  }

  const pickParent = (v: number): number | undefined => {
    const forced = forcedParent.get(v)
    if (forced !== undefined) return placed.has(forced) ? forced : undefined
    for (const p of inAdj[v]) if (placed.has(p)) return p // directed parent first
    for (const p of adj[v]) if (placed.has(p)) return p // else any placed neighbor
    return undefined
  }

  let pending = [
    ...proxyObjs.map((n) => n.id),
    ...memberObjs.map((n) => n.id),
    ...absorbSet,
  ]
  let progress = true
  while (pending.length > 0 && progress) {
    progress = false
    const byParent = new Map<number, number[]>()
    const stillPending: number[] = []
    for (const v of pending) {
      const p = pickParent(v)
      if (p === undefined) {
        stillPending.push(v)
        continue
      }
      if (!byParent.has(p)) byParent.set(p, [])
      byParent.get(p)!.push(v)
    }
    for (const [p, kids] of byParent) {
      placeChildren(nodes, p, kids, initialDepthMap, originalPositions, childrenOf, treeEdgeSet)
      for (const v of kids) {
        placed.add(v)
        parentOf.set(v, p)
      }
      progress = true
    }
    pending = stillPending
  }

  // Defensive: true strays (new nodes with no path back to the graph) are now
  // dropped upstream by the descendant-reachability filter, so this should be
  // empty. Anything still here only reached the graph through a directed edge
  // pickParent couldn't resolve — park it on an outer ring rather than lose it.
  if (pending.length > 0) {
    let maxR = APPEND_CHILD_R
    for (const pos of originalPositions.values()) {
      const r = Math.hypot(pos.x, pos.z)
      if (r > maxR) maxR = r
    }
    const ringR = maxR * 1.2 + 20
    const step = (Math.PI * 2) / pending.length
    for (let i = 0; i < pending.length; i++) {
      const v = pending[i]
      const pos: Vec3 = { x: Math.cos(i * step) * ringR, y: 0, z: Math.sin(i * step) * ringR }
      nodes[v].position = pos
      originalPositions.set(v, { ...pos })
      initialDepthMap.set(v, 1)
    }
  }

  const graph: Graph = {
    ...prev,
    nodes,
    edges,
    adj,
    outAdj,
    inAdj,
    extraEdges,
    childrenOf,
    treeEdgeSet,
    initialDepthMap,
    originalPositions,
  }
  return {
    model: { graph, indexMap, refIdToIndex },
    newNodeIds: [...proxyObjs, ...memberObjs].map((n) => n.id),
    parentOf,
  }
}

// logging select / merge / recalculate steps.
export function describeSubgraph(
  graph: Graph,
  centerId: number,
  useAdj: "directed" | "undirected" = "directed"
) {
  const lbl = (id: number) => graph.nodes[id]?.label ?? `#${id}`
  const sub = extractSubgraph(graph, centerId, 1000, { useAdj })
  return {
    center: lbl(centerId),
    total: sub.nodeIds.length,
    depthCounts: sub.neighborsByDepth.map((ds) => ds.length),
    byDepth: sub.neighborsByDepth.map(
      (ds, i) => `d${i + 1} (${ds.length}): ${ds.map(lbl).join(", ")}`
    ),
  }
}

// Recompute ONLY the selected node's descendant subgraph as a fresh radial,
// translated so the selected node stays exactly where it already is (camera
// doesn't move). Ancestors and unrelated branches are left untouched. This is
// the "add new node, recalculate the subgraph" model — after a fetch folds new
// descendants in, we relay them out cleanly instead of patching positions in
// place. Updates positions, originalPositions, the tree-edge set and depth map
// for the recomputed nodes so rescale/reset/edge-rendering stay consistent.
export function recomputeDescendantLayout(graph: Graph, selectedId: number, oldCount: number) {
  const anchorNode = graph.nodes[selectedId]
  if (!anchorNode) return

  // Descendants only (directed BFS via outAdj) — never climbs to ancestors.
  const sub = extractSubgraph(graph, selectedId, 1000, { useAdj: "directed" })
  // If the fetch surfaced the selected node's hierarchical PARENT for the first
  // time (e.g. clicking a parentless Claim pulls in its Chapter, which is
  // chapter→claim, so the chapter is the claim's parent / inAdj), hand it to
  // computeRadialLayout as the parentId so it lands in the dedicated parent slot
  // opposite the children — not grafted as a stray. Only a BRAND-NEW parent is
  // placed; an ancestor already on screen is left where it is.
  const newParentId = graph.inAdj[selectedId]?.find((p) => p >= oldCount)
  const { positions, treeEdgeSet, childrenOf } = computeRadialLayout(
    selectedId,
    sub.neighborsByDepth,
    graph.edges,
    newParentId !== undefined ? { parentId: newParentId } : undefined
  )

  // Two scales coexist while a node is selected:
  //  • LIVE positions (what you see) — the spread-out view: computeRadialLayout
  //    already emits this at R1 ring scale, so new nodes match the existing
  //    spread-out children.
  //  • originalPositions (the collapse target on deselect) — the compact global
  //    layout, where a depth-`d` node's rings are shrunk by DEPTH_SHRINK^d.
  // Writing the spread value to BOTH (the old bug) bakes the spread in so
  // deselect can't collapse. So: live = full spread, original = spread × shrink.
  const depth = Math.max(0, graph.initialDepthMap?.get(selectedId) ?? 0)
  const shrink = Math.pow(DEPTH_SHRINK, depth)

  console.log(
    "[recalc] recomputed descendant subgraph",
    { depth, shrink, ...describeSubgraph(graph, selectedId, "directed") }
  )

  // Stable placement so existing nodes are *trackable* across the relayout.
  // Walk the recomputed tree from the selected node (which stays fixed at its
  // current spot). For each parent, its children share one ring — common radius
  // + y-offset, evenly-spaced angle slots. Assign each EXISTING child to the
  // slot nearest its CURRENT angle, and give NEW children the leftover slots.
  // Existing nodes drift to the closest spot (small, followable move) instead of
  // being reshuffled; new nodes fall into the gaps and fly in.
  const anchor = { ...anchorNode.position }
  const angDiff = (a: number, b: number) =>
    Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
  type P3 = { x: number; y: number; z: number }
  const live = new Map<number, P3>()
  live.set(selectedId, anchor)

  const queue: number[] = [selectedId]
  while (queue.length > 0) {
    const P = queue.shift()!
    const kids = childrenOf.get(P) ?? []
    if (kids.length === 0) continue
    const Pnew = positions.get(P)
    const Pfin = live.get(P)
    if (!Pnew || !Pfin) continue

    // Each kid's recompute offset from its parent → (radius, y-delta, slot angle).
    const slot = kids.map((k) => {
      const pk = positions.get(k) ?? Pnew
      const dx = pk.x - Pnew.x, dy = pk.y - Pnew.y, dz = pk.z - Pnew.z
      return { r: Math.hypot(dx, dz), y: dy, angle: Math.atan2(dz, dx) }
    })

    const assigned = new Array<number>(kids.length).fill(-1)
    const freeSlots = new Set(kids.map((_, i) => i))
    const existing: number[] = []
    kids.forEach((k, i) => {
      if (k < oldCount) existing.push(i)
    })

    // Greedy global nearest-slot match for existing kids (minimizes total angular
    // movement); whatever's left goes to new kids in order.
    const pairs: { ki: number; si: number; d: number }[] = []
    for (const ki of existing) {
      const c = graph.nodes[kids[ki]].position
      const a = Math.atan2(c.z - Pfin.z, c.x - Pfin.x)
      for (let si = 0; si < kids.length; si++) {
        pairs.push({ ki, si, d: angDiff(a, slot[si].angle) })
      }
    }
    pairs.sort((p, q) => p.d - q.d)
    for (const { ki, si } of pairs) {
      if (assigned[ki] !== -1 || !freeSlots.has(si)) continue
      assigned[ki] = si
      freeSlots.delete(si)
    }
    const leftovers = [...freeSlots]
    let li = 0
    for (let i = 0; i < kids.length; i++) {
      if (assigned[i] === -1) assigned[i] = leftovers[li++]
    }

    kids.forEach((k, i) => {
      const s = slot[assigned[i]]
      live.set(k, {
        x: Pfin.x + Math.cos(s.angle) * s.r,
        y: Pfin.y + s.y,
        z: Pfin.z + Math.sin(s.angle) * s.r,
      })
      queue.push(k)
    })
  }

  // Place the brand-new parent (if any) at its dedicated back slot, translated
  // to the anchor like everything else, so it reads as "above" the selection.
  if (newParentId !== undefined) {
    const pp = positions.get(newParentId)
    const origin = positions.get(selectedId) ?? { x: 0, y: 0, z: 0 }
    if (pp) {
      live.set(newParentId, {
        x: anchor.x + (pp.x - origin.x),
        y: anchor.y + (pp.y - origin.y),
        z: anchor.z + (pp.z - origin.z),
      })
    }
  }

  // Two scales coexist while selected: LIVE = the stabilized spread-out layout;
  // originalPositions = the same layout scaled toward the selected node by the
  // layer's DEPTH_SHRINK^depth factor (the compact view deselect collapses to).
  for (const [id, p] of live) {
    if (id < 0 || id >= graph.nodes.length) continue
    graph.nodes[id].position = { x: p.x, y: p.y, z: p.z }
    graph.originalPositions?.set(id, {
      x: anchor.x + (p.x - anchor.x) * shrink,
      y: anchor.y + (p.y - anchor.y) * shrink,
      z: anchor.z + (p.z - anchor.z) * shrink,
    })
  }

  // Tree edges within the recomputed subgraph: drop the stale ones touching
  // these nodes, add the fresh set, so straight-vs-curved edge rendering tracks
  // the new hierarchy.
  if (graph.treeEdgeSet) {
    const inSub = new Set(positions.keys())
    for (const k of [...graph.treeEdgeSet]) {
      const [a, b] = k.split("-").map(Number)
      if (inSub.has(a) && inSub.has(b)) graph.treeEdgeSet.delete(k)
    }
    for (const k of treeEdgeSet) graph.treeEdgeSet.add(k)
  }

  // Global depth = selected node's global depth + local subgraph depth, so a
  // later click's rescale keys off the right tier.
  if (graph.initialDepthMap) {
    const baseDepth = graph.initialDepthMap.get(selectedId) ?? 0
    for (const [id, d] of sub.depthMap) {
      if (id >= 0 && id < graph.nodes.length) graph.initialDepthMap.set(id, baseDepth + d)
    }
  }

  if (graph.childrenOf) for (const [k, v] of childrenOf) graph.childrenOf.set(k, v)
}

