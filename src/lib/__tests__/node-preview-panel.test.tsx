import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import React from "react"

// --- mock isSphinx ---
const { mockIsSphinx } = vi.hoisted(() => ({ mockIsSphinx: vi.fn(() => false) }))
vi.mock("@/lib/sphinx/detect", () => ({
  isSphinx: () => mockIsSphinx(),
  isAndroid: vi.fn(() => false),
}))

// --- mock getL402 ---
const { mockGetL402 } = vi.hoisted(() => ({ mockGetL402: vi.fn(() => "") }))
vi.mock("@/lib/sphinx/bridge", () => ({
  getL402: () => mockGetL402(),
  hasWebLN: vi.fn(),
  payInvoice: vi.fn(),
  enable: vi.fn(),
  getSignedMessage: vi.fn(),
}))

// --- mock api (hoisted so vi.mock can reference it) ---
const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }))
vi.mock("@/lib/api", () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}))

// --- mock graph-api deep research helpers ---
const { mockTriggerDeepResearch, mockGetLatestStakworkRun } = vi.hoisted(() => ({
  mockTriggerDeepResearch: vi.fn(),
  mockGetLatestStakworkRun: vi.fn(),
}))
vi.mock("@/lib/graph-api", () => ({
  triggerDeepResearch: (...args: unknown[]) => mockTriggerDeepResearch(...args),
  getLatestStakworkRun: (...args: unknown[]) => mockGetLatestStakworkRun(...args),
}))

vi.mock("@/lib/sphinx/payment", () => ({
  payL402: vi.fn().mockResolvedValue(undefined),
}))

// Also mock the barrel re-export used by the component
vi.mock("@/lib/sphinx", () => ({
  payL402: vi.fn().mockResolvedValue(undefined),
}))

// --- mock-data: disable mocks so real api path is exercised ---
vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => false,
  MOCK_FULL_NODES: {},
}))

// --- mock unlockNode ---
const { mockUnlockNode } = vi.hoisted(() => ({ mockUnlockNode: vi.fn() }))
vi.mock("@/lib/unlock-node", () => ({
  unlockNode: (...args: unknown[]) => mockUnlockNode(...args),
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
const mockOpenEdit = vi.fn()
vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel: (s: { open: typeof mockOpen; openEdit: typeof mockOpenEdit }) => unknown) =>
    sel({ open: mockOpen, openEdit: mockOpenEdit }),
}))

import type { GraphNode as GN, GraphEdge as GE } from "@/lib/graph-api"

let mockGraphNodes: GN[] = []
let mockGraphEdges: GE[] = []

vi.mock("@/stores/graph-store", () => ({
  useGraphStore: Object.assign(
    (sel: (s: { nodes: GN[]; edges: GE[]; addNodes: () => void }) => unknown) =>
      sel({ nodes: mockGraphNodes, edges: mockGraphEdges, addNodes: vi.fn() }),
    { getState: () => ({ addNodes: vi.fn() }) },
  ),
}))

type PlayerStoreState = { isPlaying: boolean; playingNode: { ref_id: string } | null; setPlayingNode: () => void; setIsPlaying: () => void }
let playerStoreOverrides: Partial<PlayerStoreState> = {}

vi.mock("@/stores/player-store", () => ({
  usePlayerStore: (sel: (s: PlayerStoreState) => unknown) =>
    sel({ isPlaying: false, playingNode: null, setPlayingNode: vi.fn(), setIsPlaying: vi.fn(), ...playerStoreOverrides }),
}))

// --- schema icons ---
vi.mock("@/lib/schema-icons", () => ({
  getSchemaIconInfo: () => ({ icon: () => null, accent: "#888" }),
}))

// --- boost button ---
vi.mock("@/components/boost/boost-button", () => ({
  BoostButton: () => <div data-testid="boost-button" />,
}))

// --- mock watch-api ---
const mockGetWatches = vi.fn().mockResolvedValue({ nodes: [], types: [] })
const mockWatchNode = vi.fn().mockResolvedValue(undefined)
const mockUnwatchNode = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/watch-api", () => ({
  getWatches: (...args: unknown[]) => mockGetWatches(...args),
  watchNode: (...args: unknown[]) => mockWatchNode(...args),
  unwatchNode: (...args: unknown[]) => mockUnwatchNode(...args),
}))

// --- mock cookie-storage ---
let mockL402Cookie = ""
vi.mock("@/lib/cookie-storage", () => ({
  cookieStorage: {
    getItem: (key: string) => (key === "l402" ? mockL402Cookie : ""),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
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

// jsdom doesn't implement Element.prototype.scrollTo — stub it so navigation
// tests that trigger handleNavigate don't throw uncaught exceptions.
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = () => undefined
}

// Reset graph store mocks before each test so history navigation tests don't bleed
beforeEach(() => {
  mockGraphNodes = []
  mockGraphEdges = []
  // Default: no prior deep-research run (null = no run found)
  mockGetLatestStakworkRun.mockResolvedValue(null)
})

describe("NodePreviewPanel – Connections section smoke test", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
    // Resolve the probe immediately so unlocked state is reached
    mockApiGet.mockResolvedValue(makeGraphData(BASE_NODE))
  })

  it("renders the Connections heading for any node", async () => {
    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() => {
      expect(screen.getByText("Connections")).toBeInTheDocument()
    })
  })

  it("shows 'No connections' empty state when store has no edges for this node", async () => {
    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() => {
      expect(screen.getByText("No connections")).toBeInTheDocument()
    })
  })
})

