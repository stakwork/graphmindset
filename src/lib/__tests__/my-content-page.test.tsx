import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react"
import React from "react"
import EventEmitter from "events"

// --- mock @/lib/socket ---
// Provides a fake Socket (EventEmitter) so tests can simulate socket events
// without a real network connection.
class FakeSocket extends EventEmitter {
  connected = false
  on(event: string, listener: (...args: unknown[]) => void) { return super.on(event, listener) }
  off(event: string, listener: (...args: unknown[]) => void) { return super.off(event, listener) }
  disconnect() { this.connected = false; return this }
}

let fakeSocket: FakeSocket
const mockGetSocket = vi.fn(() => fakeSocket)

vi.mock("@/lib/socket", () => ({
  getSocket: (...args: unknown[]) => mockGetSocket(...args),
  disconnectSocket: vi.fn(),
}))

// --- mock api ---
const mockApiGet = vi.fn()
vi.mock("@/lib/api", () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}))

// --- mock @/lib/sphinx (getL402) ---
let mockGetL402Value = ""
vi.mock("@/lib/sphinx", () => ({
  getL402: () => Promise.resolve(mockGetL402Value),
}))

// --- mock graph-api delete functions ---
const mockDeleteNode = vi.fn().mockResolvedValue({})
vi.mock("@/lib/graph-api", () => ({
  deleteNode: (...args: unknown[]) => mockDeleteNode(...args),
}))

// --- mock creator-insights (avoids api.get side-channel in tests) ---
vi.mock("@/lib/creator-insights", () => ({
  fetchCreatorInsights: () => Promise.resolve({ period: "week", total_sats_earned: 0, total_unlocks: 0, nodes: [] }),
  getGrowthBadge: () => "flat",
}))

// --- mock stores ---
interface MyContentUserStore {
  pubKey: string
  routeHint: string
  isAdmin: boolean
}
let myContentUserOverrides: Partial<MyContentUserStore> = {}
vi.mock("@/stores/user-store", () => ({
  useUserStore: () => ({
    pubKey: "03abc123testkey",
    routeHint: "",
    isAdmin: false,
    ...myContentUserOverrides,
  }),
}))

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel: (s: { schemas: never[] }) => unknown) =>
    sel({ schemas: [] }),
}))

const mockOpen = vi.fn()
vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel: (s: { open: typeof mockOpen }) => unknown) =>
    sel({ open: mockOpen }),
}))

// --- mock mock-data (disable mock mode so tests hit api.get) ---
vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => false,
  MOCK_CONTENT: { nodes: [], totalCount: 0, totalProcessing: 0 },
}))

// --- mock node-preview-panel ---
vi.mock("@/components/layout/node-preview-panel", () => ({
  NodePreviewPanel: () => <div data-testid="node-preview" />,
}))

import { MyContentPanel } from "@/components/layout/my-content-panel"
import { useAppStore } from "@/stores/app-store"

// initialise a fresh FakeSocket before every test so the module-level
// singleton reference inside the mock is always up-to-date
beforeEach(() => {
  fakeSocket = new FakeSocket()
  mockGetSocket.mockReturnValue(fakeSocket)
})

const NOW_SECONDS = Math.floor(Date.now() / 1000)
const FRESH_TIMESTAMP = NOW_SECONDS - 3600 // 1 hour ago
const STALE_TIMESTAMP = NOW_SECONDS - 73 * 3600 // 73 hours ago

const TWO_NODES = {
  nodes: [
    {
      node_type: "Tweet",
      ref_id: "ref-1",
      date_added_to_graph: FRESH_TIMESTAMP,
      properties: { name: "Bitcoin is freedom", status: "complete" },
    },
    {
      node_type: "Podcast",
      ref_id: "ref-2",
      date_added_to_graph: FRESH_TIMESTAMP,
      properties: { name: "What Bitcoin Did #412", status: "processing" },
    },
  ],
  totalCount: 2,
  totalProcessing: 1,
}

const EMPTY_RESPONSE = {
  nodes: [],
  totalCount: 0,
  totalProcessing: 0,
}

