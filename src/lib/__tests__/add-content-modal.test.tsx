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
let mockOwnerReferenceId = ""

vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel?: (s: unknown) => unknown) => {
    const state = {
      budget: 500,
      setBudget: mockSetBudget,
      pubKey: "testpubkey",
      routeHint: "",
      isAdmin: mockIsAdmin,
      refreshBalance: mockRefreshBalance,
      ownerReferenceId: mockOwnerReferenceId,
    }
    return sel ? sel(state) : state
  },
}))

// --- App store mock ---
const mockSetMyContentOpen = vi.fn()
const mockBumpMyContentRefresh = vi.fn()

let mockActiveSkinInContent = "default"

vi.mock("@/stores/app-store", () => {
  const getState = () => ({
    setMyContentOpen: mockSetMyContentOpen,
    bumpMyContentRefresh: mockBumpMyContentRefresh,
    activeSkin: mockActiveSkinInContent,
  })
  return {
    useAppStore: Object.assign(
      (sel?: (s: unknown) => unknown) => {
        const state = {
          setMyContentOpen: mockSetMyContentOpen,
          bumpMyContentRefresh: mockBumpMyContentRefresh,
          activeSkin: mockActiveSkinInContent,
        }
        return sel ? sel(state) : state
      },
      { getState }
    ),
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

const mockReprocessContent = vi.fn()

vi.mock("@/lib/graph-api", () => ({
  checkNodeExists: (...args: unknown[]) => mockCheckNodeExists(...args),
  reprocessContent: (...args: unknown[]) => mockReprocessContent(...args),
  CONTENT_TYPE_TO_NODE_TYPE: {
    audio_video: "Episode",
    document: "Document",
    webpage: "Document",
    arxiv_paper: "ArxivPaper",
    tweet: "Tweet",
    legal_document: "LegalDocument",
  },
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
    // web_page now triggers checkNodeExists for Document dedup, but NOT the preview probe (api.get)
    mockCheckNodeExists.mockResolvedValue({ exists: false, ref_id: null, status: null, owner_reference_id: null })

    render(<AddSourceForm />)

    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://example.com/article")

    await waitFor(() => {
      expect(mockDetectSourceType).toHaveBeenCalled()
    })

    // Preview probe (api.get) must NOT be called — only checkNodeExists is called for dedup
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

// ---------------------------------------------------------------------------
// AddSourceForm — content_type skin-awareness
// ---------------------------------------------------------------------------

describe("AddSourceForm — content_type overridden by active skin", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveSkinInContent = "default"
    mockGetL402.mockResolvedValue(null)
    mockGetPrice.mockResolvedValue(0)
    mockApiPost.mockResolvedValue({})
    mockRefreshBalance.mockResolvedValue(undefined)
    mockIsSubscriptionSource.mockReturnValue(false)
    mockCheckNodeExists.mockResolvedValue({ exists: false, ref_id: null, status: null })
  })

  it("sends content_type 'legal_document' when legal skin is active and source is a PDF URL", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

    mockActiveSkinInContent = "legal"
    mockDetectSourceType.mockResolvedValue("document")

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await user.type(input, "https://example.com/contract.pdf")

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add source/i })).not.toBeDisabled()
    })

    await user.click(screen.getByRole("button", { name: /add source/i }))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        "/v2/content",
        expect.objectContaining({ content_type: "legal_document" }),
        expect.anything()
      )
    })

    vi.useRealTimers()
  })

  it("sends content_type 'document' when default skin is active and source is a PDF URL", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

    mockActiveSkinInContent = "default"
    mockDetectSourceType.mockResolvedValue("document")

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await user.type(input, "https://example.com/contract.pdf")

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add source/i })).not.toBeDisabled()
    })

    await user.click(screen.getByRole("button", { name: /add source/i }))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        "/v2/content",
        expect.objectContaining({ content_type: "document" }),
        expect.anything()
      )
    })

    vi.useRealTimers()
  })

  it("sends content_type 'audio_video' for YouTube URL regardless of legal skin", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

    mockActiveSkinInContent = "legal"
    mockDetectSourceType.mockResolvedValue("youtube_video")
    mockCheckNodeExists.mockResolvedValue({ exists: false, ref_id: null, status: null })

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await user.type(input, "https://youtube.com/watch?v=abc123")

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add source/i })).not.toBeDisabled()
    })

    await user.click(screen.getByRole("button", { name: /add source/i }))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        "/v2/content",
        expect.objectContaining({ content_type: "audio_video" }),
        expect.anything()
      )
    })

    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// AddSourceForm — "Already in graph" yellow callout + Re-process flow
// ---------------------------------------------------------------------------