describe("NodePreviewPanel – price display", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
  })

  it("renders 'Unlock for 10 bullets' when 402 body has price: 10", async () => {
    mockApiGet.mockRejectedValue(
      new Response(JSON.stringify({ price: 10 }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      })
    )

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unlock for 10 bullets/i })).toBeInTheDocument()
    })
  })

  it("renders 'Unlock Full Content' when 402 body has price: 0", async () => {
    mockApiGet.mockRejectedValue(
      new Response(JSON.stringify({ price: 0 }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      })
    )

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unlock Full Content/i })).toBeInTheDocument()
    })
  })

  it("renders unlocked content directly when probe returns 200 (admin/owner)", async () => {
    const unlockedNode: GraphNode = {
      ref_id: "abc",
      node_type: "Topic",
      // Use a field not in INTERNAL_FIELDS so it falls through to remainingProps rendering
      properties: { name: "Test Node", custom_field: "Full article text here" },
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
    mockApiGet.mockRejectedValue(
      new Response(JSON.stringify({ price: 10 }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      })
    )

    const { rerender } = render(
      <NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unlock for 10 bullets/i })).toBeInTheDocument()
    })

    // Switch to second node with price = 25
    mockApiGet.mockRejectedValue(
      new Response(JSON.stringify({ price: 25 }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      })
    )

    rerender(<NodePreviewPanel node={NODE_B} onBack={vi.fn()} schemas={[]} />)

    // Stale price from first node should be gone
    expect(screen.queryByRole("button", { name: /Unlock for 10 bullets/i })).toBeNull()

    // After second node's 402 resolves, new price appears
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unlock for 25 bullets/i })).toBeInTheDocument()
    })
  })
})

