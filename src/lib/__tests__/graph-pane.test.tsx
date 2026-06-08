/**
 * Tests for GraphPane:
 * - Empty state shown alone when no graph data (no title overlay)
 * - Title overlay shown when hasData=true in default view
 * - Title overlay hidden when a panel is open, search active, or node selected
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import React from "react"

// ── Store state ───────────────────────────────────────────────────────────────

const graphState = {
  nodes: [] as unknown[],
  edges: [] as unknown[],
  selectedNode: null as unknown,
  setSelectedNode: vi.fn(),
  setSidebarSelectedNode: vi.fn(),
  clearSelection: vi.fn(),
  // Upstream's fetch-on-select added this set; graph-pane reads .size to show
  // a "loading neighbours" indicator.
  loadingNeighborRefs: new Set<string>(),
}

vi.mock("@/stores/graph-store", () => ({
  useGraphStore: (sel?: (s: unknown) => unknown) =>
    sel ? sel(graphState) : graphState,
}))

const appState = {
  sourcesOpen: false,
  myContentOpen: false,
  followingOpen: false,
  clipsOpen: false,
  searchTerm: "",
  graphName: "Test Graph",
  toggleSources: vi.fn(),
  toggleMyContent: vi.fn(),
  toggleFollowing: vi.fn(),
}

vi.mock("@/stores/app-store", () => ({
  useAppStore: (sel?: (s: unknown) => unknown) =>
    sel ? sel(appState) : appState,
}))

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel?: (s: unknown) => unknown) => {
    const state = { schemas: [] }
    return sel ? sel(state) : state
  },
}))

// ── Child component mocks ─────────────────────────────────────────────────────

vi.mock("@/components/universe/graph-canvas", () => ({
  GraphCanvas: () => <div data-testid="graph-canvas" />,
}))

vi.mock("@/components/search/search-bar", () => ({
  SearchBar: () => <div data-testid="search-bar" />,
}))

vi.mock("@/components/layout/universe-header", () => ({
  UniverseHeader: () => <div data-testid="universe-header" />,
}))

vi.mock("@/components/layout/toolkit", () => ({
  Toolkit: () => <div data-testid="toolkit" />,
  ToolkitFAB: () => <div data-testid="toolkit-fab" />,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetToDefaultView() {
  graphState.nodes = []
  graphState.edges = []
  graphState.selectedNode = null
  appState.sourcesOpen = false
  appState.myContentOpen = false
  appState.followingOpen = false
  appState.clipsOpen = false
  appState.searchTerm = ""
}

const SAMPLE_NODES = [{ id: "1", label: "Node A" }]
const SAMPLE_EDGES = [{ from: "1", to: "2" }]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GraphPane", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetToDefaultView()
  })

  it("shows EmptyState and hides title overlay when no graph data", async () => {
    const { GraphPane } = await import("@/components/universe/graph-pane")
    render(<GraphPane />)

    // EmptyState text visible
    expect(screen.getByText("No graph data yet")).toBeInTheDocument()
    expect(screen.getByText("Search to populate the universe")).toBeInTheDocument()

    // Title overlay NOT rendered
    expect(screen.queryByText("Test Graph")).not.toBeInTheDocument()
  })

  it("shows title overlay and hides EmptyState when nodes are populated in default view", async () => {
    graphState.nodes = SAMPLE_NODES as typeof graphState.nodes
    graphState.edges = SAMPLE_EDGES as typeof graphState.edges

    const { GraphPane } = await import("@/components/universe/graph-pane")
    render(<GraphPane />)

    // Title overlay visible
    expect(screen.getByText("Test Graph")).toBeInTheDocument()

    // EmptyState NOT rendered
    expect(screen.queryByText("No graph data yet")).not.toBeInTheDocument()
  })

  it("hides title overlay when sourcesOpen=true even with data", async () => {
    graphState.nodes = SAMPLE_NODES as typeof graphState.nodes
    appState.sourcesOpen = true

    const { GraphPane } = await import("@/components/universe/graph-pane")
    render(<GraphPane />)

    expect(screen.queryByText("Test Graph")).not.toBeInTheDocument()
  })

  it("hides title overlay when a node is selected even with data", async () => {
    graphState.nodes = SAMPLE_NODES as typeof graphState.nodes
    graphState.selectedNode = { id: "1" } as typeof graphState.selectedNode

    const { GraphPane } = await import("@/components/universe/graph-pane")
    render(<GraphPane />)

    expect(screen.queryByText("Test Graph")).not.toBeInTheDocument()
  })

  it("hides title overlay when searchTerm is active even with data", async () => {
    graphState.nodes = SAMPLE_NODES as typeof graphState.nodes
    appState.searchTerm = "bitcoin"

    const { GraphPane } = await import("@/components/universe/graph-pane")
    render(<GraphPane />)

    expect(screen.queryByText("Test Graph")).not.toBeInTheDocument()
  })
})
