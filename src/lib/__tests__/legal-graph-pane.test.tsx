/**
 * Tests for LegalGraphPane mount behavior.
 * - Store empty → getLegalInitialNodes called, setGraphData called with result
 * - Store non-empty → getLegalInitialNodes NOT called
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import React from "react"

// ── Hoist all mocks ───────────────────────────────────────────────────────────
const {
  getLegalInitialNodesMock,
  isMocksEnabledMock,
  setGraphDataMock,
  setLoadingMock,
  graphNodes,
} = vi.hoisted(() => {
  const graphNodes: unknown[] = []
  return {
    getLegalInitialNodesMock: vi.fn(),
    isMocksEnabledMock: vi.fn(() => false),
    setGraphDataMock: vi.fn(),
    setLoadingMock: vi.fn(),
    graphNodes,
  }
})

// ── Module mocks ──────────────────────────────────────────────────────────────
vi.mock("@/lib/graph-api", () => ({
  getLegalInitialNodes: getLegalInitialNodesMock,
}))

vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => isMocksEnabledMock(),
  MOCK_NODES: [{ ref_id: "mock-1", node_type: "Topic", properties: {} }],
  MOCK_EDGES: [{ source: "mock-1", target: "mock-2", edge_type: "RELATED" }],
}))

vi.mock("@/stores/graph-store", () => {
  const graphState = {
    get nodes() { return graphNodes },
    edges: [],
    selectedNode: null,
    loadingNeighborRefs: new Set(),
    setSelectedNode: vi.fn(),
    clearSelection: vi.fn(),
    setGraphData: setGraphDataMock,
    setLoading: setLoadingMock,
  }
  const useGraphStore = (sel?: (s: unknown) => unknown) => {
    if (!sel) return graphState
    return sel(graphState)
  }
  useGraphStore.getState = () => graphState
  return { useGraphStore }
})

vi.mock("@/stores/app-store", () => ({
  useAppStore: (sel?: (s: unknown) => unknown) => {
    const state = {
      graphName: "Test Graph",
      searchTerm: "",
      sourcesOpen: false,
      myContentOpen: false,
      followingOpen: false,
      agentOpen: false,
      clipsOpen: false,
      workflowsOpen: false,
      closeAllPanels: vi.fn(),
      setSearchTerm: vi.fn(),
      toggleSources: vi.fn(),
      toggleMyContent: vi.fn(),
      toggleFollowing: vi.fn(),
      toggleAgent: vi.fn(),
      toggleWorkflows: vi.fn(),
    }
    return sel ? sel(state) : state
  },
}))

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel?: (s: unknown) => unknown) => {
    const state = { schemas: [] }
    return sel ? sel(state) : state
  },
}))

vi.mock("@/components/universe/graph-canvas", () => ({
  GraphCanvas: () => <div data-testid="graph-canvas" />,
}))
vi.mock("@/components/search/search-bar", () => ({
  SearchBar: () => <div data-testid="search-bar" />,
}))
vi.mock("@/components/layout/toolkit", () => ({
  Toolkit: () => <div data-testid="toolkit" />,
  ToolkitFAB: () => <div data-testid="toolkit-fab" />,
}))

import { LegalGraphPane } from "@/skins/legal/legal-graph-pane"

beforeEach(() => {
  vi.clearAllMocks()
  isMocksEnabledMock.mockReturnValue(false)
  // Reset graphNodes to empty
  graphNodes.length = 0
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LegalGraphPane mount", () => {
  it("calls getLegalInitialNodes and setGraphData when store is empty", async () => {
    const mockResult = {
      nodes: [{ ref_id: "agr-1", node_type: "Agreement", properties: {} }],
      edges: [],
    }
    getLegalInitialNodesMock.mockResolvedValue(mockResult)

    render(<LegalGraphPane />)

    await vi.waitFor(() => {
      expect(getLegalInitialNodesMock).toHaveBeenCalledTimes(1)
    })

    expect(setGraphDataMock).toHaveBeenCalledWith(mockResult.nodes, mockResult.edges)
    expect(setLoadingMock).toHaveBeenCalledWith(true)
  })

  it("does NOT call getLegalInitialNodes when store already has nodes", async () => {
    // Pre-populate graphNodes
    graphNodes.push({ ref_id: "existing", node_type: "Agreement", properties: {} })

    render(<LegalGraphPane />)

    await new Promise((r) => setTimeout(r, 50))

    expect(getLegalInitialNodesMock).not.toHaveBeenCalled()
  })

  it("falls back to MOCK_NODES/MOCK_EDGES when mocks are enabled", async () => {
    isMocksEnabledMock.mockReturnValue(true)

    render(<LegalGraphPane />)

    await new Promise((r) => setTimeout(r, 50))

    expect(getLegalInitialNodesMock).not.toHaveBeenCalled()
    expect(setGraphDataMock).toHaveBeenCalledWith(
      [{ ref_id: "mock-1", node_type: "Topic", properties: {} }],
      [{ source: "mock-1", target: "mock-2", edge_type: "RELATED" }]
    )
  })

  it("logs error and still calls setLoading(false) when getLegalInitialNodes rejects", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    getLegalInitialNodesMock.mockRejectedValue(new Error("network error"))

    render(<LegalGraphPane />)

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "[legal-graph-pane] getLegalInitialNodes failed:",
        expect.any(Error)
      )
    })

    expect(setLoadingMock).toHaveBeenCalledWith(false)
    consoleSpy.mockRestore()
  })
})