describe("MyContentPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    myContentUserOverrides = {}
  })

  it("renders items with processing banner", async () => {
    mockApiGet.mockResolvedValue(TWO_NODES)
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText("Bitcoin is freedom")).toBeInTheDocument()
    })

    expect(screen.getByText("What Bitcoin Did #412")).toBeInTheDocument()
    expect(screen.getByText(/1 item.* still processing/i)).toBeInTheDocument()
  })

  it("renders empty state with Add Content button", async () => {
    mockApiGet.mockResolvedValue(EMPTY_RESPONSE)
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText("No content yet")).toBeInTheDocument()
    })

    expect(screen.getByRole("button", { name: /add content/i })).toBeInTheDocument()
    expect(screen.getByText("Add content and start earning money for contributing")).toBeInTheDocument()
    expect(screen.queryByText(/still processing/i)).not.toBeInTheDocument()
  })

  it("never renders boost UI in MyContent (every node here is the user's own content)", async () => {
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: { name: "Bitcoin is freedom", status: "complete", boost: 150 },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("Bitcoin is freedom")).toBeInTheDocument()
    })
    expect(screen.queryByText("sats")).not.toBeInTheDocument()
  })

  it("renders no boost display when boost is absent", async () => {
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: { name: "Bitcoin is freedom", status: "complete" },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.queryByText("sats")).not.toBeInTheDocument()
    })
  })

  it("calls the correct API endpoint", async () => {
    mockApiGet.mockResolvedValue(EMPTY_RESPONSE)
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText("No content yet")).toBeInTheDocument()
    })

    expect(mockApiGet).toHaveBeenCalledWith(
      "/v2/content?sort_by=date&limit=50&skip=0"
    )
  })

  it("hides boost sats display when node has owner_reference_id (contributor)", async () => {
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: {
            name: "Bitcoin is freedom",
            status: "complete",
            boost: 150,
            owner_reference_id: "lsat:11111111-1111-1111-1111-111111111111",
          },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: false }
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("Bitcoin is freedom")).toBeInTheDocument()
    })
    expect(screen.queryByText("sats")).not.toBeInTheDocument()
  })

  it("hides boost sats display when isAdmin is true", async () => {
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: {
            name: "Bitcoin is freedom",
            status: "complete",
            boost: 200,
            owner_reference_id: "lsat:22222222-2222-2222-2222-222222222222",
          },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: true }
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("Bitcoin is freedom")).toBeInTheDocument()
    })
    expect(screen.queryByText("sats")).not.toBeInTheDocument()
  })
})

describe("MyContentPanel – Stakwork badge link", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    myContentUserOverrides = {}
  })

  it("renders badge as <a> with correct href when admin + project_id + error status", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: true }
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: { name: "Failed Node", status: "error", project_id: 99999 },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("Failed Node")).toBeInTheDocument()
    })
    const link = screen.getByRole("link", { name: /failed/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute("href", "https://jobs.stakwork.com/admin/projects/99999")
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("renders badge as plain <span> (no <a>) when non-admin with project_id", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: false }
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: { name: "Failed Node", status: "error", project_id: 99999 },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("Failed Node")).toBeInTheDocument()
    })
    expect(screen.queryByRole("link", { name: /failed/i })).toBeNull()
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })

  it("renders badge as plain <span> (no <a>) when admin but no project_id", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: true }
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: { name: "Failed Node", status: "error" },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("Failed Node")).toBeInTheDocument()
    })
    expect(screen.queryByRole("link", { name: /failed/i })).toBeNull()
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })

  it("stopPropagation: clicking badge link does not trigger parent row onClick", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: true }
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: { name: "Failed Node", status: "error", project_id: 99999 },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("Failed Node")).toBeInTheDocument()
    })
    const link = screen.getByRole("link", { name: /failed/i })
    // Should not open node preview panel after clicking link
    fireEvent.click(link)
    expect(screen.queryByTestId("node-preview")).toBeNull()
  })

  it("renders standalone ExternalLink <a> for admin + integer project_id + completed status (no badge label)", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: true }
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-completed",
          properties: { name: "Completed Node", status: "done", project_id: 99999 },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("Completed Node")).toBeInTheDocument()
    })
    // No status badge label text (completed nodes intentionally have no badge)
    expect(screen.queryByText(/in.progress|processing|halted|paused|error|failed/i)).toBeNull()
    // Standalone ExternalLink <a> should be rendered with correct href
    const links = screen.getAllByRole("link")
    const stakworkLink = links.find((l) => l.getAttribute("href") === "https://jobs.stakwork.com/admin/projects/99999")
    expect(stakworkLink).toBeTruthy()
    expect(stakworkLink).toHaveAttribute("href", "https://jobs.stakwork.com/admin/projects/99999")
    expect(stakworkLink).toHaveAttribute("target", "_blank")
    // Clicking it should not propagate to parent row
    fireEvent.click(stakworkLink!)
    expect(screen.queryByTestId("node-preview")).toBeNull()
  })
})

