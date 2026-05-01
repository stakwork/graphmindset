import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"

// --- mutable state for tests ---
let myContentOpen = false

// --- store mocks ---
const mockSetMyContentOpen = vi.fn()
const mockSetSearchTerm = vi.fn()
const mockSetGraphData = vi.fn()
const mockSetHoveredNode = vi.fn()
const mockSetSidebarSelectedNode = vi.fn()

vi.mock("@/stores/app-store", () => {
  const getState = () => ({
    setSearchTerm: mockSetSearchTerm,
  })
  const useAppStore = (sel?: (s: unknown) => unknown) => {
    const state = {
      myContentOpen,
      setMyContentOpen: mockSetMyContentOpen,
      searchTerm: "",
      setSearchTerm: mockSetSearchTerm,
      myContentNodes: [],
      setMyContentNodes: vi.fn(),
    }
    return sel ? sel(state) : state
  }
  useAppStore.getState = getState
  return { useAppStore }
})

vi.mock("@/stores/graph-store", () => {
  const getState = () => ({
    setGraphData: mockSetGraphData,
    setHoveredNode: mockSetHoveredNode,
    setSidebarSelectedNode: mockSetSidebarSelectedNode,
  })
  const useGraphStore = (sel?: (s: unknown) => unknown) => {
    const state = {
      nodes: [],
      edges: [],
      selectedNode: null,
      setGraphData: mockSetGraphData,
      setHoveredNode: mockSetHoveredNode,
      setSidebarSelectedNode: mockSetSidebarSelectedNode,
    }
    return sel ? sel(state) : state
  }
  useGraphStore.getState = getState
  return { useGraphStore }
})

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel?: (s: unknown) => unknown) => {
    const state = { schemas: [{}], fetchAll: vi.fn(), setSchemas: vi.fn() }
    return sel ? sel(state) : state
  },
}))

vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel?: (s: unknown) => unknown) => {
    const state = { pubKey: "", isAdmin: false, budget: 0 }
    return sel ? sel(state) : state
  },
}))

vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel: (s: { open: () => void }) => unknown) =>
    sel({ open: vi.fn() }),
}))

// --- mock child components ---
vi.mock("@/components/layout/app-rail", () => ({
  AppRail: ({
    onToggleMyContent,
    myContentOpen: mco,
  }: {
    onToggleMyContent: () => void
    myContentOpen: boolean
  }) => (
    <button data-testid="toggle-my-content" data-open={String(mco)} onClick={onToggleMyContent}>
      My Content
    </button>
  ),
}))
vi.mock("@/components/layout/unified-panel", () => ({ UnifiedPanel: () => <div>Unified Panel</div> }))
vi.mock("@/components/universe", () => ({ Universe: () => <div>Universe</div> }))
vi.mock("@/components/modals/settings-modal", () => ({ SettingsModal: () => null }))
vi.mock("@/components/modals/add-content-modal", () => ({ AddContentModal: () => null }))
vi.mock("@/components/modals/add-node-modal", () => ({ AddNodeModal: () => null }))
vi.mock("@/components/modals/budget-modal", () => ({ BudgetModal: () => null }))
vi.mock("@/components/player/media-player", () => ({ MediaPlayer: () => null }))
vi.mock("@/hooks/use-sidebar-neighbor-fetch", () => ({ useSidebarNeighborFetch: () => {} }))
vi.mock("@/lib/mock-data", () => ({ isMocksEnabled: () => false }))
vi.mock("@/app/ontology/mock-small", () => ({ SMALL_SCHEMAS: [] }))

import { AppLayout } from "@/components/layout/app-layout"

describe("AppLayout – onToggleMyContent handler", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    myContentOpen = false
  })

  it("calls closeSearchResults (setSearchTerm + setGraphData) when opening My Content (myContentOpen=false)", () => {
    myContentOpen = false
    render(<AppLayout />)
    fireEvent.click(screen.getByTestId("toggle-my-content"))
    expect(mockSetSearchTerm).toHaveBeenCalledWith("")
    expect(mockSetGraphData).toHaveBeenCalledWith([], [])
  })

  it("does NOT call closeSearchResults when closing My Content (myContentOpen=true)", () => {
    myContentOpen = true
    render(<AppLayout />)
    fireEvent.click(screen.getByTestId("toggle-my-content"))
    expect(mockSetSearchTerm).not.toHaveBeenCalled()
    expect(mockSetGraphData).not.toHaveBeenCalled()
  })

  it("calls setMyContentOpen(true) when opening (myContentOpen=false)", () => {
    myContentOpen = false
    render(<AppLayout />)
    fireEvent.click(screen.getByTestId("toggle-my-content"))
    expect(mockSetMyContentOpen).toHaveBeenCalledWith(true)
  })

  it("calls setMyContentOpen(false) when closing (myContentOpen=true)", () => {
    myContentOpen = true
    render(<AppLayout />)
    fireEvent.click(screen.getByTestId("toggle-my-content"))
    expect(mockSetMyContentOpen).toHaveBeenCalledWith(false)
  })
})
