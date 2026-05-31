import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"
import type { GraphNode, GraphEdge } from "@/lib/graph-api"

// --- mock useGraphStore ---
let mockNodes: GraphNode[] = []
let mockEdges: GraphEdge[] = []
const mockSetSidebar = vi.fn()

vi.mock("@/stores/graph-store", () => ({
  useGraphStore: Object.assign(
    (sel: (s: { nodes: GraphNode[]; edges: GraphEdge[] }) => unknown) =>
      sel({ nodes: mockNodes, edges: mockEdges }),
    { getState: () => ({ setSidebarSelectedNode: mockSetSidebar }) },
  ),
}))

import { ParentBreadcrumbs } from "@/components/layout/node-preview-panel"

const PARENT: GraphNode = {
  ref_id: "doc1",
  node_type: "Document",
  properties: { title: "Bitcoin Whitepaper" },
}
const PARENT2: GraphNode = {
  ref_id: "doc2",
  node_type: "Document",
  properties: { title: "Lightning Paper" },
}
const CHILD: GraphNode = {
  ref_id: "sec1",
  node_type: "Section",
  properties: { text: "Section 1 — Intro", summary: "Intro body." },
}

const INCOMING_INDEXED: GraphEdge = {
  source: "doc1",
  target: "sec1",
  edge_type: "HAS",
  properties: { index: 0 },
}

const INCOMING_NOT_INDEXED: GraphEdge = {
  source: "doc1",
  target: "sec1",
  edge_type: "HAS",
}

describe("ParentBreadcrumbs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNodes = [PARENT, PARENT2, CHILD]
    mockEdges = []
  })

  it("renders nothing when no incoming indexed edges exist", () => {
    mockEdges = [INCOMING_NOT_INDEXED]
    const { container } = render(<ParentBreadcrumbs nodeRefId="sec1" schemas={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing when no edges at all", () => {
    mockEdges = []
    const { container } = render(<ParentBreadcrumbs nodeRefId="sec1" schemas={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders a breadcrumb pill with parent title when incoming indexed edge exists", () => {
    mockEdges = [INCOMING_INDEXED]
    render(<ParentBreadcrumbs nodeRefId="sec1" schemas={[]} />)
    expect(screen.getByText(/↑ Bitcoin Whitepaper/)).toBeInTheDocument()
  })

  it("renders multiple breadcrumb pills for multiple unique indexed parents", () => {
    mockEdges = [
      INCOMING_INDEXED,
      { source: "doc2", target: "sec1", edge_type: "HAS", properties: { index: 0 } },
    ]
    render(<ParentBreadcrumbs nodeRefId="sec1" schemas={[]} />)
    expect(screen.getByText(/↑ Bitcoin Whitepaper/)).toBeInTheDocument()
    expect(screen.getByText(/↑ Lightning Paper/)).toBeInTheDocument()
  })

  it("de-duplicates multiple edges from the same parent", () => {
    mockEdges = [
      { source: "doc1", target: "sec1", edge_type: "HAS", properties: { index: 0 } },
      { source: "doc1", target: "sec1", edge_type: "HAS", properties: { index: 1 } },
    ]
    render(<ParentBreadcrumbs nodeRefId="sec1" schemas={[]} />)
    const pills = screen.getAllByText(/↑ Bitcoin Whitepaper/)
    expect(pills).toHaveLength(1)
  })

  it("calls setSidebarSelectedNode with parent node when pill is clicked", () => {
    mockEdges = [INCOMING_INDEXED]
    render(<ParentBreadcrumbs nodeRefId="sec1" schemas={[]} />)
    fireEvent.click(screen.getByText(/↑ Bitcoin Whitepaper/))
    expect(mockSetSidebar).toHaveBeenCalledWith(PARENT)
  })

  it("renders nothing when parent node is not in the store", () => {
    mockNodes = [CHILD] // parent doc1 not in store
    mockEdges = [INCOMING_INDEXED]
    const { container } = render(<ParentBreadcrumbs nodeRefId="sec1" schemas={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it("ignores edges that target a different node", () => {
    mockEdges = [{ source: "doc1", target: "other", edge_type: "HAS", properties: { index: 0 } }]
    const { container } = render(<ParentBreadcrumbs nodeRefId="sec1" schemas={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe("GraphEdge type — properties field", () => {
  it("accepts properties on a GraphEdge without TypeScript errors", () => {
    const edge: GraphEdge = {
      source: "a",
      target: "b",
      edge_type: "HAS",
      properties: { index: 0, custom: "value" },
    }
    expect(edge.properties?.index).toBe(0)
    expect(edge.properties?.custom).toBe("value")
  })

  it("allows properties to be undefined", () => {
    const edge: GraphEdge = { source: "a", target: "b", edge_type: "MENTIONS" }
    expect(edge.properties).toBeUndefined()
  })
})