describe("MyContentPanel – delete button", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    myContentUserOverrides = {}
    mockDeleteNode.mockResolvedValue({})
  })

  // /v2/content is server-filtered to the caller's own content, so every node here
  // is implicitly owned — delete always renders, no client-side ownership check needed.
  const NODE = {
    nodes: [
      {
        node_type: "Tweet",
        ref_id: "ref-orphan",
        properties: {
          name: "Orphan Node",
          status: "error",
          owner_reference_id: "lsat:11111111-1111-1111-1111-111111111111",
        },
      },
    ],
    totalCount: 1,
    totalProcessing: 0,
  }

  it("trash button always renders for /v2/content nodes", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: false }
    mockApiGet.mockResolvedValue(NODE)
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText("Orphan Node")).toBeInTheDocument())
    expect(screen.getByRole("button", { name: /delete node/i })).toBeInTheDocument()
  })

  it("clicking trash shows inline confirmation; Cancel hides it with no API call", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: false }
    mockApiGet.mockResolvedValue(NODE)
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText("Orphan Node")).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /delete node/i }))
    expect(screen.getByRole("button", { name: /confirm delete/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }))
    expect(screen.queryByRole("button", { name: /confirm delete/i })).toBeNull()
    expect(mockDeleteNode).not.toHaveBeenCalled()
  })

  it("confirm calls deleteNode(ref_id) and removes only that node", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: false }
    mockApiGet.mockResolvedValue(NODE)
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText("Orphan Node")).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /delete node/i }))
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }))

    await waitFor(() => {
      expect(mockDeleteNode).toHaveBeenCalledWith("ref-orphan")
    })
    await waitFor(() => {
      expect(screen.queryByText("Orphan Node")).not.toBeInTheDocument()
    })
    // No error banner on success
    expect(screen.queryByText(/could not delete/i)).not.toBeInTheDocument()
  })

  it("error banner renders on delete failure; row not removed; confirm strip closed", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: false }
    mockDeleteNode.mockRejectedValueOnce(new Error("401"))
    mockApiGet.mockResolvedValue(NODE)
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText("Orphan Node")).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /delete node/i }))
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }))

    await waitFor(() => {
      expect(screen.getByText(/could not delete content/i)).toBeInTheDocument()
    })
    // Row must still be present
    expect(screen.getByText("Orphan Node")).toBeInTheDocument()
    // Confirm strip must be gone
    expect(screen.queryByRole("button", { name: /confirm delete/i })).toBeNull()
  })

  it("error clears when user starts a new delete attempt", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: false }
    mockDeleteNode.mockRejectedValueOnce(new Error("401"))
    mockApiGet.mockResolvedValue(NODE)
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText("Orphan Node")).toBeInTheDocument())

    // First attempt — fails
    fireEvent.click(screen.getByRole("button", { name: /delete node/i }))
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }))
    await waitFor(() => {
      expect(screen.getByText(/could not delete content/i)).toBeInTheDocument()
    })

    // Start a second delete attempt — error banner should disappear
    fireEvent.click(screen.getByRole("button", { name: /delete node/i }))
    expect(screen.queryByText(/could not delete content/i)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /confirm delete/i })).toBeInTheDocument()
  })
})

