import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import React from "react"

// --- mock api (hoisted so vi.mock can reference it) ---
const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }))
vi.mock("@/lib/api", () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}))

// --- mock getPrice ---
const { mockGetPrice } = vi.hoisted(() => ({ mockGetPrice: vi.fn() }))
vi.mock("@/lib/sphinx/payment", () => ({
  getPrice: (...args: unknown[]) => mockGetPrice(...args),
  payL402: vi.fn().mockResolvedValue(undefined),
}))

// Also mock the barrel re-export used by the component
vi.mock("@/lib/sphinx", () => ({
  getPrice: (...args: unknown[]) => mockGetPrice(...args),
  payL402: vi.fn().mockResolvedValue(undefined),
}))

// --- mock-data: disable mocks so real api path is exercised ---
vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => false,
  MOCK_FULL_NODES: {},
}))

// --- stores ---
const mockRefreshBalance = vi.fn()
vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel: (s: { refreshBalance: () => void }) => unknown) =>
    sel({ refreshBalance: mockRefreshBalance }),
}))

const mockOpen = vi.fn()
vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel: (s: { open: typeof mockOpen }) => unknown) =>
    sel({ open: mockOpen }),
}))

vi.mock("@/stores/graph-store", () => ({
  useGraphStore: {
    getState: () => ({ addNodes: vi.fn() }),
  },
}))

vi.mock("@/stores/player-store", () => ({
  usePlayerStore: (sel: (s: { isPlaying: boolean; playingNode: null; setPlayingNode: () => void; setIsPlaying: () => void }) => unknown) =>
    sel({ isPlaying: false, playingNode: null, setPlayingNode: vi.fn(), setIsPlaying: vi.fn() }),
}))

// --- schema icons ---
vi.mock("@/lib/schema-icons", () => ({
  getSchemaIconInfo: () => ({ icon: () => null, accent: "#888" }),
}))

// --- boost button ---
vi.mock("@/components/boost/boost-button", () => ({
  BoostButton: () => null,
}))

import { NodePreviewPanel } from "@/components/layout/node-preview-panel"
import type { GraphNode } from "@/lib/graph-api"

const BASE_NODE: GraphNode = {
  ref_id: "abc",
  node_type: "Topic",
  properties: { name: "Test Node" },
}

const NODE_B: GraphNode = {
  ref_id: "xyz",
  node_type: "Topic",
  properties: { name: "Second Node" },
}

function makeGraphData(node: GraphNode) {
  return { nodes: [node], edges: [] }
}

describe("NodePreviewPanel – price display", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows spinner while getPrice is still pending (no unlock button yet)", async () => {
    // api.get probe throws 402, but getPrice never resolves (pending)
    let resolvePricePromise!: (v: number) => void
    const pricePromise = new Promise<number>((res) => { resolvePricePromise = res })

    mockApiGet.mockRejectedValue(new Response(null, { status: 402 }))
    mockGetPrice.mockReturnValue(pricePromise)

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    // While getPrice is still pending, we're in "loading" state — spinner shown, no unlock button
    await waitFor(() => {
      expect(mockGetPrice).toHaveBeenCalled()
    })
    expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()

    // After getPrice resolves with 0, fallback label appears
    resolvePricePromise(0)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unlock Full Content/i })).toBeInTheDocument()
    })
  })

  it("renders 'Unlock for 10 sats' when getPrice resolves to 10", async () => {
    mockApiGet.mockRejectedValue(new Response(null, { status: 402 }))
    mockGetPrice.mockResolvedValue(10)

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unlock for 10 sats/i })).toBeInTheDocument()
    })
  })

  it("renders 'Unlock Full Content' when getPrice resolves to 0", async () => {
    mockApiGet.mockRejectedValue(new Response(null, { status: 402 }))
    mockGetPrice.mockResolvedValue(0)

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unlock Full Content/i })).toBeInTheDocument()
    })
  })

  it("renders unlocked content directly when probe returns 200 (admin/owner)", async () => {
    const unlockedNode: GraphNode = {
      ref_id: "abc",
      node_type: "Topic",
      properties: { name: "Test Node", text: "Full article text here" },
    }
    mockApiGet.mockResolvedValue(makeGraphData(unlockedNode))

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
    expect(screen.getByText("Full article text here")).toBeInTheDocument()
  })

  it("clears stale price when switching to a different node", async () => {
    // First node: price = 10
    mockApiGet.mockRejectedValue(new Response(null, { status: 402 }))
    mockGetPrice.mockResolvedValue(10)

    const { rerender } = render(
      <NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unlock for 10 sats/i })).toBeInTheDocument()
    })

    // Switch to second node — getPrice is now pending so price should be null (loading)
    let resolveSecondPrice!: (v: number) => void
    const secondPricePromise = new Promise<number>((res) => { resolveSecondPrice = res })
    mockApiGet.mockRejectedValue(new Response(null, { status: 402 }))
    mockGetPrice.mockReturnValue(secondPricePromise)

    rerender(<NodePreviewPanel node={NODE_B} onBack={vi.fn()} schemas={[]} />)

    // During loading phase: spinner should be present
    expect(screen.queryByRole("button", { name: /Unlock for 10 sats/i })).toBeNull()

    // After price resolves for second node
    resolveSecondPrice(25)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unlock for 25 sats/i })).toBeInTheDocument()
    })
  })

  it("calls getPrice with method=get and the node ref_id", async () => {
    mockApiGet.mockRejectedValue(new Response(null, { status: 402 }))
    mockGetPrice.mockResolvedValue(10)

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(mockGetPrice).toHaveBeenCalledWith(
        "v2/nodes/abc",
        "get",
        expect.any(AbortSignal),
      )
    })
  })
})
