import { describe, it, expect } from "vitest"
import { diversifyClipsByParent } from "@/lib/clip-diversify"
import type { GraphNode, GraphEdge } from "@/lib/graph-api"

const DEFAULT_OPTS = { maxPerSource: 1, finalLimit: 4 }

function makeClip(ref_id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    ref_id,
    node_type: "Clip",
    properties: {},
    date_added_to_graph: 1000,
    ...overrides,
  }
}

function hasEdge(source: string, target: string): GraphEdge {
  return { source, target, edge_type: "HAS" }
}

describe("diversifyClipsByParent", () => {
  it("1. strict cap: only 1 clip per parent even when many from same source", () => {
    // 7 clips from episode A, 1 each from B, C, D
    const clips: GraphNode[] = [
      makeClip("a1", { date_added_to_graph: 1000 }),
      makeClip("a2", { date_added_to_graph: 900 }),
      makeClip("a3", { date_added_to_graph: 800 }),
      makeClip("a4", { date_added_to_graph: 700 }),
      makeClip("a5", { date_added_to_graph: 600 }),
      makeClip("a6", { date_added_to_graph: 500 }),
      makeClip("a7", { date_added_to_graph: 400 }),
      makeClip("b1", { date_added_to_graph: 350 }),
      makeClip("c1", { date_added_to_graph: 300 }),
      makeClip("d1", { date_added_to_graph: 250 }),
    ]
    const edges: GraphEdge[] = [
      hasEdge("ep-A", "a1"),
      hasEdge("ep-A", "a2"),
      hasEdge("ep-A", "a3"),
      hasEdge("ep-A", "a4"),
      hasEdge("ep-A", "a5"),
      hasEdge("ep-A", "a6"),
      hasEdge("ep-A", "a7"),
      hasEdge("ep-B", "b1"),
      hasEdge("ep-C", "c1"),
      hasEdge("ep-D", "d1"),
    ]

    const result = diversifyClipsByParent(clips, edges, DEFAULT_OPTS)

    expect(result).toHaveLength(4)
    // Only 1 clip from episode A
    const fromA = result.filter((c) => ["a1", "a2", "a3", "a4", "a5", "a6", "a7"].includes(c.ref_id))
    expect(fromA).toHaveLength(1)
    // a1 is the most recent from A so it should be selected
    expect(fromA[0].ref_id).toBe("a1")
  })

  it("2. relax-fill: fills all slots even when fewer distinct sources than finalLimit", () => {
    // Only 2 distinct sources, 2 clips each — all 4 slots should fill
    const clips: GraphNode[] = [
      makeClip("a1", { date_added_to_graph: 1000 }),
      makeClip("a2", { date_added_to_graph: 900 }),
      makeClip("b1", { date_added_to_graph: 800 }),
      makeClip("b2", { date_added_to_graph: 700 }),
    ]
    const edges: GraphEdge[] = [
      hasEdge("ep-A", "a1"),
      hasEdge("ep-A", "a2"),
      hasEdge("ep-B", "b1"),
      hasEdge("ep-B", "b2"),
    ]

    const result = diversifyClipsByParent(clips, edges, DEFAULT_OPTS)

    expect(result).toHaveLength(4)
    expect(result.map((c) => c.ref_id)).toContain("a1")
    expect(result.map((c) => c.ref_id)).toContain("a2")
    expect(result.map((c) => c.ref_id)).toContain("b1")
    expect(result.map((c) => c.ref_id)).toContain("b2")
  })

  it("3. recency preserved: output order mirrors input recency order", () => {
    const clips: GraphNode[] = [
      makeClip("x1", { date_added_to_graph: 1000 }),
      makeClip("x2", { date_added_to_graph: 900 }),
      makeClip("x3", { date_added_to_graph: 800 }),
      makeClip("x4", { date_added_to_graph: 700 }),
    ]
    // All different parents — no filtering needed
    const edges: GraphEdge[] = [
      hasEdge("ep-X1", "x1"),
      hasEdge("ep-X2", "x2"),
      hasEdge("ep-X3", "x3"),
      hasEdge("ep-X4", "x4"),
    ]

    const result = diversifyClipsByParent(clips, edges, DEFAULT_OPTS)

    expect(result.map((c) => c.ref_id)).toEqual(["x1", "x2", "x3", "x4"])
  })

  it("4. edge-based parent wins over episode_title fallback", () => {
    // Both clip p1 and p2 have the same episode_title but DIFFERENT HAS edges
    const clips: GraphNode[] = [
      makeClip("p1", {
        date_added_to_graph: 1000,
        properties: { episode_title: "Same Title" },
      }),
      makeClip("p2", {
        date_added_to_graph: 900,
        properties: { episode_title: "Same Title" },
      }),
      makeClip("q1", { date_added_to_graph: 800 }),
      makeClip("q2", { date_added_to_graph: 700 }),
    ]
    const edges: GraphEdge[] = [
      hasEdge("ep-P1", "p1"), // p1 → unique parent via edge
      hasEdge("ep-P2", "p2"), // p2 → different unique parent via edge
      hasEdge("ep-Q1", "q1"),
      hasEdge("ep-Q2", "q2"),
    ]

    const result = diversifyClipsByParent(clips, edges, DEFAULT_OPTS)

    // Both p1 and p2 should appear because their edge-derived parents are distinct
    expect(result.map((c) => c.ref_id)).toContain("p1")
    expect(result.map((c) => c.ref_id)).toContain("p2")
    expect(result).toHaveLength(4)
  })

  it("5. fallback chain: show+episode_number groups clips without edges or episode_title", () => {
    // Clips with same show+episode_number but no edge and no episode_title
    const clips: GraphNode[] = [
      makeClip("m1", {
        date_added_to_graph: 1000,
        properties: { show: "Test Show", episode_number: 5 },
      }),
      makeClip("m2", {
        date_added_to_graph: 900,
        properties: { show: "Test Show", episode_number: 5 },
      }),
      makeClip("m3", {
        date_added_to_graph: 800,
        properties: { show: "Test Show", episode_number: 5 },
      }),
      makeClip("n1", {
        date_added_to_graph: 700,
        properties: { show: "Other Show", episode_number: 1 },
      }),
      makeClip("o1", {
        date_added_to_graph: 600,
        properties: { show: "Another Show", episode_number: 2 },
      }),
    ]

    const result = diversifyClipsByParent(clips, [], DEFAULT_OPTS)

    // m1, m2, m3 share the same parent key "Test Show:5"
    // Pass 1: selects m1 (most recent), n1, o1 → 3 distinct sources, still need 1 more
    // Pass 2: relax-fill adds m2 (next from the M cluster)
    const fromM = result.filter((c) => ["m1", "m2", "m3"].includes(c.ref_id))
    expect(fromM).toHaveLength(2) // 1 from strict pass + 1 from relax-fill
    expect(fromM[0].ref_id).toBe("m1") // most recent from cluster comes first
    expect(result).toHaveLength(4) // all 4 slots filled via relax-fill
  })

  it("6. empty inputs: returns empty array without throwing", () => {
    expect(diversifyClipsByParent([], [], DEFAULT_OPTS)).toEqual([])
    expect(diversifyClipsByParent([], [hasEdge("ep-A", "x1")], DEFAULT_OPTS)).toEqual([])
  })
})