describe("NodePreviewPanel – boost visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
  })

  const nodeWithOwner = (ownerReferenceId: string): GraphNode => ({
    ref_id: "abc",
    node_type: "Topic",
    properties: { name: "Test Node", owner_reference_id: ownerReferenceId },
  })

  // Note: phase-4b moves self-boost detection server-side. The frontend no
  // longer hides BoostButton when the viewer matches the contributor — /boost
  // returns SELF_BOOST instead. Tests below cover the remaining client gates.

  it("hides BoostButton when isAdmin is true", async () => {
    userStoreOverrides = { pubKey: "03other", routeHint: "", isAdmin: true }
    const node = nodeWithOwner("lsat:11111111-1111-1111-1111-111111111111")
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(
      <NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />
    )

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
    expect(screen.queryByTestId("boost-button")).toBeNull()
  })

  it("renders BoostButton wrapper when node has owner_reference_id and viewer is not admin", async () => {
    userStoreOverrides = { pubKey: "03other", routeHint: "", isAdmin: false }
    const node = nodeWithOwner("lsat:11111111-1111-1111-1111-111111111111")
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(
      <NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />
    )

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
    expect(screen.queryByTestId("boost-button")).not.toBeNull()
  })

  it("does not render BoostButton wrapper when node has no owner_reference_id", async () => {
    userStoreOverrides = { pubKey: "03other", routeHint: "", isAdmin: false }
    const node: GraphNode = { ref_id: "abc", node_type: "Topic", properties: { name: "Test Node" } }
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(
      <NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />
    )

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
    expect(screen.queryByTestId("boost-button")).toBeNull()
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

  it("shows publish date when date property is present", () => {
    const node: GraphNode = {
      ...BASE_NODE,
      properties: { ...BASE_NODE.properties, date: 1745020800 },
    }
    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)
    expect(screen.getByText(/ago/i)).toBeInTheDocument()
  })

  it("shows no date when neither date nor published_date is present", () => {
    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)
    expect(screen.queryByText(/ago/i)).not.toBeInTheDocument()
  })

  it("shows bullets counter when boost is a positive number", async () => {
    const node = makeUnlockedNode({ boost: 50 })
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByText("50")).toBeInTheDocument()
      expect(screen.getByText("bullets")).toBeInTheDocument()
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
    expect(screen.queryByText("bullets")).toBeNull()
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
    const node = makeNodeWithProject({ project_id: 555, status: "halted" })
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      const link = screen.getByRole("link", { name: /view on stakwork/i })
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute("href", "https://jobs.stakwork.com/admin/projects/555")
      expect(link).toHaveAttribute("target", "_blank")
    })
  })

  it("renders 'View on Stakwork' link for admin + project_id + completed status", async () => {
    userStoreOverrides = { pubKey: "03admin", routeHint: "", isAdmin: true }
    const node = makeNodeWithProject({ project_id: 999, status: "completed" })
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      const link = screen.getByRole("link", { name: /view on stakwork/i })
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute("href", "https://jobs.stakwork.com/admin/projects/999")
      expect(link).toHaveAttribute("target", "_blank")
    })
  })

  it("does not render 'View on Stakwork' for non-admin with project_id + completed status", async () => {
    userStoreOverrides = { pubKey: "03user", routeHint: "", isAdmin: false }
    const node = makeNodeWithProject({ project_id: 999, status: "completed" })
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
    expect(screen.queryByRole("link", { name: /view on stakwork/i })).toBeNull()
  })

  it("does not render 'View on Stakwork' for non-admin with project_id + error status", async () => {
    userStoreOverrides = { pubKey: "03user", routeHint: "", isAdmin: false }
    const node = makeNodeWithProject({ project_id: 555, status: "error" })
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

  it.each(["in_progress", "processing", "halted", "error", "failed", "completed"])(
    "renders link for admin with status=%s",
    async (status) => {
      userStoreOverrides = { pubKey: "03admin", routeHint: "", isAdmin: true }
      const node = makeNodeWithProject({ project_id: 777, status })
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

describe("NodePreviewPanel – preview=1 probe behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
  })

  it("includes ?preview=1 in probe URL and no Authorization override when L402 exists", async () => {
    mockGetL402.mockReturnValue("LSAT abc123:def456")
    mockApiGet.mockResolvedValue(makeGraphData(BASE_NODE))

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        "/v2/nodes/abc?preview=1",
        undefined,
        expect.any(AbortSignal),
      )
    })
  })

  it("includes ?preview=1 in probe URL when no L402 token is present", async () => {
    mockGetL402.mockReturnValue("")
    mockApiGet.mockResolvedValue(makeGraphData(BASE_NODE))

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        "/v2/nodes/abc?preview=1",
        undefined,
        expect.any(AbortSignal),
      )
    })
  })

  it("sets unlockState to 'unlocked' and hides Unlock button when probe returns 200", async () => {
    mockApiGet.mockResolvedValue(makeGraphData(BASE_NODE))

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
  })

  it("sets unlockState to 'preview' and shows Unlock button when probe returns 402", async () => {
    mockApiGet.mockRejectedValue(
      new Response(JSON.stringify({ price: 15 }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      })
    )

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unlock for 15 bullets/i })).toBeInTheDocument()
    })
  })

  it("handleUnlock calls unlockNode with the correct refId", async () => {
    // First probe returns 402 so Unlock button appears
    mockApiGet.mockRejectedValue(
      new Response(JSON.stringify({ price: 5 }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      })
    )
    mockUnlockNode.mockResolvedValue(BASE_NODE)

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unlock for 5 bullets/i })).toBeInTheDocument()
    })

    screen.getByRole("button", { name: /Unlock for 5 bullets/i }).click()

    await waitFor(() => {
      expect(mockUnlockNode).toHaveBeenCalledWith("abc")
    })
  })

  it("handleUnlock sets fullNode from unlockNode return value", async () => {
    mockApiGet.mockRejectedValue(
      new Response(JSON.stringify({ price: 5 }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      })
    )
    const unlockedNode: GraphNode = { ref_id: "abc", node_type: "Topic", properties: { name: "Unlocked!" } }
    mockUnlockNode.mockResolvedValue(unlockedNode)

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unlock for 5 bullets/i })).toBeInTheDocument()
    })

    screen.getByRole("button", { name: /Unlock for 5 bullets/i }).click()

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    })
  })

  it("handleUnlock opens budget modal on 402 after payL402 fails", async () => {
    // probe returns 402
    mockApiGet.mockRejectedValue(
      new Response(JSON.stringify({ price: 10 }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      })
    )
    // unlockNode throws 402 (simulates payL402 path failing)
    mockUnlockNode.mockRejectedValue(new Response(null, { status: 402 }))

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Unlock for 10 bullets/i })).toBeInTheDocument()
    })

    screen.getByRole("button", { name: /Unlock for 10 bullets/i }).click()

    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalledWith("budget")
    })
  })
})

describe("NodePreviewPanel – paid_properties lock placeholders", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
    // 402 probe → preview state
    mockApiGet.mockRejectedValue(
      new Response(JSON.stringify({ price: 10 }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      })
    )
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

describe("NodePreviewPanel – View Source / web page link", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
  })

  it("renders 'View Source' link for a web page node with a plain link URL", async () => {
    const node: GraphNode = {
      ref_id: "n9",
      node_type: "WebPage",
      properties: { name: "Sphinx Chat Website", description: "Decentralised messaging on Lightning." },
    }
    const fullNode: GraphNode = {
      ...node,
      properties: { ...node.properties, link: "https://sphinx.chat" },
    }
    mockApiGet.mockResolvedValue({ nodes: [fullNode], edges: [] })

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByText("View Source")).toBeInTheDocument()
    })
    const link = screen.getByRole("link", { name: /view source/i })
    expect(link).toHaveAttribute("href", "https://sphinx.chat")
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("does not render 'View Source' for an audio node with a media link URL", async () => {
    const node: GraphNode = {
      ref_id: "a1",
      node_type: "Episode",
      properties: { name: "Audio Episode" },
    }
    const fullNode: GraphNode = {
      ...node,
      properties: { ...node.properties, link: "https://example.com/audio.mp3" },
    }
    mockApiGet.mockResolvedValue({ nodes: [fullNode], edges: [] })

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByText("Play Audio")).toBeInTheDocument()
    })
    expect(screen.queryByText("View Source")).toBeNull()
  })

  it("renders player and no View Source for a node with media_url", async () => {
    const node: GraphNode = {
      ref_id: "m1",
      node_type: "Episode",
      properties: { name: "Media Node" },
    }
    const fullNode: GraphNode = {
      ...node,
      properties: { ...node.properties, media_url: "https://example.com/episode.mp3" },
    }
    mockApiGet.mockResolvedValue({ nodes: [fullNode], edges: [] })

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.getByText("Play Audio")).toBeInTheDocument()
    })
    expect(screen.queryByText("View Source")).toBeNull()
  })
})

