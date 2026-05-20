import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import React from "react"

// --- mock watch-api ---
const mockGetFollowingFeed = vi.fn()
const mockGetWatches = vi.fn()
const mockUnwatchNode = vi.fn()
const mockUnsubscribeType = vi.fn()

vi.mock("@/lib/watch-api", () => ({
  getFollowingFeed: (...args: unknown[]) => mockGetFollowingFeed(...args),
  getWatches: (...args: unknown[]) => mockGetWatches(...args),
  unwatchNode: (...args: unknown[]) => mockUnwatchNode(...args),
  unsubscribeType: (...args: unknown[]) => mockUnsubscribeType(...args),
}))

// --- mock FeedCard ---
vi.mock("@/components/feed/feed-card", () => ({
  FeedCard: ({ node }: { node: { ref_id: string; properties?: { name?: string } } }) => (
    <div data-testid={`feed-card-${node.ref_id}`}>{node.properties?.name ?? node.ref_id}</div>
  ),
}))

// --- mock NodeRow ---
vi.mock("@/components/layout/node-row", () => ({
  NodeRow: ({ node }: { node: { ref_id: string; properties?: { name?: string } } }) => (
    <div data-testid={`node-row-${node.ref_id}`}>{node.properties?.name ?? node.ref_id}</div>
  ),
}))

// --- mock stores ---
vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel: (s: { schemas: never[] }) => unknown) => sel({ schemas: [] }),
}))

vi.mock("@/stores/graph-store", () => ({
  useGraphStore: (sel: (s: {
    setSelectedNode: () => void
    setSidebarSelectedNode: () => void
    setHoveredNode: () => void
  }) => unknown) =>
    sel({
      setSelectedNode: vi.fn(),
      setSidebarSelectedNode: vi.fn(),
      setHoveredNode: vi.fn(),
    }),
}))

import { FollowingPanel } from "@/components/layout/following-panel"

const MOCK_NODES = [
  { ref_id: "n1", node_type: "Episode", properties: { name: "Episode One" } },
  { ref_id: "n2", node_type: "Clip", properties: { name: "Clip Two" } },
]

const MOCK_WATCHES_WITH_DATA = {
  nodes: [{ ref_id: "mock-1", node_type: "Episode", properties: { episode_title: "Mock Episode" } }],
  types: ["Clip"],
}

const MOCK_WATCHES_EMPTY = {
  nodes: [],
  types: [],
}

describe("FollowingPanel — Feed tab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUnwatchNode.mockResolvedValue(undefined)
    mockUnsubscribeType.mockResolvedValue(undefined)
  })

  it("renders empty state A (Heart icon + prompt) when getWatches returns empty", async () => {
    mockGetWatches.mockResolvedValue(MOCK_WATCHES_EMPTY)
    mockGetFollowingFeed.mockResolvedValue({ nodes: [], edges: [] })

    render(<FollowingPanel onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText("Nothing here yet")).toBeInTheDocument()
    })
    expect(
      screen.getByText(/Watch a node from its preview panel/)
    ).toBeInTheDocument()
  })

  it("renders empty state B when getWatches returns non-empty but getFollowingFeed returns no nodes", async () => {
    mockGetWatches.mockResolvedValue(MOCK_WATCHES_WITH_DATA)
    mockGetFollowingFeed.mockResolvedValue({ nodes: [], edges: [] })

    render(<FollowingPanel onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText("No new content yet — check back soon.")).toBeInTheDocument()
    })
  })

  it("renders FeedCard for each node in getFollowingFeed mock response", async () => {
    mockGetWatches.mockResolvedValue(MOCK_WATCHES_WITH_DATA)
    mockGetFollowingFeed.mockResolvedValue({ nodes: MOCK_NODES, edges: [] })

    render(<FollowingPanel onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByTestId("feed-card-n1")).toBeInTheDocument()
      expect(screen.getByTestId("feed-card-n2")).toBeInTheDocument()
    })
  })
})

describe("FollowingPanel — Watching tab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFollowingFeed.mockResolvedValue({ nodes: [], edges: [] })
    mockUnwatchNode.mockResolvedValue(undefined)
    mockUnsubscribeType.mockResolvedValue(undefined)
  })

  it("shows empty state (Bookmark icon + text) when no watches", async () => {
    mockGetWatches.mockResolvedValue(MOCK_WATCHES_EMPTY)

    render(<FollowingPanel onClose={vi.fn()} />)

    // Switch to Watching tab
    fireEvent.click(screen.getByRole("tab", { name: /watching/i }))

    await waitFor(() => {
      expect(screen.getByText("You're not watching anything yet.")).toBeInTheDocument()
    })
  })

  it("unwatch confirm flow: clicking Trash shows confirm row; Confirm removes node from list", async () => {
    mockGetWatches.mockResolvedValue(MOCK_WATCHES_WITH_DATA)

    render(<FollowingPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("tab", { name: /watching/i }))

    await waitFor(() => {
      expect(screen.getByTestId("node-row-mock-1")).toBeInTheDocument()
    })

    // Hover to reveal the trash button
    const row = screen.getByTestId("node-row-mock-1").closest(".group")!
    fireEvent.mouseEnter(row)

    const trashBtn = screen.getByLabelText("Unwatch node")
    fireEvent.click(trashBtn)

    // Confirm row appears
    expect(screen.getByText("Unwatch?")).toBeInTheDocument()

    // Click Confirm
    fireEvent.click(screen.getByText("Confirm"))

    await waitFor(() => {
      expect(mockUnwatchNode).toHaveBeenCalledWith("mock-1")
    })
    await waitFor(() => {
      expect(screen.queryByTestId("node-row-mock-1")).not.toBeInTheDocument()
    })
  })

  it("unwatch confirm flow: clicking Cancel does not remove node from list", async () => {
    mockGetWatches.mockResolvedValue(MOCK_WATCHES_WITH_DATA)

    render(<FollowingPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("tab", { name: /watching/i }))

    await waitFor(() => {
      expect(screen.getByTestId("node-row-mock-1")).toBeInTheDocument()
    })

    const trashBtn = screen.getByLabelText("Unwatch node")
    fireEvent.click(trashBtn)

    expect(screen.getByText("Unwatch?")).toBeInTheDocument()

    // Click Cancel
    fireEvent.click(screen.getByText("Cancel"))

    expect(mockUnwatchNode).not.toHaveBeenCalled()
    expect(screen.getByTestId("node-row-mock-1")).toBeInTheDocument()
  })

  it("clicking X on a type badge removes it from the list optimistically", async () => {
    mockGetWatches.mockResolvedValue(MOCK_WATCHES_WITH_DATA)

    render(<FollowingPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("tab", { name: /watching/i }))

    await waitFor(() => {
      expect(screen.getByText("Clip")).toBeInTheDocument()
    })

    const unsubBtn = screen.getByLabelText("Unsubscribe from Clip")
    fireEvent.click(unsubBtn)

    await waitFor(() => {
      expect(mockUnsubscribeType).toHaveBeenCalledWith("Clip")
    })
    await waitFor(() => {
      expect(screen.queryByText("Clip")).not.toBeInTheDocument()
    })
  })
})
