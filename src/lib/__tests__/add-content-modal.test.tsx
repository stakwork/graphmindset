import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"

// --- Modal store mock ---
const mockClose = vi.fn()
const mockOpenModal = vi.fn()
let mockActiveModal = "addContent"

vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel?: (s: unknown) => unknown) => {
    const state = { activeModal: mockActiveModal, close: mockClose, open: mockOpenModal }
    return sel ? sel(state) : state
  },
}))

// --- User store mock ---
const mockSetBudget = vi.fn()
const mockRefreshBalance = vi.fn().mockResolvedValue(undefined)

vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel?: (s: unknown) => unknown) => {
    const state = {
      budget: 500,
      setBudget: mockSetBudget,
      pubKey: "testpubkey",
      routeHint: "",
      isAdmin: false,
      refreshBalance: mockRefreshBalance,
    }
    return sel ? sel(state) : state
  },
}))

// --- App store mock ---
const mockSetMyContentOpen = vi.fn()

vi.mock("@/stores/app-store", () => {
  const getState = () => ({ setMyContentOpen: mockSetMyContentOpen })
  return {
    useAppStore: {
      getState,
    },
  }
})

// --- Player store mock ---
const mockSetPlayingNode = vi.fn()

vi.mock("@/stores/player-store", () => {
  const getState = () => ({ setPlayingNode: mockSetPlayingNode })
  return {
    usePlayerStore: {
      getState,
    },
  }
})

// --- API mock ---
const mockApiGet = vi.fn()
const mockApiPost = vi.fn()

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: vi.fn(),
    delete: vi.fn(),
  },
  API_URL: "http://localhost:3000",
}))

// --- Sphinx mocks ---
const mockGetL402 = vi.fn().mockResolvedValue(null)
const mockPayL402 = vi.fn().mockResolvedValue(undefined)
const mockGetPrice = vi.fn().mockResolvedValue(10)

vi.mock("@/lib/sphinx", () => ({
  getL402: (...args: unknown[]) => mockGetL402(...args),
  payL402: (...args: unknown[]) => mockPayL402(...args),
  getPrice: (...args: unknown[]) => mockGetPrice(...args),
}))

// --- Source detection mock ---
const mockDetectSourceType = vi.fn()
const mockIsSubscriptionSource = vi.fn().mockReturnValue(false)

vi.mock("@/lib/source-detection", () => ({
  detectSourceType: (...args: unknown[]) => mockDetectSourceType(...args),
  SOURCE_TYPE_LABELS: { youtube_video: "YouTube Video", link: "Link" },
  SOURCE_TYPES: {
    TWEET: "tweet",
    LINK: "link",
    YOUTUBE_VIDEO: "youtube_video",
    YOUTUBE_LIVE: "youtube_live",
    YOUTUBE_SHORT: "youtube_short",
    WEB_PAGE: "web_page",
    DOCUMENT: "document",
    TWITTER_HANDLE: "twitter_handle",
  },
  isSubscriptionSource: (...args: unknown[]) => mockIsSubscriptionSource(...args),
}))

// --- Graph API mock ---
const mockCheckNodeExists = vi.fn()

vi.mock("@/lib/graph-api", () => ({
  checkNodeExists: (...args: unknown[]) => mockCheckNodeExists(...args),
}))

// --- Input limits mock ---
vi.mock("@/lib/input-limits", () => ({
  MAX_LENGTHS: { SOURCE_URL: 2000 },
}))

const mockNode = {
  ref_id: "abc-123",
  label: "Test Episode",
  node_type: "Episode",
  properties: {},
}

import { AddContentModal } from "@/components/modals/add-content-modal"

