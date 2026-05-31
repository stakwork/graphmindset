import { describe, it, expect, vi, beforeEach } from "vitest"

// --- mock graph-api ---
const { mockGetNode } = vi.hoisted(() => ({ mockGetNode: vi.fn() }))
vi.mock("@/lib/graph-api", () => ({
  getNode: (...args: unknown[]) => mockGetNode(...args),
  isGraphData: (r: unknown) =>
    typeof r === "object" &&
    r !== null &&
    Array.isArray((r as { nodes: unknown }).nodes) &&
    Array.isArray((r as { edges: unknown }).edges),
}))

// --- mock graph-store ---
const mockAddNodes = vi.fn()
const mockSetSelectedNode = vi.fn()
vi.mock("@/stores/graph-store", () => ({
  useGraphStore: Object.assign(vi.fn(), {
    getState: () => ({
      addNodes: mockAddNodes,
      setSelectedNode: mockSetSelectedNode,
    }),
  }),
}))

// --- mock player-store ---
const mockSetPlayingNode = vi.fn()
vi.mock("@/stores/player-store", () => ({
  usePlayerStore: Object.assign(vi.fn(), {
    getState: () => ({
      setPlayingNode: mockSetPlayingNode,
    }),
  }),
}))

import { unlockNode } from "@/lib/unlock-node"
import type { GraphNode, GraphEdge } from "@/lib/graph-api"

const MOCK_NODE: GraphNode = {
  ref_id: "node-123",
  node_type: "Episode",
  properties: { name: "Test Episode", media_url: "https://example.com/audio.mp3" },
}

const MOCK_NODE_NO_MEDIA: GraphNode = {
  ref_id: "node-456",
  node_type: "Topic",
  properties: { name: "Test Topic" },
}

const MOCK_NODE_LINK: GraphNode = {
  ref_id: "node-789",
  node_type: "Episode",
  properties: { name: "Link Episode", link: "https://example.com/video" },
}

const MOCK_EDGE: GraphEdge = {
  source: "node-123",
  target: "node-abc",
  edge_type: "MENTIONS",
  ref_id: "edge-1",
}

describe("unlockNode", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("calls getNode with expand='edges'", async () => {
    mockGetNode.mockResolvedValue({ nodes: [MOCK_NODE], edges: [] })
    await unlockNode("node-123")
    expect(mockGetNode).toHaveBeenCalledWith("node-123", "edges")
  })

  it("calls addNodes with correct nodes and edges", async () => {
    mockGetNode.mockResolvedValue({ nodes: [MOCK_NODE], edges: [MOCK_EDGE] })
    await unlockNode("node-123")
    expect(mockAddNodes).toHaveBeenCalledWith([MOCK_NODE], [MOCK_EDGE])
  })

  it("calls setSelectedNode with the unlocked node", async () => {
    mockGetNode.mockResolvedValue({ nodes: [MOCK_NODE], edges: [] })
    await unlockNode("node-123")
    expect(mockSetSelectedNode).toHaveBeenCalledWith(MOCK_NODE)
  })

  it("calls setPlayingNode when node has media_url", async () => {
    mockGetNode.mockResolvedValue({ nodes: [MOCK_NODE], edges: [] })
    await unlockNode("node-123")
    expect(mockSetPlayingNode).toHaveBeenCalledWith(MOCK_NODE)
  })

  it("calls setPlayingNode when node has link but no media_url", async () => {
    mockGetNode.mockResolvedValue({ nodes: [MOCK_NODE_LINK], edges: [] })
    await unlockNode("node-789")
    expect(mockSetPlayingNode).toHaveBeenCalledWith(MOCK_NODE_LINK)
  })

  it("does NOT call setPlayingNode when node has no media_url or link", async () => {
    mockGetNode.mockResolvedValue({ nodes: [MOCK_NODE_NO_MEDIA], edges: [] })
    await unlockNode("node-456")
    expect(mockSetPlayingNode).not.toHaveBeenCalled()
  })

  it("returns the unlocked GraphNode", async () => {
    mockGetNode.mockResolvedValue({ nodes: [MOCK_NODE], edges: [] })
    const result = await unlockNode("node-123")
    expect(result).toBe(MOCK_NODE)
  })

  it("returns null when nodes array is empty", async () => {
    mockGetNode.mockResolvedValue({ nodes: [], edges: [] })
    const result = await unlockNode("node-123")
    expect(result).toBeNull()
  })

  it("throws when getNode throws, so callers can handle 402", async () => {
    const err = new Response(null, { status: 402 })
    mockGetNode.mockRejectedValue(err)
    await expect(unlockNode("node-123")).rejects.toBe(err)
  })

  it("logs console.info on success", async () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    mockGetNode.mockResolvedValue({ nodes: [MOCK_NODE], edges: [MOCK_EDGE] })
    await unlockNode("node-123")
    expect(consoleSpy).toHaveBeenCalledWith("[unlock] fetched", {
      refId: "node-123",
      nodes: 1,
      edges: 1,
    })
  })

  it("logs console.warn on failure", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const err = new Error("network error")
    mockGetNode.mockRejectedValue(err)
    await expect(unlockNode("node-123")).rejects.toBe(err)
    expect(consoleSpy).toHaveBeenCalledWith("[unlock] failed", {
      refId: "node-123",
      err,
    })
  })
})