describe("MyContentPanel – L402 identity paths", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    myContentUserOverrides = {}
    mockGetL402Value = ""
  })

  it("pubKey present: fetches without pubkey param — identity flows via auto-attached sig+msg", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: false }
    mockApiGet.mockResolvedValue(EMPTY_RESPONSE)
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText("No content yet")).toBeInTheDocument()
    })

    expect(mockApiGet).toHaveBeenCalledWith(
      "/v2/content?sort_by=date&limit=50&skip=0"
    )
    // Must NOT include a pubkey param — boltwall derives identity from sig
    expect(mockApiGet).not.toHaveBeenCalledWith(
      expect.stringContaining("pubkey=")
    )
  })

  it("no pubKey + L402 in cookie: fetches without pubkey param", async () => {
    myContentUserOverrides = { pubKey: "", routeHint: "", isAdmin: false }
    mockGetL402Value = "LSAT sometoken:somepreimage"
    mockApiGet.mockResolvedValue(TWO_NODES)
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText("Bitcoin is freedom")).toBeInTheDocument()
    })

    expect(mockApiGet).toHaveBeenCalledWith(
      "/v2/content?sort_by=date&limit=50&skip=0"
    )
    // Must NOT include a pubkey param
    expect(mockApiGet).not.toHaveBeenCalledWith(
      expect.stringContaining("pubkey=")
    )
  })

  it("no pubKey + no L402: renders empty state without making any API call", async () => {
    myContentUserOverrides = { pubKey: "", routeHint: "", isAdmin: false }
    mockGetL402Value = ""
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText("No content yet")).toBeInTheDocument()
    })

    expect(mockApiGet).not.toHaveBeenCalled()
    expect(
      screen.getByRole("button", { name: /add content/i })
    ).toBeInTheDocument()
  })
})

describe("MyContentPanel — myContentRefreshKey re-fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    myContentUserOverrides = {}
    mockGetL402Value = ""
    useAppStore.setState({ myContentRefreshKey: 0 })
  })

  it("re-fetches when myContentRefreshKey increments", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: false }
    mockApiGet.mockResolvedValue(TWO_NODES)

    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText("Bitcoin is freedom")).toBeInTheDocument()
    })

    const contentCallsBefore = mockApiGet.mock.calls.filter(([url]: [string]) =>
      url.startsWith("/v2/content")
    ).length
    expect(contentCallsBefore).toBe(1)

    // Simulate bumpMyContentRefresh
    act(() => {
      useAppStore.getState().bumpMyContentRefresh()
    })

    await waitFor(() => {
      const contentCallsAfter = mockApiGet.mock.calls.filter(([url]: [string]) =>
        url.startsWith("/v2/content")
      ).length
      expect(contentCallsAfter).toBe(2)
    })
  })
})

describe("MyContentPanel — ScrollArea h-full class", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    myContentUserOverrides = {}
  })

  it("ScrollArea root element always has h-full class", async () => {
    mockApiGet.mockResolvedValue(TWO_NODES)
    const { container } = render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText("Bitcoin is freedom")).toBeInTheDocument())
    const scrollAreaRoots = container.querySelectorAll("[data-slot='scroll-area']")
    expect(scrollAreaRoots.length).toBeGreaterThan(0)
    scrollAreaRoots.forEach((el) => {
      expect(el.classList.contains("h-full")).toBe(true)
    })
  })
})

describe("MyContentPanel — infinite scroll pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: false }
  })

  const makeNodes = (count: number, offset = 0) => ({
    nodes: Array.from({ length: count }, (_, i) => ({
      node_type: "Tweet",
      ref_id: `ref-${offset + i}`,
      properties: { name: `Node ${offset + i}`, status: "done" },
    })),
    totalCount: count,
    totalProcessing: 0,
  })

  it("sentinel div is present when hasMore is true", async () => {
    // First page returns PAGE_SIZE (50) nodes → hasMore = true
    mockApiGet.mockResolvedValueOnce(makeNodes(50))
    const { container } = render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText("Node 0")).toBeInTheDocument())
    // sentinel is the div inside the ScrollArea that the IntersectionObserver watches
    // it only renders when hasMore === true
    const sentinel = container.querySelector("[data-testid='sentinel']") ??
      // fallback: find the loader or any trailing div with ref
      Array.from(container.querySelectorAll("[data-slot='scroll-area-viewport'] > div > div")).at(-1)
    // The last child of the list should be the hasMore sentinel
    expect(sentinel).toBeTruthy()
  })

  it("loadMore fetches next page with correct skip param", async () => {
    // First page: 50 nodes → hasMore true
    mockApiGet.mockResolvedValueOnce(makeNodes(50))
    // Second page: 10 nodes → hasMore false
    mockApiGet.mockResolvedValueOnce(makeNodes(10, 50))

    // Mock IntersectionObserver to immediately trigger intersection.
    // Must be a class (constructable) because @base-ui uses `new IntersectionObserver()` internally.
    const observerCallbacks: ((entries: IntersectionObserverEntry[]) => void)[] = []
    class MockIntersectionObserver {
      constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
        observerCallbacks.push(cb)
      }
      observe = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver)

    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText("Node 0")).toBeInTheDocument())

    // Simulate intersection (sentinel enters viewport)
    act(() => {
      observerCallbacks.forEach((cb) =>
        cb([{ isIntersecting: true } as IntersectionObserverEntry])
      )
    })

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith("/v2/content?sort_by=date&limit=50&skip=50")
    })

    // Second page nodes now rendered
    await waitFor(() => expect(screen.getByText("Node 50")).toBeInTheDocument())

    vi.unstubAllGlobals()
  })
})