describe("NodePreviewPanel – share button", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
    // 402 probe so panel renders in preview state (not blocking share button)
    mockApiGet.mockRejectedValue(
      new Response(JSON.stringify({ price: 10 }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      })
    )
    // Mock clipboard
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    })
    Object.defineProperty(window, "location", {
      value: { origin: "https://example.com" },
      writable: true,
      configurable: true,
    })
  })

  it("renders the ⋯ more-actions button in the panel header", async () => {
    const node: GraphNode = { ref_id: "share-node-1", node_type: "Topic", properties: { name: "Share Test" } }
    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)
    const btn = document.querySelector("button[title='More actions']")
    expect(btn).toBeTruthy()
  })

  it("copies the correct URL to clipboard when 'Copy link' is clicked in the menu", async () => {
    const { fireEvent } = await import("@testing-library/react")
    const node: GraphNode = { ref_id: "share-node-2", node_type: "Topic", properties: { name: "Share Test" } }
    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)
    const trigger = document.querySelector("button[title='More actions']") as HTMLElement
    expect(trigger).toBeTruthy()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByText("Copy link"))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://example.com/?id=share-node-2")
  })

  it("shows 'Copied!' on the trigger after copying and resets after 2s", async () => {
    vi.useFakeTimers()
    const { fireEvent, act } = await import("@testing-library/react")
    const node: GraphNode = { ref_id: "share-node-3", node_type: "Topic", properties: { name: "Share Test" } }
    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)
    const trigger = document.querySelector("button[title='More actions']") as HTMLElement
    fireEvent.click(trigger)
    await act(async () => { fireEvent.click(screen.getByText("Copy link")) })
    expect(screen.getByText("Copied!")).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.queryByText("Copied!")).toBeNull()
    vi.useRealTimers()
  })

  describe("inside Sphinx (isSphinx() === true)", () => {
    beforeEach(() => {
      mockIsSphinx.mockReturnValue(true)
    })
    afterEach(() => {
      mockIsSphinx.mockReturnValue(false)
    })

    it("renders both 'Copy link' and 'Copy Sphinx link' in the ⋯ dropdown", async () => {
      const { fireEvent } = await import("@testing-library/react")
      const node: GraphNode = { ref_id: "sphinx-node-1", node_type: "Topic", properties: { name: "Sphinx Test" } }
      render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)
      const trigger = document.querySelector("button[title='More actions']")
      expect(trigger).toBeTruthy()
      // Open the dropdown
      fireEvent.click(trigger as HTMLElement)
      expect(screen.getByText("Copy link")).toBeInTheDocument()
      expect(screen.getByText("Copy Sphinx link")).toBeInTheDocument()
    })

    it("'Copy link' writes the web URL to clipboard", async () => {
      const { fireEvent } = await import("@testing-library/react")
      const node: GraphNode = { ref_id: "sphinx-node-2", node_type: "Topic", properties: { name: "Sphinx Test" } }
      render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)
      const trigger = document.querySelector("button[title='More actions']") as HTMLElement
      fireEvent.click(trigger)
      fireEvent.click(screen.getByText("Copy link"))
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://example.com/?id=sphinx-node-2")
    })

    it("'Copy Sphinx link' writes the sphinx.chat deep link to clipboard", async () => {
      const { fireEvent } = await import("@testing-library/react")
      const node: GraphNode = { ref_id: "sphinx-node-3", node_type: "Topic", properties: { name: "Sphinx Test" } }
      render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)
      const trigger = document.querySelector("button[title='More actions']") as HTMLElement
      fireEvent.click(trigger)
      fireEvent.click(screen.getByText("Copy Sphinx link"))
      const expectedWebUrl = "https://example.com/?id=sphinx-node-3"
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `sphinx.chat://?action=webapp&url=${encodeURIComponent(expectedWebUrl)}`
      )
    })
  })
})

