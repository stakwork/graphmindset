"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
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
import type {
  Graph,
  ViewState,
  RawNode,
  RawEdge,
  Vec3,
  GraphNode as VizNode,
  GraphEdge as VizEdge,
} from "@/graph-viz-kit"
import type { GraphNode as ApiNode, GraphEdge as ApiEdge } from "@/lib/graph-api"
import { useGraphStore } from "@/stores/graph-store"
import { useAppStore } from "@/stores/app-store"
import type { SchemaNode } from "@/app/ontology/page"
import { HoverPreviewCard } from "./hover-preview-card"
import { DISPLAY_KEY_FALLBACKS } from "@/lib/node-display"

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

// Max number of search hits that keep a text label at once. Beyond this the
// view becomes an unreadable pile of overlapping labels; the rest of the hits
// stay as glyph-only spotlights and reveal their label on hover.
const SEARCH_LABEL_CAP = 15

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
): { graph: Graph; indexMap: Map<number, string>; refIdToIndex: Map<string, number> } {
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

  // ─── 2. Decide which types get a __group_<type> ────────────────────────
  // A type gets its own synthetic group node when it either has orphans or
  // — under the existing crowd-control rule — when there are >10 roots and
  // the type has ≥2 leaf-like roots. "Leaf-like" = none of the type's roots
  // have outgoing edges to known nodes. This keeps hierarchy parents (e.g.
  // Episode, which has outgoing HAS → Chapter) surfacing as individuals
  // instead of being collapsed into __group_Episode.
  const orphanTypes = new Set(orphans.map((o) => o.node_type || "Unknown"))
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
      if (hasKnownOut.has(r.ref_id)) continue
      const type = r.node_type || "Unknown"
      leafRootCountByType.set(type, (leafRootCountByType.get(type) ?? 0) + 1)
    }
    for (const [type, count] of leafRootCountByType) {
      if (count >= 2) crowdGroupedTypes.add(type)
    }
  }
  const groupedTypes = new Set([...orphanTypes, ...crowdGroupedTypes])

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
      const t = r.node_type || "Unknown"
      if (groupedTypes.has(t)) memberByType.get(t)!.add(r.ref_id)
    }
    for (const o of orphans) {
      if (clusteredTargets.has(o.ref_id)) continue
      const t = o.node_type || "Unknown"
      if (groupedTypes.has(t)) memberByType.get(t)!.add(o.ref_id)
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

  return { graph, indexMap, refIdToIndex }
}

function applyLayout(graph: Graph) {
  // Bumped from the 30 default — transcript/conversation graphs have chains
  // 40+ deep; truncating leaves the tail at buildGraph's (0,0,0) default.
  const sub = extractInitialSubgraph(graph, 1000)
  const { positions, treeEdgeSet, childrenOf } = computeRadialLayout(
    sub.centerId,
    sub.neighborsByDepth,
    graph.edges,
    { parentId: sub.parentId }
  )

  for (const [id, pos] of positions) {
    if (id !== VIRTUAL_CENTER && id < graph.nodes.length) {
      graph.nodes[id].position = pos
    }
  }

  // Anything BFS never reached (cycle-only components, synthetic nodes the
  // layout missed) keeps the (0,0,0) default from buildGraph and piles at the
  // origin. Park them on an outer ring so they stay visible and selectable.
  const stray: number[] = []
  for (let i = 0; i < graph.nodes.length; i++) {
    if (!positions.has(i)) stray.push(i)
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
        y: 0,
        z: Math.sin(angle) * ringR,
      }
    }
  }

  graph.initialDepthMap = sub.depthMap
  graph.treeEdgeSet = treeEdgeSet
  graph.childrenOf = childrenOf

  // Snapshot every node's laid-out position. Click handler scales these by
  // an inflation factor so deeper nodes get R1-sized rings without relaying out.
  const snapshot = new Map<number, { x: number; y: number; z: number }>()
  for (let i = 0; i < graph.nodes.length; i++) {
    const p = graph.nodes[i].position
    snapshot.set(i, { x: p.x, y: p.y, z: p.z })
  }
  graph.originalPositions = snapshot
}

// Default ring radius for appended children when their parent has no existing
// children to size against — matches MIN_R1 / the R1 ring a freshly clicked
// node's children land on after rescale, so a fetch attaches at the same scale.
const APPEND_CHILD_R = 22
// Small per-depth vertical drop so appended children tier below their parent,
// mirroring computeRadialLayout's y-offset feel without recomputing it.
const APPEND_Y_DROP = 3

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

  // Radius: average the parent's existing children if any (keeps appended nodes
  // on the same ring the parent's subtree already uses, rescaled or not),
  // otherwise fall back to the default R1.
  let R = APPEND_CHILD_R
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
  const total = existingCount + kids.length
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