describe("MyContentPanel — Socket.IO integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: false }
    fakeSocket = new FakeSocket()
    mockGetSocket.mockReturnValue(fakeSocket)
  })

  const IN_PROGRESS_RESPONSE = {
    nodes: [
      {
        node_type: "Tweet",
        ref_id: "ref-ws-1",
        date_added_to_graph: FRESH_TIMESTAMP,
        properties: { name: "WS Node", status: "processing" },
      },
    ],
    totalCount: 1,
    totalProcessing: 1,
  }

  it("node_updated event updates node status in-place without additional fetch", async () => {
    mockApiGet.mockResolvedValue(IN_PROGRESS_RESPONSE)
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText("WS Node")).toBeInTheDocument())

    const callsBefore = mockApiGet.mock.calls.filter(([url]: [string]) =>
      url.startsWith("/v2/content")
    ).length

    // Simulate socket connect + node settled via push event
    act(() => {
      fakeSocket.connected = true
      fakeSocket.emit("connect")
      fakeSocket.emit("node_updated", { ref_id: "ref-ws-1", status: "done" })
    })

    // No extra /v2/content fetch — update came from socket
    expect(
      mockApiGet.mock.calls.filter(([url]: [string]) => url.startsWith("/v2/content")).length
    ).toBe(callsBefore)

    // Banner must clear because all in-progress nodes settled via socket
    await waitFor(() =>
      expect(screen.queryByText(/still processing/i)).not.toBeInTheDocument()
    )
  })

  it("does NOT poll while socket is connected — only initial load fetch fires", async () => {
    // Socket starts already-connected so the polling gate is blocked from the start
    fakeSocket.connected = true
    mockApiGet.mockResolvedValue(IN_PROGRESS_RESPONSE)

    render(<MyContentPanel onClose={() => {}} />)

    // Emit connect synchronously so isSocketConnected flips true before the
    // polling effect evaluates hasInProgress
    act(() => { fakeSocket.emit("connect") })

    await waitFor(() => expect(screen.getByText("WS Node")).toBeInTheDocument())

    // Wait a polling cycle to confirm no extra fetches occurred
    await new Promise((r) => setTimeout(r, 100))

    // Only the initial load fetch should have fired, no poll calls
    const contentCalls = mockApiGet.mock.calls.filter(([url]: [string]) =>
      url.startsWith("/v2/content")
    ).length
    expect(contentCalls).toBe(1)
  })

  it("WebSocket: fresh in-progress node settling to done clears banner", async () => {
    mockApiGet.mockResolvedValue(IN_PROGRESS_RESPONSE)
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText("WS Node")).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/1 item.* still processing/i)).toBeInTheDocument())

    act(() => {
      fakeSocket.connected = true
      fakeSocket.emit("connect")
      fakeSocket.emit("node_updated", { ref_id: "ref-ws-1", status: "done" })
    })

    await waitFor(() =>
      expect(screen.queryByText(/still processing/i)).not.toBeInTheDocument()
    )
  })

  it("WebSocket: stale node receiving done event does not affect banner (already excluded)", async () => {
    const staleInProgressResponse = {
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-stale-ws",
          date_added_to_graph: STALE_TIMESTAMP,
          properties: { name: "Stale WS Node", status: "processing" },
        },
      ],
      totalCount: 1,
      totalProcessing: 1,
    }
    mockApiGet.mockResolvedValue(staleInProgressResponse)
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText("Stale WS Node")).toBeInTheDocument())
    // Banner should not show because the only processing node is stale
    expect(screen.queryByText(/still processing/i)).not.toBeInTheDocument()

    act(() => {
      fakeSocket.connected = true
      fakeSocket.emit("connect")
      fakeSocket.emit("node_updated", { ref_id: "ref-stale-ws", status: "done" })
    })

    // Still no banner — it was already excluded before the event
    await waitFor(() =>
      expect(screen.queryByText(/still processing/i)).not.toBeInTheDocument()
    )
  })

  it("registers polling interval after socket disconnects", async () => {
    // Start with socket connected so the polling gate is initially blocked
    fakeSocket.connected = true
    mockApiGet.mockResolvedValue(IN_PROGRESS_RESPONSE)

    render(<MyContentPanel onClose={() => {}} />)
    act(() => { fakeSocket.emit("connect") })
    await waitFor(() => expect(screen.getByText("WS Node")).toBeInTheDocument())

    // Snapshot setInterval call count — should be zero while connected
    const setIntervalSpy = vi.spyOn(global, "setInterval")
    const callsWhileConnected = setIntervalSpy.mock.calls.filter(([, ms]) => ms === 5000).length
    expect(callsWhileConnected).toBe(0)

    // Socket drops — polling effect re-evaluates and must register a setInterval
    act(() => {
      fakeSocket.connected = false
      fakeSocket.emit("disconnect")
    })

    await waitFor(() => {
      const callsAfterDisconnect = setIntervalSpy.mock.calls.filter(([, ms]) => ms === 5000).length
      expect(callsAfterDisconnect).toBeGreaterThan(0)
    })

    setIntervalSpy.mockRestore()
  })
})

