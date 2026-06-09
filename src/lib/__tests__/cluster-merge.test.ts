// Covers appendToGraph's cluster reconciliation: when a source's same-key
// children are split across direct edges and/or an existing proxy, a fresh
// append must MERGE them into one `_cluster` so nothing bypasses the proxy.
import { describe, it, expect } from "vitest"
import { apiToGraph, appendToGraph } from "@/components/universe/graph-canvas"
import type { GraphNode as ApiNode, GraphEdge as ApiEdge } from "@/lib/graph-api"

const topic = (id: string): ApiNode => ({ ref_id: id, node_type: "topic", properties: {} })
const episode = (id: string): ApiNode => ({ ref_id: id, node_type: "episode", properties: {} })
const mentions = (src: string, dst: string): ApiEdge => ({
  source: src,
  target: dst,
  edge_type: "MENTIONS",
})

// Helpers reading the built graph by node index.
const clusterNodes = (graph: ReturnType<typeof apiToGraph>["graph"]) =>
  graph.nodes.filter((n) => n.nodeType === "_cluster")

const groupNodes = (graph: ReturnType<typeof apiToGraph>["graph"]) =>
  graph.nodes.filter((n) => n.nodeType === "_group")

const directEdgesFrom = (
  graph: ReturnType<typeof apiToGraph>["graph"],
  srcIdx: number,
  dstIdxs: Set<number>
) => graph.edges.filter((e) => e.src === srcIdx && dstIdxs.has(e.dst))

