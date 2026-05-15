import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"

// --- mutable state for tests ---
let myContentOpen = false

// --- store mocks ---
const mockClearSelection = vi.fn()
const mockToggleMyContent = vi.fn()
const mockToggleSources = vi.fn()
const mockSetGraphData = vi.fn()
const mockSetHoveredNode = vi.fn()
const mockSetSidebarSelectedNode = vi.fn()

vi.mock("@/stores/app-store", () => {
  const useAppStore = (sel?: (s: unknown) => unknown) => {
    const state = {
      myContentOpen,
      sourcesOpen: false,
      clipsOpen: false,
      setMyContentOpen: vi.fn(),
      setSourcesOpen: vi.fn(),
      setClipsOpen: vi.fn(),
      toggleMyContent: mockToggleMyContent,
      toggleSources: mockToggleSources,
      searchTerm: "",
      setSearchTerm: vi.fn(),
    }
    return sel ? sel(state) : state
  }
  useAppStore.getState = () => ({})
  return { useAppStore }
})

vi.mock("@/stores/graph-store", () => {
  const getState = () => ({
    setGraphData: mockSetGraphData,
    setHoveredNode: mockSetHoveredNode,
    setSidebarSelectedNode: mockSetSidebarSelectedNode,
    clearSelection: mockClearSelection,
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
vi.mock("@/components/layout/main-area", () => ({ MainArea: () => <div>Main Area</div> }))
vi.mock("@/components/layout/mobile-nav-drawer", () => ({ MobileNavDrawer: () => null }))
vi.mock("@/components/universe/graph-floater", () => ({ GraphFloater: () => null }))
vi.mock("@/components/modals/settings-modal", () => ({ SettingsModal: () => null }))
vi.mock("@/components/modals/add-content-modal", () => ({ AddContentModal: () => null }))
vi.mock("@/components/modals/add-node-modal", () => ({ AddNodeModal: () => null }))
vi.mock("@/components/modals/create-node-modal", () => ({ CreateNodeModal: () => null }))
vi.mock("@/components/modals/budget-modal", () => ({ BudgetModal: () => null }))
vi.mock("@/components/player/media-player", () => ({ MediaPlayer: () => null }))
vi.mock("@/hooks/use-sidebar-neighbor-fetch", () => ({ useSidebarNeighborFetch: () => {} }))
vi.mock("@/hooks/use-deep-link", () => ({ useDeepLink: () => {} }))
vi.mock("@/lib/mock-data", () => ({ isMocksEnabled: () => false }))
vi.mock("@/app/ontology/mock-small", () => ({ SMALL_SCHEMAS: [] }))

import { AppLayout } from "@/components/layout/app-layout"

describe("AppLayout – onToggleMyContent handler", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    myContentOpen = false
  })

  it("clears the selected graph node when toggling My Content open", () => {
    myContentOpen = false
    render(<AppLayout />)
    fireEvent.click(screen.getByTestId("toggle-my-content"))
    expect(mockClearSelection).toHaveBeenCalled()
  })

  it("calls toggleMyContent when the rail button is clicked (opening)", () => {
    myContentOpen = false
    render(<AppLayout />)
    fireEvent.click(screen.getByTestId("toggle-my-content"))
    expect(mockToggleMyContent).toHaveBeenCalled()
  })

  it("calls toggleMyContent when the rail button is clicked (closing)", () => {
    myContentOpen = true
    render(<AppLayout />)
    fireEvent.click(screen.getByTestId("toggle-my-content"))
    expect(mockToggleMyContent).toHaveBeenCalled()
  })

  it("passes current myContentOpen state to AppRail", () => {
    myContentOpen = true
    render(<AppLayout />)
    expect(screen.getByTestId("toggle-my-content").getAttribute("data-open")).toBe("true")
  })
})
