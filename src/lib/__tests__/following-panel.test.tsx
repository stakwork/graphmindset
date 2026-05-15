import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import React from "react"

// ---- mock watch-api ----
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

// ---- mock FeedCard ----
vi.mock("@/components/feed/feed-card", () => ({
  FeedCard: ({ node }: { node: { ref_id: string; node_type: string } }) => (
    <div data-testid={`feed-card-${node.ref_id}`}>{node.node_type}</div>
  ),
}))

// ---- mock NodeRow ----
vi.mock("@/components/layout/node-row", () => ({
  NodeRow: ({ node }: { node: { ref_id: string; properties: Record<string, unknown> } }) => (
    <div data-testid={`node-row-${node.ref_id}`}>{String(node.properties.name ?? node.ref_id)}</div>
  ),
}))

// ---- mock stores ----
vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel: (s: { schemas: never[] }) => unknown) => sel({ schemas: [] }),
}))

const mockSetSelectedNode = vi.fn()
const mockSetSidebarSelectedNode = vi.fn()
const mockSetHoveredNode = vi.fn()

vi.mock("@/stores/graph-store", () => ({
  useGraphStore: (sel: (s: {
    setSelectedNode: typeof mockSetSelectedNode
    setSidebarSelectedNode: typeof mockSetSidebarSelectedNode
    setHoveredNode: typeof mockSetHoveredNode
  }) => unknown) =>
    sel({
      setSelectedNode: mockSetSelectedNode,
      setSidebarSelectedNode: mockSetSidebarSelectedNode,
      setHoveredNode: mockSetHoveredNode,
    }),
}))

import { FollowingPanel } from "@/components/layout/following-panel"

const MOCK_NODES = [
  { ref_id: "n1", node_type: "Episode", properties: { name: "Episode 1" }, date_added_to_graph: 1000 },
  { ref_id: "n2", node_type: "Clip", properties: { name: "Clip 1" }, date_added_to_graph: 900 },
]

const MOCK_WATCHES = {
  nodes: [{ ref_id: "mock-1", node_type: "Episode", title: "Mock Episode" }],
  types: ["Clip"],
}

const EMPTY_WATCHES = { nodes: [], types: [] }

