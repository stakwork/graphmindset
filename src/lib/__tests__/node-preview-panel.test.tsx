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

interface UserStoreState {
  refreshBalance: () => void
  pubKey: string
  routeHint: string
  isAdmin: boolean
}

let userStoreOverrides: Partial<UserStoreState> = {}

vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel: (s: UserStoreState) => unknown) =>
    sel({
      refreshBalance: mockRefreshBalance,
      pubKey: "",
      routeHint: "",
      isAdmin: false,
      ...userStoreOverrides,
    }),
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
    userStoreOverrides = {}
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

describe("NodePreviewPanel – boost visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
    // Default: api probe returns 200 so BoostButton area is reached
    mockApiGet.mockResolvedValue({ nodes: [{ ref_id: "abc", node_type: "Topic", properties: { name: "Test Node", pubkey: "03abc" } }], edges: [] })
  })

  const nodeWithPubkey = (pubkey: string): GraphNode => ({
    ref_id: "abc",
    node_type: "Topic",
    properties: { name: "Test Node", pubkey },
  })

  it("hides BoostButton when bare pubkey matches user pubKey (contributor)", async () => {
    userStoreOverrides = { pubKey: "03abc", routeHint: "", isAdmin: false }
    mockApiGet.mockResolvedValue(makeGraphData(nodeWithPubkey("03abc")))

    const { container } = render(
      <NodePreviewPanel node={nodeWithPubkey("03abc")} onBack={vi.fn()} schemas={[]} />
    )

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
    // BoostButton mock renders null, but its parent div should not be in DOM
    expect(container.querySelector(".ml-auto")).toBeNull()
  })

  it("hides BoostButton when compound pubkey matches user pubKey_routeHint (contributor)", async () => {
    userStoreOverrides = { pubKey: "03abc", routeHint: "02xyz_123456", isAdmin: false }
    const compoundPubkey = "03abc_02xyz_123456"
    mockApiGet.mockResolvedValue(makeGraphData(nodeWithPubkey(compoundPubkey)))

    const { container } = render(
      <NodePreviewPanel node={nodeWithPubkey(compoundPubkey)} onBack={vi.fn()} schemas={[]} />
    )

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
    expect(container.querySelector(".ml-auto")).toBeNull()
  })

  it("hides BoostButton when isAdmin is true regardless of pubkey", async () => {
    userStoreOverrides = { pubKey: "03other", routeHint: "", isAdmin: true }
    mockApiGet.mockResolvedValue(makeGraphData(nodeWithPubkey("03abc")))

    const { container } = render(
      <NodePreviewPanel node={nodeWithPubkey("03abc")} onBack={vi.fn()} schemas={[]} />
    )

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
    expect(container.querySelector(".ml-auto")).toBeNull()
  })

  it("renders BoostButton wrapper when non-owner non-admin views a pubkey node", async () => {
    userStoreOverrides = { pubKey: "03other", routeHint: "", isAdmin: false }
    mockApiGet.mockResolvedValue(makeGraphData(nodeWithPubkey("03abc")))

    const { container } = render(
      <NodePreviewPanel node={nodeWithPubkey("03abc")} onBack={vi.fn()} schemas={[]} />
    )

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
    expect(container.querySelector(".ml-auto")).not.toBeNull()
  })
})

