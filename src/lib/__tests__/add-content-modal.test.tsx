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
let mockIsAdmin = false

vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel?: (s: unknown) => unknown) => {
    const state = {
      budget: 500,
      setBudget: mockSetBudget,
      pubKey: "testpubkey",
      routeHint: "",
      isAdmin: mockIsAdmin,
      refreshBalance: mockRefreshBalance,
    }
    return sel ? sel(state) : state
  },
}))

// --- App store mock ---
const mockSetMyContentOpen = vi.fn()
const mockBumpMyContentRefresh = vi.fn()

vi.mock("@/stores/app-store", () => {
  const getState = () => ({
    setMyContentOpen: mockSetMyContentOpen,
    bumpMyContentRefresh: mockBumpMyContentRefresh,
  })
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
  SOURCE_TYPE_LABELS: {
    youtube_video: "YouTube Video",
    link: "Link",
    youtube_channel: "YouTube Channel",
    twitter_handle: "Twitter Handle",
    rss: "RSS Feed",
    github_repository: "GitHub Repo",
  },
  SOURCE_TYPES: {
    TWEET: "tweet",
    LINK: "link",
    YOUTUBE_VIDEO: "youtube_video",
    YOUTUBE_LIVE: "youtube_live",
    YOUTUBE_SHORT: "youtube_short",
    WEB_PAGE: "web_page",
    DOCUMENT: "document",
    TWITTER_HANDLE: "twitter_handle",
    YOUTUBE_CHANNEL: "youtube_channel",
    RSS: "rss",
    GITHUB_REPOSITORY: "github_repository",
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

import { AddSourceForm } from "@/components/modals/add-source-form"

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

    render(<AddSourceForm />)

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

    render(<AddSourceForm />)

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

    render(<AddSourceForm />)

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

    render(<AddSourceForm />)

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

    render(<AddSourceForm />)

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

    render(<AddSourceForm />)

    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://example.com/article")

    await waitFor(() => {
      expect(mockDetectSourceType).toHaveBeenCalled()
    })

    expect(mockCheckNodeExists).not.toHaveBeenCalled()
    expect(mockApiGet).not.toHaveBeenCalled()
  })
})

describe("AddContentModal — subscription source callout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveModal = "addContent"
    mockGetL402.mockResolvedValue(null)
    mockPayL402.mockResolvedValue(undefined)
    mockGetPrice.mockResolvedValue(10)
    mockApiPost.mockResolvedValue({})
    mockRefreshBalance.mockResolvedValue(undefined)
    mockCheckNodeExists.mockResolvedValue({ exists: false, ref_id: null, status: null })
  })

  it("shows subscription callout when isSubscriptionSource returns true", async () => {
    mockDetectSourceType.mockResolvedValue("youtube_channel")
    mockIsSubscriptionSource.mockReturnValue(true)

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://youtube.com/c/testchannel")

    await waitFor(() => {
      expect(
        screen.getByText(/This source will be ingested continuously on a schedule/i)
      ).toBeInTheDocument()
    })
  })

  it("does not show subscription callout for one-off types", async () => {
    mockDetectSourceType.mockResolvedValue("youtube_video")
    mockIsSubscriptionSource.mockReturnValue(false)
    mockCheckNodeExists.mockResolvedValue({ exists: false, ref_id: null, status: null })

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://youtube.com/watch?v=abc123")

    await waitFor(() => {
      expect(mockDetectSourceType).toHaveBeenCalled()
    })

    expect(
      screen.queryByText(/This source will be ingested continuously on a schedule/i)
    ).not.toBeInTheDocument()
  })
})

describe("AddContentModal — bumpMyContentRefresh on submission", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveModal = "addContent"
    mockGetL402.mockResolvedValue(null)
    mockPayL402.mockResolvedValue(undefined)
    mockGetPrice.mockResolvedValue(0)
    mockApiPost.mockResolvedValue({})
    mockRefreshBalance.mockResolvedValue(undefined)
    mockIsSubscriptionSource.mockReturnValue(false)
    mockCheckNodeExists.mockResolvedValue({ exists: false, ref_id: null, status: null })
  })

  it("calls bumpMyContentRefresh after successful non-subscription submission", async () => {
    mockDetectSourceType.mockResolvedValue("youtube_video")

    render(<AddSourceForm />)

    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://youtube.com/watch?v=newvideo")

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add source/i })).not.toBeDisabled()
    })

    await userEvent.click(screen.getByRole("button", { name: /add source/i }))

    // Wait for API post and then the 1200ms timeout to fire
    await waitFor(() => {
      expect(mockBumpMyContentRefresh).toHaveBeenCalled()
    }, { timeout: 3000 })
    expect(mockSetMyContentOpen).toHaveBeenCalledWith(true)
  }, 10000)

  it("does NOT call bumpMyContentRefresh for subscription sources", async () => {
    // For non-admins, subscription sources produce a disabled button (isSubscriptionBlocked).
    mockDetectSourceType.mockResolvedValue("twitter_handle")
    mockIsSubscriptionSource.mockReturnValue(true)

    render(<AddSourceForm />)

    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://twitter.com/satoshi")

    await waitFor(() => {
      expect(mockDetectSourceType).toHaveBeenCalled()
    })

    // Button must be disabled — isSubscriptionBlocked prevents submission
    const btn = screen.queryByRole("button", { name: /add source/i })
    expect(btn).toBeDisabled()

    expect(mockBumpMyContentRefresh).not.toHaveBeenCalled()
  })
})


describe("AddContentModal — admin category/weight fields", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveModal = "addContent"
    mockIsAdmin = false
    mockGetL402.mockResolvedValue(null)
    mockPayL402.mockResolvedValue(undefined)
    mockGetPrice.mockResolvedValue(0)
    mockApiPost.mockResolvedValue({})
    mockRefreshBalance.mockResolvedValue(undefined)
    mockCheckNodeExists.mockResolvedValue({ exists: false, ref_id: null, status: null })
  })

  it("renders category and weight inputs for admins with subscription sources", async () => {
    mockIsAdmin = true
    mockDetectSourceType.mockResolvedValue("youtube_channel")
    mockIsSubscriptionSource.mockReturnValue(true)

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://youtube.com/@testchannel")

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/e\.g\. AI, crypto, finance/i)).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/0\.0 – 1\.0/i)).toBeInTheDocument()
    })
  })

  it("does not render category/weight inputs for non-admins", async () => {
    mockIsAdmin = false
    mockDetectSourceType.mockResolvedValue("youtube_channel")
    mockIsSubscriptionSource.mockReturnValue(true)

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://youtube.com/@testchannel")

    await waitFor(() => {
      expect(mockDetectSourceType).toHaveBeenCalled()
    })

    expect(screen.queryByPlaceholderText(/e\.g\. AI, crypto, finance/i)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/0\.0 – 1\.0/i)).not.toBeInTheDocument()
  })

  it("does not render category/weight inputs for one-off sources even for admins", async () => {
    mockIsAdmin = true
    mockDetectSourceType.mockResolvedValue("youtube_video")
    mockIsSubscriptionSource.mockReturnValue(false)
    mockCheckNodeExists.mockResolvedValue({ exists: false, ref_id: null, status: null })

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://youtube.com/watch?v=abc")

    await waitFor(() => {
      expect(mockDetectSourceType).toHaveBeenCalled()
    })

    expect(screen.queryByPlaceholderText(/e\.g\. AI, crypto, finance/i)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/0\.0 – 1\.0/i)).not.toBeInTheDocument()
  })
})
