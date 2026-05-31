import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import React from "react"

// --- Sources store mock ---
const mockRemoveSource = vi.fn()
let mockSources: unknown[] = []
let mockLoading = false

vi.mock("@/stores/sources-store", () => ({
  useSourcesStore: () => ({
    sources: mockSources,
    loading: mockLoading,
    setSources: vi.fn(),
    setLoading: vi.fn(),
    removeSource: mockRemoveSource,
  }),
}))

// --- User store mock ---
let mockIsAdmin = false

vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel?: (s: unknown) => unknown) => {
    const state = { isAdmin: mockIsAdmin }
    return sel ? sel(state) : state
  },
}))

// --- API mock ---
vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    delete: vi.fn(),
  },
}))

// --- Mock data ---
vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => false,
  MOCK_SOURCES: [],
}))

// --- Source detection mock (use real labels) ---
vi.mock("@/lib/source-detection", () => ({
  SOURCE_TYPES: {
    TWITTER_HANDLE: "twitter_handle",
    TWEET: "tweet",
    YOUTUBE_CHANNEL: "youtube_channel",
    YOUTUBE_VIDEO: "youtube_video",
    YOUTUBE_LIVE: "youtube_live",
    YOUTUBE_SHORT: "youtube_short",
    RSS: "rss",
    GITHUB_REPOSITORY: "github_repository",
    WEB_PAGE: "web_page",
    DOCUMENT: "document",
    LINK: "link",
  },
  SOURCE_TYPE_LABELS: {
    twitter_handle: "Twitter Handle",
    tweet: "Tweet",
    youtube_channel: "YouTube Channel",
    youtube_video: "YouTube Video",
    youtube_live: "YouTube Live",
    youtube_short: "YouTube Short",
    rss: "RSS Feed",
    github_repository: "GitHub Repo",
    web_page: "Web Page",
    document: "Document",
    link: "Link",
  },
  extractNameFromSource: (source: string) => source,
}))

// --- UI mocks ---
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}))
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="tooltip-content">{children}</span>
  ),
}))

import { SourcesPanel } from "@/components/layout/sources-panel"

const makeSource = (type: string, source = "https://example.com") => ({
  ref_id: `ref-${type}`,
  source,
  source_type: type,
  topics: [],
})

describe("SourcesPanel — header description", () => {
  it("shows description subtitle", () => {
    mockSources = []
    mockIsAdmin = false
    mockLoading = false
    render(<SourcesPanel onClose={vi.fn()} />)
    expect(
      screen.getByText(/External feeds that continuously bring new content into the graph/i)
    ).toBeInTheDocument()
  })
})

describe("SourcesPanel — empty state", () => {
  beforeEach(() => {
    mockSources = []
    mockLoading = false
  })

  it("shows admin copy when isAdmin is true", () => {
    mockIsAdmin = true
    render(<SourcesPanel onClose={vi.fn()} />)
    expect(screen.getByText(/No sources yet/i)).toBeInTheDocument()
    expect(
      screen.getByText(/Add a YouTube channel, Twitter handle, RSS feed, or GitHub repo/i)
    ).toBeInTheDocument()
  })

  it("shows non-admin copy when isAdmin is false", () => {
    mockIsAdmin = false
    render(<SourcesPanel onClose={vi.fn()} />)
    expect(screen.getByText(/No sources configured yet/i)).toBeInTheDocument()
    expect(screen.getByText(/Ask an admin to add content sources/i)).toBeInTheDocument()
  })

  it("does not show admin copy for non-admin", () => {
    mockIsAdmin = false
    render(<SourcesPanel onClose={vi.fn()} />)
    expect(
      screen.queryByText(/Add a YouTube channel/i)
    ).not.toBeInTheDocument()
  })
})

describe("SourcesPanel — SourceRow type label", () => {
  beforeEach(() => {
    mockIsAdmin = false
    mockLoading = false
  })

  const cases: [string, string, string][] = [
    ["youtube_channel", "https://youtube.com/c/test", "YouTube Channel"],
    ["twitter_handle", "testhandle", "Twitter Handle"],
    ["rss", "https://example.com/feed.xml", "RSS Feed"],
    ["github_repository", "https://github.com/org/repo", "GitHub Repo"],
    ["youtube_video", "https://youtube.com/watch?v=abc", "YouTube Video"],
    ["web_page", "https://example.com/article", "Web Page"],
  ]

  it.each(cases)(
    "renders '%s' type label: %s",
    (sourceType, source, expectedLabel) => {
      mockSources = [makeSource(sourceType, source)]
      render(<SourcesPanel onClose={vi.fn()} />)
      const matches = screen.getAllByText(expectedLabel)
      expect(matches.length).toBeGreaterThanOrEqual(1)
    }
  )
})