describe("NodePreviewPanel – description truncation cap", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
  })

  it("renders full claim_text without truncation when between 160–500 chars (unlocked)", async () => {
    const claimText =
      "The Lightning Network allows Bitcoin transactions to settle instantly off-chain by routing payments through a network of bidirectional payment channels. " +
      "This is achieved by locking funds into a 2-of-2 multisig address on-chain and exchanging signed commitment transactions off-chain."
    // Verify the text is between 160 and 500 chars
    expect(claimText.length).toBeGreaterThan(160)
    expect(claimText.length).toBeLessThanOrEqual(500)

    const claimNode: GraphNode = {
      ref_id: "cl1",
      node_type: "Claim",
      properties: { name: "Lightning claim", claim_text: claimText },
    }
    // Probe returns 200 → unlocked state; fullNode carries claim_text
    mockApiGet.mockResolvedValue(makeGraphData(claimNode))

    // Provide a schema that designates claim_text as the description_key
    const schema = {
      ref_id: "schema-claim",
      node_type: "SchemaNode",
      properties: {
        schema_node_type: "Claim",
        title_key: "name",
        description_key: "claim_text",
        attributes: [],
      },
    }

    render(<NodePreviewPanel node={claimNode} onBack={vi.fn()} schemas={[schema as never]} />)

    await waitFor(() => {
      // Full text should be present — no ellipsis appended
      expect(screen.getByText(claimText)).toBeInTheDocument()
    })
  })

  it("caps description at 500 chars and appends ellipsis when text exceeds 500 chars", async () => {
    const longDesc = "B".repeat(600)
    const node: GraphNode = {
      ref_id: "d1",
      node_type: "Topic",
      properties: { name: "Long Desc Node", description: longDesc },
    }
    mockApiGet.mockResolvedValue(makeGraphData(node))

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      const el = document.querySelector("p.text-xs.text-muted-foreground")
      expect(el).toBeTruthy()
      expect(el!.textContent).toBe("B".repeat(500) + "\u2026")
    })
  })
})

describe("NodePreviewPanel – WatchButton", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
    mockL402Cookie = ""
    mockGetWatches.mockResolvedValue({ nodes: [], types: [] })
    mockWatchNode.mockResolvedValue(undefined)
    mockUnwatchNode.mockResolvedValue(undefined)
    // Default: probe resolves with a full node
    mockApiGet.mockResolvedValue(makeGraphData(BASE_NODE))
  })

  it("does NOT render Watch item in dropdown when user has no identity", async () => {
    const { fireEvent: fe } = await import("@testing-library/react")
    userStoreOverrides = { pubKey: "", isAdmin: false }
    mockL402Cookie = ""
    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() => screen.getByText("Connections"))
    // Open the ⋯ menu
    const trigger = document.querySelector("button[title='More actions']") as HTMLElement
    fe.click(trigger)
    expect(screen.queryByText("Watch")).toBeNull()
    expect(screen.queryByText("Unwatch")).toBeNull()
  })

  it("renders Watch item in dropdown when user has pubKey and node is not watched", async () => {
    const { fireEvent: fe } = await import("@testing-library/react")
    userStoreOverrides = { pubKey: "03testkey", isAdmin: false }
    mockGetWatches.mockResolvedValue({ nodes: [], types: [] })

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() => screen.getByText("Test Node"))

    const trigger = document.querySelector("button[title='More actions']") as HTMLElement
    fe.click(trigger)
    await waitFor(() => expect(screen.getByText("Watch")).toBeInTheDocument())
  })

  it("renders Unwatch item in dropdown when node is in watches list", async () => {
    const { fireEvent: fe } = await import("@testing-library/react")
    userStoreOverrides = { pubKey: "03testkey", isAdmin: false }
    mockGetWatches.mockResolvedValue({
      nodes: [{ ref_id: BASE_NODE.ref_id, node_type: "Topic", title: "Test Node" }],
      types: [],
    })

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() => screen.getByText("Test Node"))

    const trigger = document.querySelector("button[title='More actions']") as HTMLElement
    fe.click(trigger)
    await waitFor(() => expect(screen.getByText("Unwatch")).toBeInTheDocument())
  })

  it("renders Watch item in dropdown when user has L402 token (no pubKey)", async () => {
    const { fireEvent: fe } = await import("@testing-library/react")
    userStoreOverrides = { pubKey: "", isAdmin: false }
    mockL402Cookie = "some-l402-token"
    mockGetWatches.mockResolvedValue({ nodes: [], types: [] })

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() => screen.getByText("Test Node"))

    const trigger = document.querySelector("button[title='More actions']") as HTMLElement
    fe.click(trigger)
    await waitFor(() => expect(screen.getByText("Watch")).toBeInTheDocument())
  })

  it("calls watchNode on click when not watched", async () => {
    const { fireEvent: fe } = await import("@testing-library/react")
    userStoreOverrides = { pubKey: "03testkey", isAdmin: false }
    mockGetWatches.mockResolvedValue({ nodes: [], types: [] })

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() => screen.getByText("Test Node"))

    const trigger = document.querySelector("button[title='More actions']") as HTMLElement
    fe.click(trigger)
    const watchItem = await waitFor(() => screen.getByText("Watch"))
    fe.click(watchItem)

    await waitFor(() => {
      expect(mockWatchNode).toHaveBeenCalledWith(BASE_NODE.ref_id)
    })
  })

  it("calls unwatchNode on click when already watched", async () => {
    const { fireEvent: fe } = await import("@testing-library/react")
    userStoreOverrides = { pubKey: "03testkey", isAdmin: false }
    mockGetWatches.mockResolvedValue({
      nodes: [{ ref_id: BASE_NODE.ref_id, node_type: "Topic", title: "Test Node" }],
      types: [],
    })

    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() => screen.getByText("Test Node"))

    const trigger = document.querySelector("button[title='More actions']") as HTMLElement
    fe.click(trigger)
    const unwatchItem = await waitFor(() => screen.getByText("Unwatch"))
    fe.click(unwatchItem)

    await waitFor(() => {
      expect(mockUnwatchNode).toHaveBeenCalledWith(BASE_NODE.ref_id)
    })
  })

  it("does not render is_ad in the fallback key/value list for Chapter nodes", async () => {
    const chapterNode: GraphNode = {
      ref_id: "chap1",
      node_type: "Chapter",
      properties: {
        name: "Intro Chapter",
        timestamp: 120,
        description: "A chapter description",
        is_ad: true,
      },
    }
    mockApiGet.mockResolvedValue(makeGraphData(chapterNode))

    render(<NodePreviewPanel node={chapterNode} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      expect(screen.queryByText("is_ad")).toBeNull()
    })
    // Other properties should still render
    expect(screen.queryByText("is_ad")).toBeNull()
  })
})