describe("appendToGraph cluster reconciliation", () => {
  it("absorbs pre-existing direct children when a later append crosses the threshold", () => {
    // Initial: episode mentions 4 topics — below CLUSTER_THRESHOLD (5), so they
    // load as direct edges, no proxy.
    const model = apiToGraph(
      [episode("E"), topic("T1"), topic("T2"), topic("T3"), topic("T4")],
      [mentions("E", "T1"), mentions("E", "T2"), mentions("E", "T3"), mentions("E", "T4")],
      []
    )
    expect(clusterNodes(model.graph)).toHaveLength(0)

    // Append 3 more topics → 4 existing + 3 new = 7 ≥ 5 → must cluster ALL 7.
    const res = appendToGraph(
      model,
      [topic("T5"), topic("T6"), topic("T7")],
      [mentions("E", "T5"), mentions("E", "T6"), mentions("E", "T7")],
      []
    )
    expect(res).not.toBeNull()
    const g = res!.model.graph
    const idx = res!.model.refIdToIndex
    const eIdx = idx.get("E")!

    // Exactly one cluster proxy, labelled with the full count.
    const clusters = clusterNodes(g)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].label).toBe("topic × 7 · MENTIONS")

    // No topic bypasses the proxy with a direct edge from the episode.
    const topicIdxs = new Set(
      ["T1", "T2", "T3", "T4", "T5", "T6", "T7"].map((t) => idx.get(t)!)
    )
    expect(directEdgesFrom(g, eIdx, topicIdxs)).toHaveLength(0)

    // All 7 hang off the proxy; the proxy hangs off the episode.
    const proxyIdx = g.nodes.indexOf(clusters[0])
    expect(g.outAdj[proxyIdx].slice().sort()).toEqual([...topicIdxs].sort((a, b) => a - b))
    expect(g.outAdj[eIdx]).toContain(proxyIdx)

    // The absorbed direct relations survive on extraEdges for hover/select.
    const extra = g.extraEdges ?? []
    for (const t of topicIdxs) {
      expect(extra.some((e) => e.src === eIdx && e.dst === t)).toBe(true)
    }
  })

  it("merges a new same-key batch into an existing proxy instead of spawning a second", () => {
    // Initial: 5 topics → already clustered into one proxy (× 5).
    const model = apiToGraph(
      [episode("E"), topic("T1"), topic("T2"), topic("T3"), topic("T4"), topic("T5")],
      [
        mentions("E", "T1"),
        mentions("E", "T2"),
        mentions("E", "T3"),
        mentions("E", "T4"),
        mentions("E", "T5"),
      ],
      []
    )
    expect(clusterNodes(model.graph)).toHaveLength(1)

    const res = appendToGraph(
      model,
      [topic("T6"), topic("T7"), topic("T8")],
      [mentions("E", "T6"), mentions("E", "T7"), mentions("E", "T8")],
      []
    )
    const g = res!.model.graph
    const clusters = clusterNodes(g)
    // Still ONE proxy, now × 8 — not a second ×3 proxy.
    expect(clusters).toHaveLength(1)
    expect(clusters[0].label).toBe("topic × 8 · MENTIONS")
    const proxyIdx = g.nodes.indexOf(clusters[0])
    expect(g.outAdj[proxyIdx]).toHaveLength(8)
  })

  it("drops fetched nodes that can't attach as descendants, keeps those that can", () => {
    const model = apiToGraph([episode("E")], [], [])
    // T1 connects to E (a descendant) and N connects to T1 (descendant via T1):
    // both kept. STRAY connects only to ORPHAN, neither linked to the graph:
    // both dropped.
    const res = appendToGraph(
      model,
      [topic("T1"), topic("N"), topic("STRAY"), topic("ORPHAN")],
      [mentions("E", "T1"), mentions("T1", "N"), mentions("STRAY", "ORPHAN")],
      []
    )
    const idx = res!.model.refIdToIndex
    expect(idx.has("T1")).toBe(true)
    expect(idx.has("N")).toBe(true)
    expect(idx.has("STRAY")).toBe(false)
    expect(idx.has("ORPHAN")).toBe(false)
    // Exactly E + T1 + N survive.
    expect(res!.model.graph.nodes).toHaveLength(3)
  })

  it("crowd-groups ≥5 same-type top-level nodes by count into one __group", () => {
    // Six parentless topics (no edges → all roots) collapse into one group.
    const g = apiToGraph(
      [topic("T1"), topic("T2"), topic("T3"), topic("T4"), topic("T5"), topic("T6")],
      [],
      []
    ).graph
    const groups = groupNodes(g)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe("topic")
    const gi = g.nodes.indexOf(groups[0])
    expect(g.outAdj[gi]).toHaveLength(6)
  })

  it("does NOT crowd-group when same-type top-level nodes are below the count", () => {
    const g = apiToGraph(
      [topic("T1"), topic("T2"), topic("T3"), topic("T4")],
      [],
      []
    ).graph
    expect(groupNodes(g)).toHaveLength(0)
  })

  it("does not re-add cluster-absorbed edges on re-fetch (keeps hierarchy nested)", () => {
    const chapter = (id: string): ApiNode => ({ ref_id: id, node_type: "chapter", properties: {} })
    const has = (s: string, d: string): ApiEdge => ({ source: s, target: d, edge_type: "HAS" })

    // 5 chapters → clustered at load; the direct E→chapter edges move to extraEdges.
    const model = apiToGraph(
      [episode("E"), chapter("C1"), chapter("C2"), chapter("C3"), chapter("C4"), chapter("C5")],
      [has("E", "C1"), has("E", "C2"), has("E", "C3"), has("E", "C4"), has("E", "C5")],
      []
    )
    expect(clusterNodes(model.graph)).toHaveLength(1)

    // A later fetch returns the SAME E→C1 edge again (plus a new node). It must
    // NOT be re-added as a live direct edge — that would bypass the cluster and
    // promote C1 back to hop-1 (the hierarchy-flatten bug).
    const res = appendToGraph(
      model,
      [topic("Tnew")],
      [has("E", "C1"), mentions("E", "Tnew")],
      []
    )
    const g = res!.model.graph
    const eIdx = res!.model.refIdToIndex.get("E")!
    const c1Idx = res!.model.refIdToIndex.get("C1")!
    expect(g.edges.some((e) => e.src === eIdx && e.dst === c1Idx)).toBe(false)
  })

  it("leaves a small append as direct edges when there is nothing to cluster", () => {
    const model = apiToGraph([episode("E")], [], [])
    const res = appendToGraph(
      model,
      [topic("T1"), topic("T2"), topic("T3")],
      [mentions("E", "T1"), mentions("E", "T2"), mentions("E", "T3")],
      []
    )
    const g = res!.model.graph
    expect(clusterNodes(g)).toHaveLength(0)
    const eIdx = res!.model.refIdToIndex.get("E")!
    const topicIdxs = new Set(["T1", "T2", "T3"].map((t) => res!.model.refIdToIndex.get(t)!))
    expect(directEdgesFrom(g, eIdx, topicIdxs)).toHaveLength(3)
  })
})
