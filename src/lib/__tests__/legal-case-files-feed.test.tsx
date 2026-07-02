/**
 * Tests for LegalCaseFilesFeed.
 * - Assert getLatestNodes is NEVER called regardless of store state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import React from "react"

// ── Spy on graph-api to ensure getLatestNodes is never called ─────────────────
const getLatestNodesMock = vi.fn()

vi.mock("@/lib/graph-api", () => ({
  getLatestNodes: getLatestNodesMock,
}))

// ── Mock mock-data ────────────────────────────────────────────────────────────
vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => false,
  MOCK_NODES: [],
  MOCK_EDGES: [],
}))

// ── Graph store ───────────────────────────────────────────────────────────────
const graphState = {
  nodes: [] as unknown[],
  edges: [],
  loading: false,
  selectedNode: null,
  setSelectedNode: vi.fn(),
  setSidebarSelectedNode: vi.fn(),
  clearSelection: vi.fn(),
  setGraphData: vi.fn(),
  setLoading: vi.fn(),
}

vi.mock("@/stores/graph-store", () => ({
  useGraphStore: (sel?: (s: unknown) => unknown) => {
    if (!sel) return graphState
    return sel(graphState)
  },
}))

// ── App store ─────────────────────────────────────────────────────────────────
vi.mock("@/stores/app-store", () => ({
  useAppStore: (sel?: (s: unknown) => unknown) => {
    const state = { searchTerm: "" }
    return sel ? sel(state) : state
  },
}))

import { LegalCaseFilesFeed } from "@/skins/legal/legal-case-files-feed"

beforeEach(() => {
  vi.clearAllMocks()
  graphState.nodes = []
})

describe("LegalCaseFilesFeed mount", () => {
  it("never calls getLatestNodes when store is empty", async () => {
    render(<LegalCaseFilesFeed />)

    // Wait for any potential async effects
    await new Promise((r) => setTimeout(r, 50))

    expect(getLatestNodesMock).not.toHaveBeenCalled()
  })

  it("never calls getLatestNodes when store already has nodes", async () => {
    graphState.nodes = [{ ref_id: "existing-1", node_type: "Agreement", properties: {} }]

    render(<LegalCaseFilesFeed />)

    await new Promise((r) => setTimeout(r, 50))

    expect(getLatestNodesMock).not.toHaveBeenCalled()
  })

  it("renders nodes from the store without fetching", async () => {
    graphState.nodes = [
      { ref_id: "agr-1", node_type: "Agreement", properties: { title: "Contract Alpha" } },
    ]

    const { getByText } = render(<LegalCaseFilesFeed />)

    await new Promise((r) => setTimeout(r, 50))

    expect(getByText("Contract Alpha")).toBeDefined()
    expect(getLatestNodesMock).not.toHaveBeenCalled()
  })
})