interface GraphModel {
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
function appendToGraph(
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
  const newApiNodes = apiNodes.filter((n) => !refIdToIndex.has(n.ref_id))
  const memberObjs: VizNode[] = newApiNodes.map((n, k) => ({
    id: oldCount + k,
    label: truncateLabel(nodeLabel(n, schemas)),
    position: { x: 0, y: 0, z: 0 },
    degree: 0,
    nodeType: n.node_type,
  }))
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
  const seen = new Set(prev.edges.map((e) => `${e.src} ${e.dst}`))
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

  // ── Bundle fresh child edges by (source, edge_type, target_type). A bundle
  //    that crosses the threshold becomes a `_cluster` proxy. Only the new
  //    batch is grouped — existing children are left untouched. ──
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

  const absorbed = new Set<Cand>()
  const proxyObjs: VizNode[] = []
  const proxyRouting: { proxy: number; src: number; members: number[]; edge_type: string }[] = []
  let proxyCursor = oldCount + memberObjs.length
  for (const b of bundles.values()) {
    if (b.edges.length < CLUSTER_THRESHOLD) continue
    const proxy = proxyCursor++
    proxyObjs.push({
      id: proxy,
      label: `${b.tgtType} × ${b.edges.length} · ${b.edge_type}`,
      position: { x: 0, y: 0, z: 0 },
      degree: 0,
      nodeType: "_cluster",
      clusterMemberType: b.tgtType,
    })
    proxyRouting.push({
      proxy,
      src: b.src,
      members: b.edges.map((e) => e.dst),
      edge_type: b.edge_type,
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

  // Proxy routing: source → proxy → members in the layout; the absorbed
  // source → member originals move to extraEdges (surfaced on hover/select,
  // matching apiToGraph). GraphView drops the proxy → member spokes from the
  // render automatically (edges out of a `_cluster` node).
  for (const r of proxyRouting) {
    addEdge(r.src, r.proxy, r.edge_type)
    for (const m of r.members) {
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

  // ── Clone derived structures so prev stays intact ──
  const childrenOf = new Map<number, number[]>()
  if (prev.childrenOf) for (const [k, v] of prev.childrenOf) childrenOf.set(k, v.slice())
  const treeEdgeSet = new Set(prev.treeEdgeSet ?? [])
  const initialDepthMap = new Map(prev.initialDepthMap ?? [])
  const originalPositions = new Map(prev.originalPositions ?? [])

  // ── Place new nodes around an already-placed parent, in waves so chains of
  //    new nodes (A→B→C) place parents before their children ──
  const parentOf = new Map<number, number>()
  const placed = new Set<number>()
  for (let i = 0; i < oldCount; i++) placed.add(i)

  // A clustered member must hang off its proxy, never a cross-edge neighbor —
  // so it waits for the proxy rather than falling back to inAdj/adj.
  const forcedParent = new Map<number, number>()
  for (const r of proxyRouting) for (const m of r.members) forcedParent.set(m, r.proxy)

  const pickParent = (v: number): number | undefined => {
    const forced = forcedParent.get(v)
    if (forced !== undefined) return placed.has(forced) ? forced : undefined
    for (const p of inAdj[v]) if (placed.has(p)) return p // directed parent first
    for (const p of adj[v]) if (placed.has(p)) return p // else any placed neighbor
    return undefined
  }

  let pending = [...proxyObjs, ...memberObjs].map((n) => n.id)
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

  // Strays: new nodes with no placed neighbor (disconnected from current graph).
  // Park them on an outer ring so they stay visible and selectable.
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

  // Declared early so the incremental-append effect below can reveal newly
  // attached nodes inside the active subgraph focus.
  const [viewState, setViewState] = useState<ViewState>({ mode: "overview" })

  // Full rebuild (apiToGraph + global radial layout) only on a NEW dataset
  // (dataVersion bump from setGraphData) or a schema change — never on addNodes
  // appends. Rebuilding on every nodes/edges change is the reshuffle we avoid;
  // appends are folded in incrementally below via appendToGraph.
  const baseModel = useMemo(() => {
    const result = apiToGraph(nodes, edges, schemas)
    applyLayout(result.graph)
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nodes/edges read at build time but intentionally NOT deps; see comment above
  }, [dataVersion, schemas])

  // `appendModel` accumulates incremental appends on top of the last full
  // build. On a full rebuild (baseModel changes) we use baseModel directly for
  // THIS render to avoid a one-frame flash of stale data, then resync
  // appendModel in an effect so subsequent appends build on the fresh layout.
  const [appendModel, setAppendModel] = useState<GraphModel>(baseModel)
  const baseRef = useRef(baseModel)
  const isRebuild = baseRef.current !== baseModel
  const model = isRebuild ? baseModel : appendModel

  // Counts processed into `model` so the append effect can tell real growth
  // (addNodes) from a full rebuild that already includes everything.
  const appendCountsRef = useRef({ nodes: nodes.length, edges: edges.length })

  // A full rebuild resets the append baseline.
  useEffect(() => {
    baseRef.current = baseModel
    setAppendModel(baseModel)
    appendCountsRef.current = { nodes: nodes.length, edges: edges.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- counts captured at rebuild time on purpose
  }, [baseModel])

  // Fold appended nodes/edges into the current graph in place (no reshuffle).
  // The count guard runs before the append, so the re-render setAppendModel
  // triggers (which re-fires this effect via the `model` dep) early-returns.
  useEffect(() => {
    const last = appendCountsRef.current
    if (nodes.length <= last.nodes && edges.length <= last.edges) return
    appendCountsRef.current = { nodes: nodes.length, edges: edges.length }

    const res = appendToGraph(model, nodes, edges, schemas)
    if (!res) return
    setAppendModel(res.model)

    // When focused on a subgraph, GraphView hides anything outside
    // visibleNodeIds. Reveal the freshly-attached nodes (at their parent's
    // relative depth + 1) so a click-driven fetch actually surfaces them.
    if (res.newNodeIds.length > 0) {
      setViewState((vs) => {
        if (vs.mode !== "subgraph") return vs
        const visible = new Set(vs.visibleNodeIds)
        const depthMap = new Map(vs.depthMap)
        let changed = false
        for (const id of res.newNodeIds) {
          if (visible.has(id)) continue
          visible.add(id)
          const p = res.parentOf.get(id)
          const pd = p === undefined || p === vs.selectedNodeId ? 0 : depthMap.get(p) ?? 1
          depthMap.set(id, pd + 1)
          changed = true
        }
        if (!changed) return vs
        return { ...vs, visibleNodeIds: Array.from(visible), depthMap }
      })
    }
  }, [nodes, edges, schemas, model])

  const { graph, indexMap, refIdToIndex } = model

  // Lowercase type → schema icon name (e.g. "EpisodeIcon"). The pill in
  // GraphView resolves this through schema-icons to a Lucide component.
  const nodeTypeIcons = useMemo(() => {
    const map: Record<string, string> = {}
    for (const s of schemas) {
      if (s.icon) map[s.type.toLowerCase()] = s.icon
    }
    return map
  }, [schemas])

  const [hoveredCardNode, setHoveredCardNode] = useState<ApiNode | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

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

  // All search hits, sorted by descending score. Drives both the top-3
  // amplification ranks and the label cap below, so they stay consistent.
  const sortedHits = useMemo(() => {
    const hits: { i: number; score: number }[] = []
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].matched_property === undefined) continue
      hits.push({ i, score: typeof nodes[i].score === "number" ? nodes[i].score! : 0 })
    }
    hits.sort((a, b) => b.score - a.score)
    return hits
  }, [nodes])

  // Top-3 ranked search hits, by descending score. GraphView amplifies their
  // size + color and tints their labels (rank 0 gold, ranks 1-2 cool blue).
  const topMatchRanks = useMemo<Map<number, number> | null>(() => {
    if (sortedHits.length === 0) return null
    const m = new Map<number, number>()
    for (let r = 0; r < Math.min(3, sortedHits.length); r++) m.set(sortedHits[r].i, r)
    return m
  }, [sortedHits])

  // A search can return up to 100 hits; labeling every one buries the view in
  // overlapping text (the de-overlap solver can't help when labels outnumber the
  // screen slots). Cap text labels to the top-N hits by score — every match
  // still keeps its glyph spotlight (color + size); the rest reveal their label
  // on hover or when zoomed into their neighborhood.
  const searchLabelMatches = useMemo<Set<number> | null>(() => {
    if (sortedHits.length === 0) return null
    return new Set(sortedHits.slice(0, SEARCH_LABEL_CAP).map((h) => h.i))
  }, [sortedHits])

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
        <GraphView
          graph={graph}
          viewState={viewState}
          onNodeClick={handleNodeClick}
          onHoverChange={handleHoverChange}
          externalHoveredId={externalHoveredId}
          externalSelectedId={externalSelectedId}
          searchMatches={searchMatches}
          searchLabelMatches={searchLabelMatches}
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
    </div>
  )
}