describe("NodePreviewPanel – core property rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
  })

  function makeUnlockedNode(extraProps: Record<string, unknown>): GraphNode {
    return {
      ref_id: "abc",
      node_type: "Topic",
      properties: { name: "Test Node", ...extraProps },
    }
  }

  it("shows 'Processing' badge when status is 'processing'", async () => {
    const node = makeUnlockedNode({ status: "processing" })
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByText("Processing")).toBeInTheDocument()
    })
  })

  it("does not show a status badge when status is 'completed'", async () => {
    const node = makeUnlockedNode({ status: "completed" })
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
    expect(screen.queryByText("Done")).toBeNull()
    expect(screen.queryByText("Processing")).toBeNull()
  })

  it("shows 'Paused' badge when status is 'halted'", async () => {
    const node = makeUnlockedNode({ status: "halted" })
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByText("Paused")).toBeInTheDocument()
    })
  })

  it("shows 'Failed' badge when status is 'error'", async () => {
    const node = makeUnlockedNode({ status: "error" })
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeInTheDocument()
    })
  })

  it("shows formatted date when date_added_to_graph is present", async () => {
    const node = makeUnlockedNode({ date_added_to_graph: "2025-04-18" })
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByText("Apr 18, 2025")).toBeInTheDocument()
    })
  })

  it("shows sats counter when boost is a positive number", async () => {
    const node = makeUnlockedNode({ boost: 50 })
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByText("50")).toBeInTheDocument()
      expect(screen.getByText("sats")).toBeInTheDocument()
    })
  })

  it("does not render core properties row when none of status/date/boost are present", async () => {
    const node = makeUnlockedNode({})
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
    expect(screen.queryByText("Processing")).toBeNull()
    expect(screen.queryByText("Done")).toBeNull()
    expect(screen.queryByText("Paused")).toBeNull()
    expect(screen.queryByText("Failed")).toBeNull()
    expect(screen.queryByText("sats")).toBeNull()
  })
})

describe("NodePreviewPanel – SummaryBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
  })

  function makeMediaNode(extraProps: Record<string, unknown>): GraphNode {
    return {
      ref_id: "media1",
      node_type: "Episode",
      properties: { name: "Media Node", media_url: "https://example.com/audio.mp3", ...extraProps },
    }
  }

  it("renders 'Summary' label and text above 'Transcript' for a media node with both", async () => {
    const node = makeMediaNode({ summary: "This is a summary.", transcript: "This is the transcript." })
    mockApiGet.mockResolvedValue({ nodes: [node], edges: [] })

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByText("Summary")).toBeInTheDocument()
      expect(screen.getByText("This is a summary.")).toBeInTheDocument()
      expect(screen.getByText("Transcript")).toBeInTheDocument()
    })

    // Assert Summary appears before Transcript in the DOM
    const summaryLabel = screen.getByText("Summary")
    const transcriptLabel = screen.getByText("Transcript")
    expect(
      summaryLabel.compareDocumentPosition(transcriptLabel) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("does not render SummaryBlock when media node has no summary", async () => {
    const node = makeMediaNode({ transcript: "Just a transcript." })
    mockApiGet.mockResolvedValue({ nodes: [node], edges: [] })

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByText("Transcript")).toBeInTheDocument()
    })
    expect(screen.queryByText("Summary")).toBeNull()
  })

  it("does not render SummaryBlock for a non-media node with summary", async () => {
    const node: GraphNode = {
      ref_id: "tweet1",
      node_type: "Tweet",
      properties: {
        name: "A tweet",
        tweet_id: "123",
        text: "tweet text",
        summary: "Should not appear",
      },
    }
    mockApiGet.mockResolvedValue({ nodes: [node], edges: [] })

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
    expect(screen.queryByText("Summary")).toBeNull()
  })

  it("truncates long summary at 300 chars and shows 'Show more' toggle", async () => {
    const longSummary = "A".repeat(350)
    const node = makeMediaNode({ summary: longSummary })
    mockApiGet.mockResolvedValue({ nodes: [node], edges: [] })

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByText("Summary")).toBeInTheDocument()
    })

    // Truncated text ends with ellipsis
    const summaryText = screen.getByText(/A+…/)
    expect(summaryText.textContent?.length).toBeLessThan(350)

    // Show more button present
    expect(screen.getByRole("button", { name: /show more/i })).toBeInTheDocument()
  })
})