describe("MyContentPanel — stale processing filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: false }
    fakeSocket = new FakeSocket()
    mockGetSocket.mockReturnValue(fakeSocket)
  })

  it("fresh processing node (<72h): banner shows 1 item still processing", async () => {
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-fresh",
          date_added_to_graph: FRESH_TIMESTAMP,
          properties: { name: "Fresh Node", status: "processing" },
        },
      ],
      totalCount: 1,
      totalProcessing: 1,
    })
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText("Fresh Node")).toBeInTheDocument())
    expect(screen.getByText(/1 item.* still processing/i)).toBeInTheDocument()
  })

  it("stale processing node (>72h): banner does not appear", async () => {
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-stale",
          date_added_to_graph: STALE_TIMESTAMP,
          properties: { name: "Stale Node", status: "processing" },
        },
      ],
      totalCount: 1,
      totalProcessing: 1,
    })
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText("Stale Node")).toBeInTheDocument())
    expect(screen.queryByText(/still processing/i)).not.toBeInTheDocument()
  })

  it("mixed: one fresh + one stale processing node — banner shows 1 item", async () => {
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-fresh-mix",
          date_added_to_graph: FRESH_TIMESTAMP,
          properties: { name: "Fresh Mix Node", status: "processing" },
        },
        {
          node_type: "Tweet",
          ref_id: "ref-stale-mix",
          date_added_to_graph: STALE_TIMESTAMP,
          properties: { name: "Stale Mix Node", status: "processing" },
        },
      ],
      totalCount: 2,
      totalProcessing: 2,
    })
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText("Fresh Mix Node")).toBeInTheDocument())
    expect(screen.getByText(/1 item.* still processing/i)).toBeInTheDocument()
  })

  it("node with no date_added_to_graph (epoch) is treated as stale — banner hidden", async () => {
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-no-date",
          properties: { name: "No Date Node", status: "processing" },
        },
      ],
      totalCount: 1,
      totalProcessing: 1,
    })
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText("No Date Node")).toBeInTheDocument())
    expect(screen.queryByText(/still processing/i)).not.toBeInTheDocument()
  })

  it("stale-only node: polling interval is NOT started (hasInProgress is false)", async () => {
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-stale-poll",
          date_added_to_graph: STALE_TIMESTAMP,
          properties: { name: "Stale Poll Node", status: "processing" },
        },
      ],
      totalCount: 1,
      totalProcessing: 1,
    })

    const setIntervalSpy = vi.spyOn(global, "setInterval")

    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText("Stale Poll Node")).toBeInTheDocument())

    // Wait a tick to let effects settle
    await new Promise((r) => setTimeout(r, 50))

    const pollCalls = setIntervalSpy.mock.calls.filter(([, ms]) => ms === 5000).length
    expect(pollCalls).toBe(0)

    setIntervalSpy.mockRestore()
  })
})