describe("NodePreviewPanel – MediaCard host div marginBottom", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
    playerStoreOverrides = {}
  })

  afterEach(() => {
    playerStoreOverrides = {}
  })

  it("reserves at least 52px marginBottom on the host div when the node is actively playing", async () => {
    const node: GraphNode = {
      ref_id: "media-playing-1",
      node_type: "Episode",
      properties: { name: "Playing Episode", media_url: "https://example.com/episode.mp3" },
    }
    mockApiGet.mockResolvedValue({ nodes: [node], edges: [] })
    // Simulate the node being the currently playing node
    playerStoreOverrides = { playingNode: { ref_id: node.ref_id } }

    render(<NodePreviewPanel node={node} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => {
      // When playing, the host div replaces the Play button — Play Audio should be absent
      expect(screen.queryByText("Play Audio")).toBeNull()
    })

    // Find the host div: it has the marginBottom style set
    const hostDiv = document.querySelector<HTMLElement>("[style*='margin-bottom']")
    expect(hostDiv).not.toBeNull()
    const marginBottom = parseInt(hostDiv!.style.marginBottom, 10)
    expect(marginBottom).toBeGreaterThanOrEqual(52)
  })
})

describe("NodePreviewPanel – history navigation", () => {
  const PEER_NODE: GraphNode = {
    ref_id: "peer1",
    node_type: "Topic",
    properties: { name: "Peer Node" },
  }

  const EDGE_TO_PEER = { source: BASE_NODE.ref_id, target: PEER_NODE.ref_id, edge_type: "MENTIONS" }

  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
    mockGraphNodes = [BASE_NODE, PEER_NODE]
    mockGraphEdges = [EDGE_TO_PEER]
    // Probe always resolves with full node
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes(PEER_NODE.ref_id)) return Promise.resolve(makeGraphData(PEER_NODE))
      return Promise.resolve(makeGraphData(BASE_NODE))
    })
  })

  it("clicking a connection row updates the panel to display the peer node title", async () => {
    const { fireEvent: fe } = await import("@testing-library/react")
    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    // Wait for unlocked state to render
    await waitFor(() => expect(screen.getByText("Test Node")).toBeInTheDocument())

    // Click the connection row for Peer Node
    const row = await waitFor(() => screen.getByText("Peer Node").closest("button"))
    fe.click(row!)

    // Panel should now show the peer node title
    await waitFor(() => expect(screen.getByText("Peer Node")).toBeInTheDocument())
  })

  it("Back button with non-empty history returns to the previous node title", async () => {
    const { fireEvent: fe } = await import("@testing-library/react")
    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => expect(screen.getByText("Test Node")).toBeInTheDocument())

    // Navigate to peer
    const row = await waitFor(() => screen.getByText("Peer Node").closest("button"))
    fe.click(row!)
    await waitFor(() => expect(screen.getByText("Peer Node")).toBeInTheDocument())

    // Press back — should go back to base node
    fe.click(screen.getByRole("button", { name: (_, el) => el?.querySelector("svg") !== null && el?.title !== "More actions" && el?.title !== "Close panel" && el?.title !== "Deep Research this topic" }))
    // Use ArrowLeft button (first button in header)
    const backBtn = document.querySelector('[class*="flex h-full"] button:first-child') as HTMLElement
    fe.click(backBtn!)

    await waitFor(() => expect(screen.getByText("Test Node")).toBeInTheDocument())
  })

  it("Back button (←) with empty history calls onBack", async () => {
    const { fireEvent: fe } = await import("@testing-library/react")
    const onBack = vi.fn()
    render(<NodePreviewPanel node={BASE_NODE} onBack={onBack} schemas={[]} />)

    await waitFor(() => expect(screen.getByText("Test Node")).toBeInTheDocument())

    // Find and click the ArrowLeft button (first button in header)
    const buttons = document.querySelectorAll("button")
    const backBtn = Array.from(buttons).find(
      (b) => b.querySelector("svg") && b.className.includes("text-muted-foreground") && !b.title
    )
    fe.click(backBtn!)

    expect(onBack).toHaveBeenCalled()
  })

  it("✕ close button always calls onBack regardless of history depth", async () => {
    const { fireEvent: fe } = await import("@testing-library/react")
    const onBack = vi.fn()
    render(<NodePreviewPanel node={BASE_NODE} onBack={onBack} schemas={[]} />)

    await waitFor(() => expect(screen.getByText("Test Node")).toBeInTheDocument())

    // Navigate to peer to build history
    const row = await waitFor(() => screen.getByText("Peer Node").closest("button"))
    fe.click(row!)
    await waitFor(() => expect(screen.getByText("Peer Node")).toBeInTheDocument())

    // Click the ✕ close button
    const closeBtn = screen.getByTitle("Close panel")
    fe.click(closeBtn)

    expect(onBack).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Pencil edit button — admin visibility
// ---------------------------------------------------------------------------
describe("NodePreviewPanel – pencil edit button", () => {
  beforeEach(() => {
    mockOpenEdit.mockReset()
    mockApiGet.mockResolvedValue({})
  })

  it("renders 'Edit node' menu item for admin users", async () => {
    const { fireEvent: fe } = await import("@testing-library/react")
    userStoreOverrides = { pubKey: "03admin", routeHint: "", isAdmin: true }
    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => expect(screen.getByText("Test Node")).toBeInTheDocument())

    // Open the ⋯ menu
    const trigger = document.querySelector("button[title='More actions']") as HTMLElement
    fe.click(trigger)
    await waitFor(() => expect(screen.getByText("Edit node")).toBeInTheDocument())
  })

  it("does not render 'Edit node' menu item for non-admin users", async () => {
    const { fireEvent: fe } = await import("@testing-library/react")
    userStoreOverrides = { pubKey: "03user", routeHint: "", isAdmin: false }
    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => expect(screen.getByText("Test Node")).toBeInTheDocument())

    // Open the ⋯ menu
    const trigger = document.querySelector("button[title='More actions']") as HTMLElement
    fe.click(trigger)
    expect(screen.queryByText("Edit node")).toBeNull()
  })

  it("calls openEdit with the current node when 'Edit node' is clicked", async () => {
    const { fireEvent: fe } = await import("@testing-library/react")
    userStoreOverrides = { pubKey: "03admin", routeHint: "", isAdmin: true }
    render(<NodePreviewPanel node={BASE_NODE} onBack={vi.fn()} schemas={[]} />)

    await waitFor(() => expect(screen.getByText("Test Node")).toBeInTheDocument())

    const trigger = document.querySelector("button[title='More actions']") as HTMLElement
    fe.click(trigger)
    const editItem = await waitFor(() => screen.getByText("Edit node"))
    fe.click(editItem)

    expect(mockOpenEdit).toHaveBeenCalledOnce()
    expect(mockOpenEdit).toHaveBeenCalledWith(
      expect.objectContaining({ ref_id: BASE_NODE.ref_id })
    )
  })
})

