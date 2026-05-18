/**
 * Tests for LeftPane pickMode() ordering:
 * - clipsOpen=true + selectedNode set → returns "preview"
 * - clearSelection() with clipsOpen=true → returns "clips"
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import React from "react"

// ── Store state ───────────────────────────────────────────────────────────────

const mockNode = { ref_id: "clip-1", node_type: "Clip", label: "Test Clip" }

const graphState = {
  selectedNode: null as unknown,
  clearSelection: vi.fn(),
}

vi.mock("@/stores/graph-store", () => ({
  useGraphStore: (sel?: (s: unknown) => unknown) =>
    sel ? sel(graphState) : graphState,
}))

const appState = {
  sourcesOpen: false,
  myContentOpen: false,
  clipsOpen: false,
  followingOpen: false,
  setSourcesOpen: vi.fn(),
  setMyContentOpen: vi.fn(),
  setClipsOpen: vi.fn(),
  setFollowingOpen: vi.fn(),
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

// ── Panel mocks ───────────────────────────────────────────────────────────────

vi.mock("@/components/feed/feed-view", () => ({
  FeedView: () => <div data-testid="feed-view" />,
}))
vi.mock("@/components/layout/sources-panel", () => ({
  SourcesPanel: () => <div data-testid="sources-panel" />,
}))
vi.mock("@/components/layout/my-content-panel", () => ({
  MyContentPanel: () => <div data-testid="my-content-panel" />,
}))
vi.mock("@/components/layout/clips-panel", () => ({
  ClipsPanel: () => <div data-testid="clips-panel" />,
}))
vi.mock("@/components/layout/following-panel", () => ({
  FollowingPanel: () => <div data-testid="following-panel" />,
}))
vi.mock("@/components/layout/node-preview-panel", () => ({
  NodePreviewPanel: () => <div data-testid="node-preview-panel" />,
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

import { LeftPane } from "@/components/layout/left-pane"

describe("LeftPane pickMode()", () => {
  beforeEach(() => {
    graphState.selectedNode = null
    appState.sourcesOpen = false
    appState.myContentOpen = false
    appState.clipsOpen = false
    appState.followingOpen = false
  })

  it("shows feed when nothing is open", () => {
    render(<LeftPane />)
    expect(screen.getByTestId("feed-view")).toBeTruthy()
  })

  it("shows clips panel when clipsOpen=true and no node selected", () => {
    appState.clipsOpen = true
    render(<LeftPane />)
    expect(screen.getByTestId("clips-panel")).toBeTruthy()
    expect(screen.queryByTestId("node-preview-panel")).toBeNull()
  })

  it("shows node preview (not clips) when clipsOpen=true AND selectedNode is set", () => {
    appState.clipsOpen = true
    graphState.selectedNode = mockNode
    render(<LeftPane />)
    expect(screen.getByTestId("node-preview-panel")).toBeTruthy()
    expect(screen.queryByTestId("clips-panel")).toBeNull()
  })

  it("returns to clips panel after clearSelection() with clipsOpen=true", () => {
    // Simulate state after back is tapped: selectedNode cleared, clipsOpen still true
    appState.clipsOpen = true
    graphState.selectedNode = null
    render(<LeftPane />)
    expect(screen.getByTestId("clips-panel")).toBeTruthy()
    expect(screen.queryByTestId("node-preview-panel")).toBeNull()
    expect(screen.queryByTestId("feed-view")).toBeNull()
  })
})