describe("NodePreviewPanel – Stakwork project link", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
  })

  // The Stakwork link is shown based on props of the *initial* node (not fullNode),
  // so we set project_id and status on the node passed directly to the panel.
  function makeNodeWithProject(extraProps: Record<string, unknown>): GraphNode {
    return {
      ref_id: "abc",
      node_type: "Topic",
      properties: { name: "Test Node", ...extraProps },
    }
  }

  it("renders 'View on Stakwork' link for admin + project_id + halted status", async () => {
    userStoreOverrides = { pubKey: "03admin", routeHint: "", isAdmin: true }
    const node = makeNodeWithProject({ project_id: "555", status: "halted" })
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      const link = screen.getByRole("link", { name: /view on stakwork/i })
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute("href", "https://jobs.stakwork.com/admin/projects/555")
      expect(link).toHaveAttribute("target", "_blank")
    })
  })

  it("does not render 'View on Stakwork' for non-admin with project_id + error status", async () => {
    userStoreOverrides = { pubKey: "03user", routeHint: "", isAdmin: false }
    const node = makeNodeWithProject({ project_id: "555", status: "error" })
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
    expect(screen.queryByRole("link", { name: /view on stakwork/i })).toBeNull()
  })

  it("does not render 'View on Stakwork' for admin with no project_id", async () => {
    userStoreOverrides = { pubKey: "03admin", routeHint: "", isAdmin: true }
    const node = makeNodeWithProject({ status: "error" })
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
    expect(screen.queryByRole("link", { name: /view on stakwork/i })).toBeNull()
  })

  it.each(["in_progress", "processing", "halted", "error", "failed"])(
    "renders link for admin with status=%s",
    async (status) => {
      userStoreOverrides = { pubKey: "03admin", routeHint: "", isAdmin: true }
      const node = makeNodeWithProject({ project_id: "777", status })
      mockApiGet.mockResolvedValue(makeGraphData(node))

      const { unmount } = render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

      await waitFor(() => {
        const link = screen.getByRole("link", { name: /view on stakwork/i })
        expect(link).toBeInTheDocument()
        expect(link).toHaveAttribute("href", "https://jobs.stakwork.com/admin/projects/777")
      })

      unmount()
    }
  )
})

describe("NodePreviewPanel – paid_properties lock placeholders", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
    // 402 probe → preview state
    mockApiGet.mockRejectedValue(new Response(null, { status: 402 }))
    mockGetPrice.mockResolvedValue(10)
  })

  function makeSchemaNode(type: string, paid_properties?: string[]) {
    return {
      ref_id: `ref-${type}`,
      type,
      parent: "",
      color: "#888",
      node_key: "name",
      attributes: [],
      paid_properties,
    }
  }

  it("shows lock placeholder for single paid_property (claim_text)", async () => {
    const node: GraphNode = { ref_id: "c1", node_type: "Claim", properties: { name: "Claim Node" } }
    const schema = makeSchemaNode("Claim", ["claim_text"])

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[schema]} />)

    await waitFor(() => {
      expect(screen.getByText("claim_text")).toBeInTheDocument()
    })
    expect(screen.getByText("🔒")).toBeInTheDocument()
    // No generic skeletons when paid_properties is present
    expect(document.querySelectorAll("[data-slot='skeleton']").length).toBe(0)
  })

  it("shows two lock placeholders for Episode/Clip (media_url + transcript)", async () => {
    const node: GraphNode = { ref_id: "e1", node_type: "Episode", properties: { name: "Episode Node" } }
    const schema = makeSchemaNode("Episode", ["media_url", "transcript"])

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[schema]} />)

    await waitFor(() => {
      expect(screen.getByText("media_url")).toBeInTheDocument()
      expect(screen.getByText("transcript")).toBeInTheDocument()
    })
    const locks = screen.getAllByText("🔒")
    expect(locks).toHaveLength(2)
  })

  it("shows generic skeletons when schema has no paid_properties (no regression)", async () => {
    const node: GraphNode = { ref_id: "p1", node_type: "Person", properties: { name: "Person Node" } }
    const schema = makeSchemaNode("Person")

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[schema]} />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /unlock/i })).toBeInTheDocument()
    })
    expect(screen.queryByText("🔒")).toBeNull()
  })

  it("shows no lock placeholders when node is unlocked (no regression)", async () => {
    mockApiGet.mockResolvedValue({ nodes: [{ ref_id: "p2", node_type: "Person", properties: { name: "Person Node" } }], edges: [] })
    const node: GraphNode = { ref_id: "p2", node_type: "Person", properties: { name: "Person Node" } }
    const schema = makeSchemaNode("Person")

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[schema]} />)

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
    expect(screen.queryByText("🔒")).toBeNull()
  })
})