// ---------------------------------------------------------------------------
// Deep Research button — eligibility, states, polling, refetch
// ---------------------------------------------------------------------------
describe("NodePreviewPanel – Deep Research button", () => {
  const TOPIC_NODE: GraphNode = {
    ref_id: "topic-dr",
    node_type: "Topic",
    properties: { name: "GraphRAG" },
  }
  const NON_TOPIC_NODE: GraphNode = {
    ref_id: "ep-dr",
    node_type: "Episode",
    properties: { name: "Some Episode", media_url: "https://example.com/a.mp3" },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    userStoreOverrides = {}
    mockApiGet.mockResolvedValue(makeGraphData(TOPIC_NODE))
    mockGetLatestStakworkRun.mockResolvedValue(null)
    mockTriggerDeepResearch.mockResolvedValue({ stakwork_run_ref_id: "mock-run-topic-dr" })
  })

  it("renders Deep Research button for Topic nodes", async () => {
    render(<NodePreviewPanel node={TOPIC_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() => expect(screen.getByTestId("deep-research-button")).toBeInTheDocument())
    expect(screen.getByTestId("deep-research-button")).toHaveTextContent("Deep Research")
  })

  it("does NOT render Deep Research button for non-Topic nodes", async () => {
    mockApiGet.mockResolvedValue(makeGraphData(NON_TOPIC_NODE))
    render(<NodePreviewPanel node={NON_TOPIC_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() => expect(screen.getByText("Some Episode")).toBeInTheDocument())
    expect(screen.queryByTestId("deep-research-button")).toBeNull()
  })

  it("shows 'Researching…' and is disabled when status is PENDING after click", async () => {
    render(<NodePreviewPanel node={TOPIC_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() => expect(screen.getByTestId("deep-research-button")).toBeInTheDocument())

    screen.getByTestId("deep-research-button").click()

    await waitFor(() => {
      expect(screen.getByTestId("deep-research-button")).toHaveTextContent("Researching…")
      expect(screen.getByTestId("deep-research-button")).toBeDisabled()
    })
  })

  it("shows 'Re-run Research' when prior run status is COMPLETED", async () => {
    mockGetLatestStakworkRun.mockResolvedValue({
      ref_id: "dr-run-1",
      job_type: "deep_research",
      status: "COMPLETED",
      created_at: Math.floor(Date.now() / 1000),
    })
    render(<NodePreviewPanel node={TOPIC_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() =>
      expect(screen.getByTestId("deep-research-button")).toHaveTextContent("Re-run Research")
    )
    expect(screen.getByTestId("deep-research-button")).not.toBeDisabled()
  })

  it("shows 'Retry Research' when prior run status is FAILED", async () => {
    mockGetLatestStakworkRun.mockResolvedValue({
      ref_id: "dr-run-2",
      job_type: "deep_research",
      status: "FAILED",
      created_at: Math.floor(Date.now() / 1000),
    })
    render(<NodePreviewPanel node={TOPIC_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() =>
      expect(screen.getByTestId("deep-research-button")).toHaveTextContent("Retry Research")
    )
    expect(screen.getByTestId("deep-research-button")).not.toBeDisabled()
  })

  it("shows 'Retry Research' when prior run status is HALTED", async () => {
    mockGetLatestStakworkRun.mockResolvedValue({
      ref_id: "dr-run-3",
      job_type: "deep_research",
      status: "HALTED",
      created_at: Math.floor(Date.now() / 1000),
    })
    render(<NodePreviewPanel node={TOPIC_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() =>
      expect(screen.getByTestId("deep-research-button")).toHaveTextContent("Retry Research")
    )
  })

  it("shows 'Researching…' disabled when prior run status is RUNNING", async () => {
    mockGetLatestStakworkRun.mockResolvedValue({
      ref_id: "dr-run-4",
      job_type: "deep_research",
      status: "RUNNING",
      created_at: Math.floor(Date.now() / 1000),
    })
    render(<NodePreviewPanel node={TOPIC_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() =>
      expect(screen.getByTestId("deep-research-button")).toHaveTextContent("Researching…")
    )
    expect(screen.getByTestId("deep-research-button")).toBeDisabled()
  })

  it("calls triggerDeepResearch on button click and optimistically sets PENDING", async () => {
    render(<NodePreviewPanel node={TOPIC_NODE} onBack={vi.fn()} schemas={[]} />)
    await waitFor(() => expect(screen.getByTestId("deep-research-button")).toBeInTheDocument())

    screen.getByTestId("deep-research-button").click()

    expect(mockTriggerDeepResearch).toHaveBeenCalledWith(TOPIC_NODE.ref_id)
    await waitFor(() =>
      expect(screen.getByTestId("deep-research-button")).toHaveTextContent("Researching…")
    )
  })

  it("polling: transitions from RUNNING to COMPLETED on poll", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mockGetLatestStakworkRun
        // mount hydrate → RUNNING
        .mockResolvedValueOnce({ ref_id: "dr-run-5", job_type: "deep_research", status: "RUNNING", created_at: 0 })
        // first interval poll → still RUNNING
        .mockResolvedValueOnce({ ref_id: "dr-run-5", job_type: "deep_research", status: "RUNNING", created_at: 0 })
        // second interval poll → COMPLETED
        .mockResolvedValueOnce({ ref_id: "dr-run-5", job_type: "deep_research", status: "COMPLETED", created_at: 0 })

      render(<NodePreviewPanel node={TOPIC_NODE} onBack={vi.fn()} schemas={[]} />)
      await waitFor(() =>
        expect(screen.getByTestId("deep-research-button")).toHaveTextContent("Researching…")
      )

      // Fire two poll intervals (5s each)
      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(5000)

      await waitFor(() =>
        expect(screen.getByTestId("deep-research-button")).toHaveTextContent("Re-run Research")
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("polling interval stops after unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mockGetLatestStakworkRun
        .mockResolvedValueOnce({ ref_id: "dr-run-6", job_type: "deep_research", status: "RUNNING", created_at: 0 })
        .mockResolvedValue({ ref_id: "dr-run-6", job_type: "deep_research", status: "RUNNING", created_at: 0 })

      const { unmount } = render(<NodePreviewPanel node={TOPIC_NODE} onBack={vi.fn()} schemas={[]} />)
      await waitFor(() =>
        expect(screen.getByTestId("deep-research-button")).toHaveTextContent("Researching…")
      )

      const callsBefore = mockGetLatestStakworkRun.mock.calls.length
      unmount()

      await vi.advanceTimersByTimeAsync(15000)
      expect(mockGetLatestStakworkRun.mock.calls.length).toBe(callsBefore)
    } finally {
      vi.useRealTimers()
    }
  })
})
