import { describe, it, expect, beforeEach } from "vitest"
import { useGraphStore } from "@/stores/graph-store"
import type { GraphEdge } from "@/lib/graph-api"

const EDGE_A: GraphEdge = { source: "n1", target: "n2", edge_type: "MENTIONS", ref_id: "ref-a" }
const EDGE_B: GraphEdge = { source: "n2", target: "n3", edge_type: "RELATED_TO", ref_id: "ref-b" }
const EDGE_NO_REF: GraphEdge = { source: "n1", target: "n3", edge_type: "ABOUT" }

beforeEach(() => {
  useGraphStore.getState().setGraphData([], [EDGE_A, EDGE_B, EDGE_NO_REF])
})

describe("graph-store – removeEdge", () => {
  it("removes the edge with matching ref_id", () => {
    useGraphStore.getState().removeEdge("ref-a")
    const edges = useGraphStore.getState().edges
    expect(edges.some((e) => e.ref_id === "ref-a")).toBe(false)
    expect(edges.some((e) => e.ref_id === "ref-b")).toBe(true)
  })

  it("leaves edges without ref_id intact", () => {
    useGraphStore.getState().removeEdge("ref-a")
    const edges = useGraphStore.getState().edges
    expect(edges.some((e) => e.source === "n1" && e.target === "n3")).toBe(true)
  })

  it("no-ops when ref_id does not exist", () => {
    useGraphStore.getState().removeEdge("nonexistent")
    expect(useGraphStore.getState().edges).toHaveLength(3)
  })

  it("removes only the targeted edge when multiple exist", () => {
    useGraphStore.getState().removeEdge("ref-b")
    const edges = useGraphStore.getState().edges
    expect(edges).toHaveLength(2)
    expect(edges.some((e) => e.ref_id === "ref-a")).toBe(true)
  })
})
