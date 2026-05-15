import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import React from "react"

// --- mutable state for tests ---
let followingOpen = false
let sourcesOpen = false
let myContentOpen = false
let clipsOpen = false

// --- store mocks ---
vi.mock("@/stores/app-store", () => {
  const useAppStore = (sel?: (s: unknown) => unknown) => {
    const state = {
      followingOpen,
      sourcesOpen,
      myContentOpen,
      clipsOpen,
      setFollowingOpen: vi.fn(),
      setSourcesOpen: vi.fn(),
      setMyContentOpen: vi.fn(),
      setClipsOpen: vi.fn(),
      searchTerm: "",
    }
    return sel ? sel(state) : state
  }
  useAppStore.getState = () => ({})
  return { useAppStore }
})

vi.mock("@/stores/graph-store", () => {
  const getState = () => ({ clearSelection: vi.fn() })
  const useGraphStore = (sel?: (s: unknown) => unknown) => {
    const state = {
      nodes: [],
      edges: [],
      selectedNode: null,
      clearSelection: vi.fn(),
      setSelectedNode: vi.fn(),
      setSidebarSelectedNode: vi.fn(),
      setHoveredNode: vi.fn(),
      setGraphData: vi.fn(),
      setLoading: vi.fn(),
      loading: false,
    }
    return sel ? sel(state) : state
  }
  useGraphStore.getState = getState
  return { useGraphStore }
})

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel?: (s: unknown) => unknown) => {
    const state = { schemas: [] }
    return sel ? sel(state) : state
  },
}))

vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel?: (s: unknown) => unknown) => {
    const state = { pubKey: "", isAdmin: false }
    return sel ? sel(state) : state
  },
}))

vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel: (s: { open: () => void }) => unknown) =>
    sel({ open: vi.fn() }),
}))

// --- mock child panels ---
vi.mock("@/components/layout/following-panel", () => ({
  FollowingPanel: () => <div data-testid="following-panel">Following Panel</div>,
}))
vi.mock("@/components/layout/sources-panel", () => ({
  SourcesPanel: () => <div data-testid="sources-panel">Sources Panel</div>,
}))
vi.mock("@/components/layout/my-content-panel", () => ({
  MyContentPanel: () => <div data-testid="my-content-panel">My Content Panel</div>,
}))
vi.mock("@/components/layout/clips-panel", () => ({
  ClipsPanel: () => <div data-testid="clips-panel">Clips Panel</div>,
}))
vi.mock("@/components/layout/node-preview-panel", () => ({
  NodePreviewPanel: () => <div data-testid="node-preview-panel">Node Preview</div>,
}))
vi.mock("@/components/feed/feed-view", () => ({
  FeedView: () => <div data-testid="feed-view">Feed View</div>,
}))
vi.mock("@/components/search/search-bar", () => ({
  SearchBar: () => <input data-testid="search-bar" />,
}))
vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => false,
  MOCK_NODES: [],
  MOCK_EDGES: [],
}))
vi.mock("@/lib/cookie-storage", () => ({
  cookieStorage: { getItem: () => null },
}))
vi.mock("@/lib/watch-api", () => ({
  getWatches: vi.fn().mockResolvedValue({ nodes: [], types: [] }),
}))

import { MainArea } from "@/components/layout/main-area"

describe("MainArea — pickMode() with followingOpen", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    followingOpen = false
    sourcesOpen = false
    myContentOpen = false
    clipsOpen = false
  })

  it("renders FollowingPanel when followingOpen is true", () => {
    followingOpen = true
    render(<MainArea />)
    expect(screen.getByTestId("following-panel")).toBeInTheDocument()
    expect(screen.queryByTestId("feed-view")).not.toBeInTheDocument()
  })

  it("renders feed when followingOpen is false and no other panel is open", () => {
    followingOpen = false
    render(<MainArea />)
    expect(screen.getByTestId("feed-view")).toBeInTheDocument()
    expect(screen.queryByTestId("following-panel")).not.toBeInTheDocument()
  })

  it("followingOpen takes precedence over feed but not clipsOpen (priority order)", () => {
    followingOpen = true
    clipsOpen = true
    render(<MainArea />)
    // clipsOpen comes before followingOpen in pickMode
    expect(screen.getByTestId("clips-panel")).toBeInTheDocument()
    expect(screen.queryByTestId("following-panel")).not.toBeInTheDocument()
  })
})
