import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import React from "react"
import type { GraphNode, GraphEdge } from "@/lib/graph-api"

// --- mock useGraphStore ---
let mockNodes: GraphNode[] = []
let mockEdges: GraphEdge[] = []
const mockRemoveEdge = vi.fn()

vi.mock("@/stores/graph-store", () => ({
  useGraphStore: (sel: (s: {
    nodes: GraphNode[]
    edges: GraphEdge[]
    removeEdge: typeof mockRemoveEdge
  }) => unknown) =>
    sel({ nodes: mockNodes, edges: mockEdges, removeEdge: mockRemoveEdge }),
}))

// --- mock useUserStore ---
let mockIsAdmin = false
vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel: (s: { isAdmin: boolean }) => unknown) =>
    sel({ isAdmin: mockIsAdmin }),
}))

// --- mock useModalStore ---
const mockOpenAddEdge = vi.fn()
vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel: (s: { openAddEdge: typeof mockOpenAddEdge }) => unknown) =>
    sel({ openAddEdge: mockOpenAddEdge }),
}))

// --- mock deleteEdge ---
const mockDeleteEdge = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/graph-api", () => ({
  deleteEdge: (...args: unknown[]) => mockDeleteEdge(...args),
}))

import { ConnectionsSection } from "@/components/layout/connections-section"

const N1: GraphNode = { ref_id: "n1", node_type: "Episode", properties: { name: "My Episode" } }
const N2: GraphNode = { ref_id: "n2", node_type: "Topic", properties: { name: "Blockchain" } }
const N3: GraphNode = { ref_id: "n3", node_type: "Topic", properties: { title: "AI" } }
const N4: GraphNode = { ref_id: "n4", node_type: "Person", properties: { name: "Alice" } }

const EDGE_MENTIONS_N2: GraphEdge = { source: "n1", target: "n2", edge_type: "MENTIONS" }
const EDGE_MENTIONS_N2_WITH_REF: GraphEdge = { source: "n1", target: "n2", edge_type: "MENTIONS", ref_id: "edge-ref-1" }
const EDGE_MENTIONS_N3: GraphEdge = { source: "n1", target: "n3", edge_type: "MENTIONS" }
const EDGE_CREATED_N4: GraphEdge = { source: "n4", target: "n1", edge_type: "CREATED" }
const EDGE_ABOUT_N4: GraphEdge = { source: "n1", target: "n4", edge_type: "ABOUT" }

beforeEach(() => {
  vi.clearAllMocks()
  mockIsAdmin = false
  mockDeleteEdge.mockResolvedValue(undefined)
})

describe("ConnectionsSection – edge type grouping (default)", () => {
  beforeEach(() => {
    mockNodes = [N1, N2, N3, N4]
    mockEdges = [EDGE_MENTIONS_N2, EDGE_MENTIONS_N3, EDGE_CREATED_N4]
  })

  it("renders the Connections heading", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    expect(screen.getByText("Connections")).toBeInTheDocument()
  })

  it("groups by edge type with correct counts", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    expect(screen.getByText(/MENTIONS/)).toBeInTheDocument()
    expect(screen.getByText("(2)")).toBeInTheDocument()
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
    expect(screen.getAllByText("Topic").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Person").length).toBeGreaterThan(0)
  })

  it("shows group count in node type mode", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    fireEvent.click(screen.getByRole("button", { name: "Node Type" }))
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
    mockNodes = [N1, N2]
    mockEdges = [EDGE_MENTIONS_N2, EDGE_MENTIONS_N3]
  })

  it("only renders peers whose nodes exist in the store", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    expect(screen.getByText("Blockchain")).toBeInTheDocument()
    expect(screen.queryByText("AI")).toBeNull()
  })
})

describe("ConnectionsSection – rows are clickable", () => {
  beforeEach(() => {
    mockNodes = [N1, N2]
    mockEdges = [EDGE_MENTIONS_N2]
  })

  it("fires onNavigate with the correct peer GraphNode when a row is clicked", () => {
    const onNavigate = vi.fn()
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} onNavigate={onNavigate} />)
    const row = screen.getByText("Blockchain").closest("button")
    expect(row).toBeTruthy()
    fireEvent.click(row!)
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith(N2)
  })

  it("does not crash when onNavigate is omitted", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    const row = screen.getByText("Blockchain").closest("button")
    expect(row).toBeTruthy()
    expect(() => fireEvent.click(row!)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// New: Add connection button
// ---------------------------------------------------------------------------
describe("ConnectionsSection – Add connection button", () => {
  beforeEach(() => {
    mockNodes = [N1, N2]
    mockEdges = [EDGE_MENTIONS_N2]
  })

  it("shows '＋ Add connection' button when currentNode is provided", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} currentNode={N1} />)
    expect(screen.getByRole("button", { name: "Add connection" })).toBeInTheDocument()
  })

  it("does not show '＋ Add connection' when currentNode is omitted", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    expect(screen.queryByRole("button", { name: "Add connection" })).toBeNull()
  })

  it("calls openAddEdge with currentNode when '＋ Add connection' is clicked", () => {
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} currentNode={N1} />)
    fireEvent.click(screen.getByRole("button", { name: "Add connection" }))
    expect(mockOpenAddEdge).toHaveBeenCalledTimes(1)
    expect(mockOpenAddEdge).toHaveBeenCalledWith(N1)
  })
})

// ---------------------------------------------------------------------------
// New: Admin-only trash icon / delete flow
// ---------------------------------------------------------------------------
describe("ConnectionsSection – admin delete", () => {
  beforeEach(() => {
    mockNodes = [N1, N2]
    mockEdges = [EDGE_MENTIONS_N2_WITH_REF]
  })

  it("hides the trash icon when isAdmin=false", () => {
    mockIsAdmin = false
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    expect(screen.queryByRole("button", { name: "Remove connection" })).toBeNull()
  })

  it("shows the trash icon when isAdmin=true and edge has ref_id", () => {
    mockIsAdmin = true
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    expect(screen.getByRole("button", { name: "Remove connection" })).toBeInTheDocument()
  })

  it("clicking trash shows inline confirmation", () => {
    mockIsAdmin = true
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    fireEvent.click(screen.getByRole("button", { name: "Remove connection" }))
    expect(screen.getByText("Remove?")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Confirm remove" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel remove" })).toBeInTheDocument()
  })

  it("cancel hides the inline confirmation", () => {
    mockIsAdmin = true
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    fireEvent.click(screen.getByRole("button", { name: "Remove connection" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancel remove" }))
    expect(screen.queryByText("Remove?")).toBeNull()
    expect(screen.getByRole("button", { name: "Remove connection" })).toBeInTheDocument()
  })

  it("confirming calls deleteEdge and removeEdge, then hides confirmation", async () => {
    mockIsAdmin = true
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    fireEvent.click(screen.getByRole("button", { name: "Remove connection" }))
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove" }))

    await waitFor(() => {
      expect(mockDeleteEdge).toHaveBeenCalledWith("edge-ref-1")
      expect(mockRemoveEdge).toHaveBeenCalledWith("edge-ref-1")
    })
    expect(screen.queryByText("Remove?")).toBeNull()
  })

  it("hides trash for edges without ref_id even when isAdmin=true", () => {
    mockIsAdmin = true
    mockEdges = [EDGE_MENTIONS_N2] // no ref_id
    render(<ConnectionsSection nodeRefId="n1" schemas={[]} />)
    expect(screen.queryByRole("button", { name: "Remove connection" })).toBeNull()
  })
})