describe("SourceRow — category badge", () => {
  beforeEach(() => {
    mockIsAdmin = false
    mockLoading = false
  })

  it("renders category badge when source.category is set", () => {
    mockSources = [{ ref_id: "r1", source: "jack", source_type: "twitter_handle", category: "crypto" }]
    render(<SourcesPanel onClose={vi.fn()} />)
    // category text appears both in the source row badge and the filter chip
    expect(screen.getAllByText("crypto").length).toBeGreaterThanOrEqual(1)
  })

  it("does not render a category badge when category is absent", () => {
    mockSources = [{ ref_id: "r2", source: "staborobot", source_type: "twitter_handle" }]
    render(<SourcesPanel onClose={vi.fn()} />)
    expect(screen.queryByText("crypto")).not.toBeInTheDocument()
  })
})

describe("SourceRow — pencil icon (admin only)", () => {
  beforeEach(() => {
    mockLoading = false
  })

  it("does not render pencil button when canEdit is false (non-admin)", () => {
    mockIsAdmin = false
    mockSources = [{ ref_id: "r3", source: "jack", source_type: "twitter_handle" }]
    render(<SourcesPanel onClose={vi.fn()} />)
    expect(screen.queryByLabelText("Edit source metadata")).not.toBeInTheDocument()
  })

  it("renders pencil button for admins", () => {
    mockIsAdmin = true
    mockSources = [{ ref_id: "r4", source: "jack", source_type: "twitter_handle" }]
    render(<SourcesPanel onClose={vi.fn()} />)
    expect(screen.getByLabelText("Edit source metadata")).toBeInTheDocument()
  })
})

describe("SourcesPanel — filter chips", () => {
  beforeEach(() => {
    mockIsAdmin = false
    mockLoading = false
  })

  it("hides filter chips when no sources have a category", () => {
    mockSources = [
      { ref_id: "r5", source: "a", source_type: "rss" },
      { ref_id: "r6", source: "b", source_type: "rss" },
    ]
    render(<SourcesPanel onClose={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "All" })).not.toBeInTheDocument()
  })

  it("renders All chip and distinct category chips when categories exist", () => {
    mockSources = [
      { ref_id: "r7", source: "a", source_type: "rss", category: "AI" },
      { ref_id: "r8", source: "b", source_type: "rss", category: "crypto" },
      { ref_id: "r9", source: "c", source_type: "rss", category: "AI" },
    ]
    render(<SourcesPanel onClose={vi.fn()} />)
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "AI" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "crypto" })).toBeInTheDocument()
    // AI appears only once as a chip (duplicate categories de-duped)
    expect(screen.getAllByRole("button", { name: "AI" }).length).toBe(1)
  })

  it("filters source rows when a category chip is clicked", async () => {
    const { default: userEvent } = await import("@testing-library/user-event")
    mockSources = [
      { ref_id: "r10", source: "aisite.com/feed", source_type: "rss", category: "AI" },
      { ref_id: "r11", source: "cryptonews.com/feed", source_type: "rss", category: "crypto" },
    ]
    render(<SourcesPanel onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole("button", { name: "AI" }))
    expect(screen.getByText("aisite.com/feed")).toBeInTheDocument()
    expect(screen.queryByText("cryptonews.com/feed")).not.toBeInTheDocument()
  })

  it("resets filter when All chip is clicked", async () => {
    const { default: userEvent } = await import("@testing-library/user-event")
    mockSources = [
      { ref_id: "r12", source: "aisite.com/feed", source_type: "rss", category: "AI" },
      { ref_id: "r13", source: "cryptonews.com/feed", source_type: "rss", category: "crypto" },
    ]
    render(<SourcesPanel onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole("button", { name: "AI" }))
    await userEvent.click(screen.getByRole("button", { name: "All" }))
    expect(screen.getByText("aisite.com/feed")).toBeInTheDocument()
    expect(screen.getByText("cryptonews.com/feed")).toBeInTheDocument()
  })
})
