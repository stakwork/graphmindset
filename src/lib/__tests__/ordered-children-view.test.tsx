import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import React from "react"
import type { GraphNode, GraphEdge } from "@/lib/graph-api"

// --- mock useGraphStore ---
let mockNodes: GraphNode[] = []
let mockEdges: GraphEdge[] = []

vi.mock("@/stores/graph-store", () => ({
  useGraphStore: (sel: (s: { nodes: GraphNode[]; edges: GraphEdge[] }) => unknown) =>
    sel({ nodes: mockNodes, edges: mockEdges }),
}))

import { OrderedChildrenView } from "@/components/layout/node-preview-panel"

const PARENT: GraphNode = { ref_id: "p1", node_type: "Document", properties: { title: "My Doc" } }
const CHILD_A: GraphNode = {
  ref_id: "c1",
  node_type: "Section",
  properties: { text: "Section 1 — Intro", summary: "First section body." },
}
const CHILD_B: GraphNode = {
  ref_id: "c2",
  node_type: "Section",
  properties: { text: "Section 2 — Transactions", summary: "Second section body." },
}
const CHILD_C: GraphNode = {
  ref_id: "c3",
  node_type: "Section",
  properties: { text: "Section 3 — Server", summary: "Third section body." },
}
const CHILD_NO_SUMMARY: GraphNode = {
  ref_id: "c4",
  node_type: "Section",
  properties: { text: "Section 4 — No Summary" },
}

const EDGE_INDEX2: GraphEdge = { source: "p1", target: "c3", edge_type: "HAS", properties: { index: 2 } }
const EDGE_INDEX0: GraphEdge = { source: "p1", target: "c1", edge_type: "HAS", properties: { index: 0 } }
const EDGE_INDEX1: GraphEdge = { source: "p1", target: "c2", edge_type: "HAS", properties: { index: 1 } }
const EDGE_NO_INDEX: GraphEdge = { source: "p1", target: "c4", edge_type: "HAS" }

describe("OrderedChildrenView", () => {
  beforeEach(() => {
    mockNodes = [PARENT, CHILD_A, CHILD_B, CHILD_C, CHILD_NO_SUMMARY]
    mockEdges = []
  })

  it("renders nothing when no outgoing indexed edges exist", () => {
    mockEdges = [EDGE_NO_INDEX]
    const { container } = render(<OrderedChildrenView nodeRefId="p1" schemas={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing when there are no outgoing edges at all", () => {
    mockEdges = []
    const { container } = render(<OrderedChildrenView nodeRefId="p1" schemas={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders children sorted by index ascending when edges are out of order", () => {
    mockEdges = [EDGE_INDEX2, EDGE_INDEX0, EDGE_INDEX1]
    render(<OrderedChildrenView nodeRefId="p1" schemas={[]} />)
    const headings = screen.getAllByText(/Section [123] —/)
    expect(headings[0]).toHaveTextContent("Section 1 — Intro")
    expect(headings[1]).toHaveTextContent("Section 2 — Transactions")
    expect(headings[2]).toHaveTextContent("Section 3 — Server")
  })

  it("renders child summaries as SummaryBlock body text", () => {
    mockEdges = [EDGE_INDEX0]
    render(<OrderedChildrenView nodeRefId="p1" schemas={[]} />)
    expect(screen.getByText("First section body.")).toBeInTheDocument()
  })

  it("skips children with no summary even when indexed", () => {
    mockEdges = [EDGE_INDEX0, { source: "p1", target: "c4", edge_type: "HAS", properties: { index: 3 } }]
    render(<OrderedChildrenView nodeRefId="p1" schemas={[]} />)
    // c1 summary should appear
    expect(screen.getByText("First section body.")).toBeInTheDocument()
    // c4 has no summary — its text property should not appear as a heading
    expect(screen.queryByText("Section 4 — No Summary")).not.toBeInTheDocument()
  })

  it("appends unindexed edges after indexed ones, sorted alphabetically by title", () => {
    const CHILD_Z: GraphNode = {
      ref_id: "cz",
      node_type: "Section",
      properties: { text: "Z Section", summary: "Z body." },
    }
    const CHILD_AA: GraphNode = {
      ref_id: "caa",
      node_type: "Section",
      properties: { text: "AA Section", summary: "AA body." },
    }
    mockNodes = [PARENT, CHILD_A, CHILD_Z, CHILD_AA]
    mockEdges = [
      EDGE_INDEX0,
      { source: "p1", target: "cz", edge_type: "HAS" },
      { source: "p1", target: "caa", edge_type: "HAS" },
    ]
    render(<OrderedChildrenView nodeRefId="p1" schemas={[]} />)
    const headings = screen.getAllByText(/Section|AA Section|Z Section/)
    // First: indexed Section 1
    expect(headings[0]).toHaveTextContent("Section 1 — Intro")
    // Then unindexed alphabetically: AA Section before Z Section
    expect(headings[1]).toHaveTextContent("AA Section")
    expect(headings[2]).toHaveTextContent("Z Section")
  })

  it("shows loading hint when peers are not yet in the store but edges exist", () => {
    // No nodes for children in the store (still loading)
    mockNodes = [PARENT]
    mockEdges = [EDGE_INDEX0]
    render(<OrderedChildrenView nodeRefId="p1" schemas={[]} />)
    expect(screen.getByText("Loading sections…")).toBeInTheDocument()
  })

  it("does not render for edges targeting a different node", () => {
    mockEdges = [{ source: "other", target: "c1", edge_type: "HAS", properties: { index: 0 } }]
    const { container } = render(<OrderedChildrenView nodeRefId="p1" schemas={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
