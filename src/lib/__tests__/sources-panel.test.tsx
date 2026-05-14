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
