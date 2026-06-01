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
  VIRTUAL_CENTER,
} from "@/graph-viz-kit"
import type { Graph, RawNode, RawEdge } from "@/graph-viz-kit"
import type { GraphNode as ApiNode, GraphEdge as ApiEdge } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"
import { DISPLAY_KEY_FALLBACKS } from "@/lib/node-display"
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