describe("AddContentModal — preview probe", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveModal = "addContent"
    mockGetL402.mockResolvedValue(null)
    mockPayL402.mockResolvedValue(undefined)
    mockGetPrice.mockResolvedValue(10)
    mockApiPost.mockResolvedValue({})
    mockRefreshBalance.mockResolvedValue(undefined)
    mockIsSubscriptionSource.mockReturnValue(false)
  })

  it("owned (200): auto-routes to player and closes modal", async () => {
    mockDetectSourceType.mockResolvedValue("youtube_video")
    mockCheckNodeExists.mockResolvedValue({
      exists: true,
      ref_id: "abc-123",
      status: "completed",
    })
    mockApiGet.mockResolvedValue({ nodes: [mockNode] })

    render(<AddContentModal />)

    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://youtube.com/watch?v=test123")

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith("/v2/nodes/abc-123?preview=1")
    })

    await waitFor(() => {
      expect(mockSetPlayingNode).toHaveBeenCalledWith(mockNode)
    })

    await waitFor(() => {
      expect(mockClose).toHaveBeenCalled()
    })

    expect(mockSetMyContentOpen).toHaveBeenCalledWith(true)
  })

  it("pay-required (402): modal stays open with Pay & Unlock button and price row", async () => {
    mockDetectSourceType.mockResolvedValue("youtube_video")
    mockCheckNodeExists.mockResolvedValue({
      exists: true,
      ref_id: "abc-123",
      status: "completed",
    })
    mockApiGet.mockRejectedValue(new Response(null, { status: 402 }))

    render(<AddContentModal />)

    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://youtube.com/watch?v=test123")

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith("/v2/nodes/abc-123?preview=1")
    })

    // Modal stays open — close was never called
    expect(mockClose).not.toHaveBeenCalled()
    expect(mockSetPlayingNode).not.toHaveBeenCalled()

    // "Pay & Unlock" button and price row should be visible
    await waitFor(() => {
      expect(screen.getByText("Pay & Unlock")).toBeInTheDocument()
    })
    expect(screen.getByText(/10 sats/)).toBeInTheDocument()
  })

  it("fallback (network error): modal stays open with Pay & Unlock button", async () => {
    mockDetectSourceType.mockResolvedValue("youtube_video")
    mockCheckNodeExists.mockResolvedValue({
      exists: true,
      ref_id: "abc-123",
      status: "completed",
    })
    mockApiGet.mockRejectedValue(new Error("Network failure"))

    render(<AddContentModal />)

    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://youtube.com/watch?v=test123")

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith("/v2/nodes/abc-123?preview=1")
    })

    expect(mockClose).not.toHaveBeenCalled()
    expect(mockSetPlayingNode).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(screen.getByText("Pay & Unlock")).toBeInTheDocument()
    })
  })

  it("scope guard: probe NOT fired for hit-in-progress", async () => {
    mockDetectSourceType.mockResolvedValue("youtube_video")
    mockCheckNodeExists.mockResolvedValue({
      exists: true,
      ref_id: "abc-123",
      status: "in_progress",
    })

    render(<AddContentModal />)

    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://youtube.com/watch?v=test123")

    await waitFor(() => {
      expect(mockCheckNodeExists).toHaveBeenCalled()
    })

    expect(mockApiGet).not.toHaveBeenCalled()
  })

  it("scope guard: probe NOT fired for miss", async () => {
    mockDetectSourceType.mockResolvedValue("youtube_video")
    mockCheckNodeExists.mockResolvedValue({
      exists: false,
      ref_id: null,
      status: null,
    })

    render(<AddContentModal />)

    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://youtube.com/watch?v=test123")

    await waitFor(() => {
      expect(mockCheckNodeExists).toHaveBeenCalled()
    })

    expect(mockApiGet).not.toHaveBeenCalled()
  })

  it("scope guard: probe NOT fired for non-cacheable source type (web_page)", async () => {
    mockDetectSourceType.mockResolvedValue("web_page")
    // checkNodeExists would not be called either, so apiGet definitely won't

    render(<AddContentModal />)

    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://example.com/article")

    await waitFor(() => {
      expect(mockDetectSourceType).toHaveBeenCalled()
    })

    expect(mockCheckNodeExists).not.toHaveBeenCalled()
    expect(mockApiGet).not.toHaveBeenCalled()
  })
})