describe("AddSourceForm — already-in-graph callout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveModal = "addContent"
    mockIsAdmin = false
    mockOwnerReferenceId = ""
    mockGetL402.mockResolvedValue(null)
    mockPayL402.mockResolvedValue(undefined)
    mockGetPrice.mockResolvedValue(10)
    mockApiPost.mockResolvedValue({})
    mockRefreshBalance.mockResolvedValue(undefined)
    mockIsSubscriptionSource.mockReturnValue(false)
    mockCheckNodeExists.mockResolvedValue({ exists: false, ref_id: null, status: null, owner_reference_id: null })
    mockReprocessContent.mockResolvedValue({})
  })

  it("shows yellow callout for a Document-type duplicate", async () => {
    mockDetectSourceType.mockResolvedValue("document")
    mockCheckNodeExists.mockResolvedValue({
      exists: true,
      ref_id: "doc-ref-1",
      status: "completed",
      owner_reference_id: "lsat:other-user",
    })

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://example.com/doc.pdf")

    await waitFor(() => {
      expect(screen.getByText(/This content is already in the graph/i)).toBeInTheDocument()
    })
  })

  it("shows no Re-process button for non-admin, non-owner", async () => {
    mockDetectSourceType.mockResolvedValue("document")
    mockIsAdmin = false
    mockOwnerReferenceId = "lsat:me"
    mockCheckNodeExists.mockResolvedValue({
      exists: true,
      ref_id: "doc-ref-1",
      status: "completed",
      owner_reference_id: "lsat:other-user",
    })

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://example.com/doc.pdf")

    await waitFor(() => {
      expect(screen.getByText(/Contact an admin to re-process/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole("button", { name: /re-process/i })).not.toBeInTheDocument()
  })

  it("shows Re-process button when isAdmin is true", async () => {
    mockDetectSourceType.mockResolvedValue("document")
    mockIsAdmin = true
    mockCheckNodeExists.mockResolvedValue({
      exists: true,
      ref_id: "doc-ref-1",
      status: "completed",
      owner_reference_id: "lsat:other-user",
    })

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://example.com/doc.pdf")

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /re-process/i })).toBeInTheDocument()
    })
  })

  it("shows Re-process button when ownerReferenceId matches node's owner_reference_id", async () => {
    mockDetectSourceType.mockResolvedValue("document")
    mockIsAdmin = false
    mockOwnerReferenceId = "lsat:owner-uuid"
    mockCheckNodeExists.mockResolvedValue({
      exists: true,
      ref_id: "doc-ref-1",
      status: "completed",
      owner_reference_id: "lsat:owner-uuid",
    })

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://example.com/doc.pdf")

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /re-process/i })).toBeInTheDocument()
    })
  })

  it("checkNodeExists is NOT called for subscription source types", async () => {
    mockDetectSourceType.mockResolvedValue("youtube_channel")
    mockIsSubscriptionSource.mockReturnValue(true)

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://youtube.com/c/testchannel")

    await waitFor(() => {
      expect(mockDetectSourceType).toHaveBeenCalled()
    })

    expect(mockCheckNodeExists).not.toHaveBeenCalled()
  })

  it("calls reprocessContent (not api.post) on Re-process click", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

    mockDetectSourceType.mockResolvedValue("document")
    mockIsAdmin = true
    mockCheckNodeExists.mockResolvedValue({
      exists: true,
      ref_id: "doc-ref-1",
      status: "completed",
      owner_reference_id: "lsat:other-user",
    })
    mockReprocessContent.mockResolvedValue({})

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await user.type(input, "https://example.com/doc.pdf")

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /re-process/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: /re-process/i }))

    await waitFor(() => {
      expect(mockReprocessContent).toHaveBeenCalledWith(
        "doc-ref-1",
        expect.objectContaining({ source_link: "https://example.com/doc.pdf", content_type: "document" })
      )
    })
    expect(mockApiPost).not.toHaveBeenCalledWith("/v2/content", expect.anything(), expect.anything())

    vi.useRealTimers()
  })

  it("primary submit button is disabled when existingNode is set", async () => {
    mockDetectSourceType.mockResolvedValue("document")
    mockCheckNodeExists.mockResolvedValue({
      exists: true,
      ref_id: "doc-ref-1",
      status: "completed",
      owner_reference_id: "lsat:other-user",
    })

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://example.com/doc.pdf")

    await waitFor(() => {
      expect(screen.getByText(/This content is already in the graph/i)).toBeInTheDocument()
    })

    // The primary "Add Source" / "Pay & Add" button should be disabled
    const submitBtn = screen.getByRole("button", { name: /add source|pay & add/i })
    expect(submitBtn).toBeDisabled()
  })

  it("existing Episode cacheStatus (green Cached badge) flow is unchanged", async () => {
    mockDetectSourceType.mockResolvedValue("youtube_video")
    mockCheckNodeExists.mockResolvedValue({
      exists: true,
      ref_id: "ep-ref-1",
      status: "completed",
      owner_reference_id: null,
    })
    // Preview probe returns 402 (pay-required)
    mockApiGet.mockRejectedValue(Object.assign(new Response(null, { status: 402 })))

    render(<AddSourceForm />)
    const input = screen.getByPlaceholderText(/Paste URL/)
    await userEvent.type(input, "https://youtube.com/watch?v=abc123")

    await waitFor(() => {
      // Multiple elements may say "Cached — instant unlock" (badge + footer); check at least one exists
      expect(screen.getAllByText(/Cached — instant unlock/i).length).toBeGreaterThan(0)
    })
    // Yellow callout should NOT appear for Episode types
    expect(screen.queryByText(/This content is already in the graph/i)).not.toBeInTheDocument()
  })
})