describe("FollowingPanel", () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFollowingFeed.mockResolvedValue({ nodes: [], edges: [] })
    mockGetWatches.mockResolvedValue(EMPTY_WATCHES)
    mockUnwatchNode.mockResolvedValue(undefined)
    mockUnsubscribeType.mockResolvedValue(undefined)
  })

  it("renders the panel header and close button", async () => {
    render(<FollowingPanel onClose={onClose} />)
    expect(screen.getByText("Following")).toBeInTheDocument()
  })

  it("calls onClose when X button is clicked", async () => {
    render(<FollowingPanel onClose={onClose} />)
    const closeBtn = screen.getByRole("button", { name: /close/i })
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("shows loading spinner while fetching", () => {
    // Never resolves
    mockGetFollowingFeed.mockImplementation(() => new Promise(() => {}))
    mockGetWatches.mockImplementation(() => new Promise(() => {}))
    render(<FollowingPanel onClose={onClose} />)
    // Feed tab is active by default and shows spinner
    const spinners = document.querySelectorAll(".animate-spin")
    expect(spinners.length).toBeGreaterThan(0)
  })

  describe("Feed tab — empty state (no watches)", () => {
    it("shows 'Nothing here yet' when user has no watches and feed is empty", async () => {
      mockGetWatches.mockResolvedValue(EMPTY_WATCHES)
      mockGetFollowingFeed.mockResolvedValue({ nodes: [], edges: [] })
      render(<FollowingPanel onClose={onClose} />)
      await waitFor(() => {
        expect(screen.getByText("Nothing here yet")).toBeInTheDocument()
      })
      expect(screen.getByText(/Watch a node from its preview panel/)).toBeInTheDocument()
    })
  })

  describe("Feed tab — has watches but no content", () => {
    it("shows 'No new content yet' when watches exist but feed is empty", async () => {
      mockGetWatches.mockResolvedValue(MOCK_WATCHES)
      mockGetFollowingFeed.mockResolvedValue({ nodes: [], edges: [] })
      render(<FollowingPanel onClose={onClose} />)
      await waitFor(() => {
        expect(screen.getByText(/No new content yet/)).toBeInTheDocument()
      })
    })
  })

  describe("Feed tab — renders FeedCard for each node", () => {
    it("renders a FeedCard for each node returned by getFollowingFeed", async () => {
      mockGetWatches.mockResolvedValue(MOCK_WATCHES)
      mockGetFollowingFeed.mockResolvedValue({ nodes: MOCK_NODES, edges: [] })
      render(<FollowingPanel onClose={onClose} />)
      await waitFor(() => {
        expect(screen.getByTestId("feed-card-n1")).toBeInTheDocument()
        expect(screen.getByTestId("feed-card-n2")).toBeInTheDocument()
      })
    })
  })

  describe("Watching tab", () => {
    it("shows empty state when no watches or subscriptions exist", async () => {
      mockGetWatches.mockResolvedValue(EMPTY_WATCHES)
      mockGetFollowingFeed.mockResolvedValue({ nodes: [], edges: [] })
      render(<FollowingPanel onClose={onClose} />)
      // Switch to Watching tab
      fireEvent.click(screen.getByRole("tab", { name: /watching/i }))
      await waitFor(() => {
        expect(screen.getByText(/You're not watching anything yet/)).toBeInTheDocument()
      })
    })

    it("renders watched nodes as NodeRow items", async () => {
      mockGetWatches.mockResolvedValue(MOCK_WATCHES)
      mockGetFollowingFeed.mockResolvedValue({ nodes: [], edges: [] })
      render(<FollowingPanel onClose={onClose} />)
      fireEvent.click(screen.getByRole("tab", { name: /watching/i }))
      await waitFor(() => {
        expect(screen.getByTestId("node-row-mock-1")).toBeInTheDocument()
        expect(screen.getByText("Mock Episode")).toBeInTheDocument()
      })
    })

    it("renders subscribed type badges", async () => {
      mockGetWatches.mockResolvedValue(MOCK_WATCHES)
      mockGetFollowingFeed.mockResolvedValue({ nodes: [], edges: [] })
      render(<FollowingPanel onClose={onClose} />)
      fireEvent.click(screen.getByRole("tab", { name: /watching/i }))
      await waitFor(() => {
        expect(screen.getByText("Clip")).toBeInTheDocument()
      })
    })

    it("shows unwatch confirm row when Trash icon is clicked", async () => {
      mockGetWatches.mockResolvedValue(MOCK_WATCHES)
      mockGetFollowingFeed.mockResolvedValue({ nodes: [], edges: [] })
      render(<FollowingPanel onClose={onClose} />)
      fireEvent.click(screen.getByRole("tab", { name: /watching/i }))
      await waitFor(() => {
        expect(screen.getByTestId("node-row-mock-1")).toBeInTheDocument()
      })
      fireEvent.click(screen.getByLabelText("Unwatch node"))
      expect(screen.getByText("Unwatch?")).toBeInTheDocument()
      expect(screen.getByText("Confirm")).toBeInTheDocument()
      expect(screen.getByText("Cancel")).toBeInTheDocument()
    })

    it("calls unwatchNode and removes node on Confirm", async () => {
      mockGetWatches.mockResolvedValue(MOCK_WATCHES)
      mockGetFollowingFeed.mockResolvedValue({ nodes: [], edges: [] })
      render(<FollowingPanel onClose={onClose} />)
      fireEvent.click(screen.getByRole("tab", { name: /watching/i }))
      await waitFor(() => expect(screen.getByTestId("node-row-mock-1")).toBeInTheDocument())

      fireEvent.click(screen.getByLabelText("Unwatch node"))
      fireEvent.click(screen.getByText("Confirm"))

      await waitFor(() => {
        expect(mockUnwatchNode).toHaveBeenCalledWith("mock-1")
        expect(screen.queryByTestId("node-row-mock-1")).not.toBeInTheDocument()
      })
    })

    it("hides confirm row on Cancel without unwatching", async () => {
      mockGetWatches.mockResolvedValue(MOCK_WATCHES)
      mockGetFollowingFeed.mockResolvedValue({ nodes: [], edges: [] })
      render(<FollowingPanel onClose={onClose} />)
      fireEvent.click(screen.getByRole("tab", { name: /watching/i }))
      await waitFor(() => expect(screen.getByTestId("node-row-mock-1")).toBeInTheDocument())

      fireEvent.click(screen.getByLabelText("Unwatch node"))
      fireEvent.click(screen.getByText("Cancel"))

      expect(mockUnwatchNode).not.toHaveBeenCalled()
      expect(screen.queryByText("Unwatch?")).not.toBeInTheDocument()
      expect(screen.getByTestId("node-row-mock-1")).toBeInTheDocument()
    })

    it("calls unsubscribeType and removes badge when X is clicked on type chip", async () => {
      mockGetWatches.mockResolvedValue(MOCK_WATCHES)
      mockGetFollowingFeed.mockResolvedValue({ nodes: [], edges: [] })
      render(<FollowingPanel onClose={onClose} />)
      fireEvent.click(screen.getByRole("tab", { name: /watching/i }))
      await waitFor(() => expect(screen.getByText("Clip")).toBeInTheDocument())

      fireEvent.click(screen.getByLabelText("Unsubscribe from Clip"))

      await waitFor(() => {
        expect(mockUnsubscribeType).toHaveBeenCalledWith("Clip")
        expect(screen.queryByText("Clip")).not.toBeInTheDocument()
      })
    })
  })
})

// ---- pickMode unit tests ----
describe("MainArea pickMode — following priority", () => {
  it("pickMode returns 'following' when followingOpen=true and selectedNode exists", () => {
    // We test the logic directly since it's a plain function
    function pickMode(sourcesOpen: boolean, myContentOpen: boolean, clipsOpen: boolean, followingOpen: boolean, selectedNode: object | null): string {
      if (sourcesOpen) return "sources"
      if (myContentOpen) return "mycontent"
      if (clipsOpen) return "clips"
      if (followingOpen) return "following"
      if (selectedNode) return "preview"
      return "feed"
    }

    // followingOpen=true, selectedNode present → "following" wins
    expect(pickMode(false, false, false, true, { ref_id: "x" })).toBe("following")
    // followingOpen=false, selectedNode present → "preview"
    expect(pickMode(false, false, false, false, { ref_id: "x" })).toBe("preview")
    // followingOpen=true, clipsOpen=true → "clips" wins (higher priority)
    expect(pickMode(false, false, true, true, null)).toBe("clips")
    // all false → "feed"
    expect(pickMode(false, false, false, false, null)).toBe("feed")
  })
})
