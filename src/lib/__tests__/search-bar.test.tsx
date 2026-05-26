/**
 * Tests for SearchBar handleClear:
 * - getLatestNodes called on clear
 * - setGraphData called with resolved nodes/edges
 * - setLoading(true) before fetch, setLoading(false) after
 * - setSearchTerm("") and clearSelection() both called
 * - mock mode: setGraphData called with MOCK_NODES/MOCK_EDGES
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import React from "react"

// ── Mocks ─────────────────────────────────────────────────────────────────────

const setGraphData = vi.fn()
const setLoading = vi.fn()
const clearSelection = vi.fn()

vi.mock("@/stores/graph-store", () => ({
  useGraphStore: (sel?: (s: unknown) => unknown) => {
    const state = { setGraphData, setLoading, clearSelection }
    return sel ? sel(state) : state
  },
}))

const setSearchTerm = vi.fn()
const closeAllPanels = vi.fn()

vi.mock("@/stores/app-store", () => ({
  useAppStore: (sel?: (s: unknown) => unknown) => {
    const state = { setSearchTerm, closeAllPanels }
    return sel ? sel(state) : state
  },
}))

vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel?: (s: unknown) => unknown) => {
    const state = { refreshBalance: vi.fn() }
    return sel ? sel(state) : state
  },
}))

vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel?: (s: unknown) => unknown) => {
    const state = { open: vi.fn() }
    return sel ? sel(state) : state
  },
}))

const mockGetLatestNodes = vi.fn()
vi.mock("@/lib/graph-api", () => ({
  searchNodes: vi.fn(),
  getLatestNodes: (...args: unknown[]) => mockGetLatestNodes(...args),
}))

const { MOCK_NODES, MOCK_EDGES } = vi.hoisted(() => ({
  MOCK_NODES: [{ ref_id: "mock-1", node_type: "Topic", properties: {} }] as unknown[],
  MOCK_EDGES: [] as unknown[],
}))

let mocksEnabled = false

vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => mocksEnabled,
  MOCK_NODES,
  MOCK_EDGES,
}))

vi.mock("@/lib/input-limits", () => ({
  MAX_LENGTHS: { SEARCH_QUERY: 200 },
}))

vi.mock("@/lib/sphinx", () => ({
  payL402: vi.fn(),
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

import { SearchBar } from "@/components/search/search-bar"

describe("SearchBar handleClear", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocksEnabled = false
    mockGetLatestNodes.mockResolvedValue({ nodes: [{ ref_id: "n1" }], edges: [{ id: "e1" }] })
  })

  function renderWithValue(inputValue: string) {
    const { rerender } = render(<SearchBar />)
    const input = screen.getByPlaceholderText("Search the graph...")
    fireEvent.change(input, { target: { value: inputValue } })
    return { rerender }
  }

  it("calls getLatestNodes when clear is clicked", async () => {
    renderWithValue("bitcoin")
    const clearBtn = screen.getByRole("button")
    fireEvent.click(clearBtn)
    await waitFor(() => expect(mockGetLatestNodes).toHaveBeenCalledTimes(1))
  })

  it("calls setGraphData with resolved nodes/edges", async () => {
    renderWithValue("test")
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() =>
      expect(setGraphData).toHaveBeenCalledWith([{ ref_id: "n1" }], [{ id: "e1" }])
    )
  })

  it("calls setLoading(true) before fetch and setLoading(false) after", async () => {
    renderWithValue("test")
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() => expect(setLoading).toHaveBeenCalledWith(false))
    const calls = setLoading.mock.calls.map((c) => c[0])
    expect(calls[0]).toBe(true)
    expect(calls[calls.length - 1]).toBe(false)
  })

  it("calls setSearchTerm('') and clearSelection()", async () => {
    renderWithValue("test")
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() => expect(setLoading).toHaveBeenCalledWith(false))
    expect(setSearchTerm).toHaveBeenCalledWith("")
    expect(clearSelection).toHaveBeenCalled()
  })

  it("uses MOCK_NODES/MOCK_EDGES in mock mode", async () => {
    mocksEnabled = true
    renderWithValue("test")
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() => expect(setLoading).toHaveBeenCalledWith(false))
    expect(mockGetLatestNodes).not.toHaveBeenCalled()
    expect(setGraphData).toHaveBeenCalledWith(MOCK_NODES, MOCK_EDGES)
  })

  it("falls back to empty arrays on fetch error", async () => {
    mockGetLatestNodes.mockRejectedValue(new Error("network error"))
    renderWithValue("test")
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() => expect(setLoading).toHaveBeenCalledWith(false))
    expect(setGraphData).toHaveBeenCalledWith([], [])
  })
})
