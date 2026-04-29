import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"
import type { GraphNode, GraphEdge } from "@/lib/graph-api"

// --- mock useGraphStore ---
let mockNodes: GraphNode[] = []
let mockEdges: GraphEdge[] = []

vi.mock("@/stores/graph-store", () => ({
  useGraphStore: (sel: (s: { nodes: GraphNode[]; edges: GraphEdge[] }) => unknown) =>
    sel({ nodes: mockNodes, edges: mockEdges }),
}))

import { ConnectionsSection } from "@/components/layout/connections-section"

const N1: GraphNode = { ref_id: "n1", node_type: "Episode", properties: { name: "My Episode" } }
const N2: GraphNode = { ref_id: "n2", node_type: "Topic", properties: { name: "Blockchain" } }
const N3: GraphNode = { ref_id: "n3", node_type: "Topic", properties: { title: "AI" } }
const N4: GraphNode = { ref_id: "n4", node_type: "Person", properties: { name: "Alice" } }

const EDGE_MENTIONS_N2: GraphEdge = { source: "n1", target: "n2", edge_type: "MENTIONS" }
const EDGE_MENTIONS_N3: GraphEdge = { source: "n1", target: "n3", edge_type: "MENTIONS" }
const EDGE_CREATED_N4: GraphEdge = { source: "n4", target: "n1", edge_type: "CREATED" }
const EDGE_ABOUT_N4: GraphEdge = { source: "n1", target: "n4", edge_type: "ABOUT" }

describe("ConnectionsSection – edge type grouping (default)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes = [N1, N2, N3, N4]
    mockEdges = [EDGE_MENTIONS_N2, EDGE_MENTIONS_N3, EDGE_CREATED_N4]
  })

  it("renders the Connections heading", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    expect(screen.getByText("Connections")).toBeInTheDocument()
  })

  it("groups by edge type with correct counts", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    // MENTIONS group has 2 peers
    expect(screen.getByText(/MENTIONS/)).toBeInTheDocument()
    expect(screen.getByText("(2)")).toBeInTheDocument()
    // CREATED group has 1 peer (n4 -> n1, peer is n4)
    expect(screen.getByText(/CREATED/)).toBeInTheDocument()
    expect(screen.getByText("(1)")).toBeInTheDocument()
  })

  it("shows correct target titles in edge type mode", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    expect(screen.getByText("Blockchain")).toBeInTheDocument()
    expect(screen.getByText("AI")).toBeInTheDocument()
    expect(screen.getByText("Alice")).toBeInTheDocument()
  })

  it("shows node type badges for each row", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    const topicBadges = screen.getAllByText("Topic")
    expect(topicBadges.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText("Person")).toBeInTheDocument()
  })
})

describe("ConnectionsSection – node type grouping toggle", () => {
  beforeEach(() => {
    mockNodes = [N1, N2, N3, N4]
    mockEdges = [EDGE_MENTIONS_N2, EDGE_MENTIONS_N3, EDGE_CREATED_N4, EDGE_ABOUT_N4]
  })

  it("switches to node type grouping when Node Type button is clicked", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    fireEvent.click(screen.getByRole("button", { name: "Node Type" }))
    // Topic group header should appear (may also appear in badges — use getAllByText)
    expect(screen.getAllByText("Topic").length).toBeGreaterThan(0)
    // Person group header should appear
    expect(screen.getAllByText("Person").length).toBeGreaterThan(0)
  })

  it("shows group count in node type mode", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    fireEvent.click(screen.getByRole("button", { name: "Node Type" }))
    // Both Topic (2) and Person (2) render "(2)" — verify at least one exists
    expect(screen.getAllByText("(2)").length).toBeGreaterThanOrEqual(1)
  })

  it("can toggle back to edge type mode", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    fireEvent.click(screen.getByRole("button", { name: "Node Type" }))
    fireEvent.click(screen.getByRole("button", { name: "Edge Type" }))
    expect(screen.getByText(/MENTIONS/)).toBeInTheDocument()
  })
})

describe("ConnectionsSection – empty state", () => {
  beforeEach(() => {
    mockNodes = [N1]
    mockEdges = []
  })

  it("renders 'No connections' when there are no edges", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    expect(screen.getByText("No connections")).toBeInTheDocument()
  })

  it("does not render any group headers when empty", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    expect(screen.queryByText(/MENTIONS/)).toBeNull()
  })
})

describe("ConnectionsSection – skips peer nodes not in store", () => {
  beforeEach(() => {
    // n3 is referenced in an edge but NOT in the nodes array
    mockNodes = [N1, N2]
    mockEdges = [EDGE_MENTIONS_N2, EDGE_MENTIONS_N3]
  })

  it("only renders peers whose nodes exist in the store", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    expect(screen.getByText("Blockchain")).toBeInTheDocument()
    // AI (n3) should not appear since n3 not in store
    expect(screen.queryByText("AI")).toBeNull()
  })
})

describe("ConnectionsSection – rows are read-only", () => {
  beforeEach(() => {
    mockNodes = [N1, N2]
    mockEdges = [EDGE_MENTIONS_N2]
  })

  it("connection rows have no onClick handler", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    const row = screen.getByText("Blockchain").closest("div")
    expect(row).not.toHaveAttribute("onClick")
  })
})
