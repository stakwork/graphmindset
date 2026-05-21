import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { WorkflowMarketplaceItem, StakworkRun } from "@/lib/graph-api"

// Mock modules before importing the component
vi.mock("@/lib/graph-api", () => ({
  getWorkflowMarketplace: vi.fn(),
  getCronRuns: vi.fn(),
}))

const userState = { isAdmin: false }
vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel?: (s: typeof userState) => unknown) =>
    sel ? sel(userState) : userState,
}))

const MOCK_ITEMS: WorkflowMarketplaceItem[] = [
  {
    ref_id: "rc-twitter",
    source_type: "twitter_handle",
    kind: "source",
    enabled: true,
    label: undefined,
  },
  {
    ref_id: "rc-youtube",
    source_type: "youtube_channel",
    kind: "source",
    enabled: false,
    label: "YouTube Channel",
  },
  {
    ref_id: "rc-deduplication",
    source_type: "deduplication",
    kind: "janitor",
    enabled: true,
    label: "Deduplication",
  },
  {
    ref_id: "rc-content-review",
    source_type: "content_review",
    kind: "janitor",
    enabled: false,
    label: "Content Review",
  },
]

vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: vi.fn(() => false),
  MOCK_WORKFLOW_MARKETPLACE: [
    { ref_id: "rc-twitter", source_type: "twitter_handle", kind: "source", enabled: true, label: undefined },
    { ref_id: "rc-youtube", source_type: "youtube_channel", kind: "source", enabled: false, label: "YouTube Channel" },
    { ref_id: "rc-deduplication", source_type: "deduplication", kind: "janitor", enabled: true, label: "Deduplication" },
    { ref_id: "rc-content-review", source_type: "content_review", kind: "janitor", enabled: false, label: "Content Review" },
  ],
  MOCK_STAKWORK_RUNS: [],
}))

import { WorkflowsPanel } from "@/components/layout/workflows-panel"

describe("WorkflowsPanel", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    userState.isAdmin = false
    const { isMocksEnabled } = await import("@/lib/mock-data")
    vi.mocked(isMocksEnabled).mockReturnValue(false)
  })

  it("renders loading spinner while fetching", async () => {
    const { getWorkflowMarketplace } = await import("@/lib/graph-api")
    vi.mocked(getWorkflowMarketplace).mockReturnValue(new Promise(() => {})) // never resolves

    render(<WorkflowsPanel onClose={() => {}} />)
    expect(document.querySelector(".animate-spin")).toBeTruthy()
  })

  it("renders all workflow cards after loading", async () => {
    const { getWorkflowMarketplace } = await import("@/lib/graph-api")
    vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)

    render(<WorkflowsPanel onClose={() => {}} />)

    await waitFor(() => {
      // twitter_handle has no label — humanized name "Twitter Handle" appears once
      expect(screen.getByText("Twitter Handle")).toBeInTheDocument()
      expect(screen.getByText("YouTube Channel")).toBeInTheDocument()
      expect(screen.getByText("Deduplication")).toBeInTheDocument()
      expect(screen.getByText("Content Review")).toBeInTheDocument()
    })

    // Icon tiles render with data-testid per source_type
    expect(document.querySelector("[data-testid='workflow-icon-twitter_handle']")).toBeTruthy()
    expect(document.querySelector("[data-testid='workflow-icon-youtube_channel']")).toBeTruthy()
    expect(document.querySelector("[data-testid='workflow-icon-deduplication']")).toBeTruthy()
    expect(document.querySelector("[data-testid='workflow-icon-content_review']")).toBeTruthy()
  })

  it("falls back to source_type when label is absent", async () => {
    const { getWorkflowMarketplace } = await import("@/lib/graph-api")
    vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)

    render(<WorkflowsPanel onClose={() => {}} />)

    await waitFor(() => {
      // rc-twitter has no label — humanized display name shown once, raw source_type not visible
      expect(screen.getByText("Twitter Handle")).toBeInTheDocument()
      expect(screen.queryByText("twitter_handle")).not.toBeInTheDocument()
    })
  })

  it("shows empty state when list is empty", async () => {
    const { getWorkflowMarketplace } = await import("@/lib/graph-api")
    vi.mocked(getWorkflowMarketplace).mockResolvedValue([])

    render(<WorkflowsPanel onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText("No workflows configured yet")).toBeInTheDocument()
    })
  })

  it("calls onClose when close button is clicked", async () => {
    const { getWorkflowMarketplace } = await import("@/lib/graph-api")
    vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)
    const onClose = vi.fn()

    render(<WorkflowsPanel onClose={onClose} />)
    await waitFor(() => screen.getByText("Deduplication"))

    await userEvent.click(screen.getByRole("button", { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("filters to only Ingestion (kind=source) items", async () => {
    const { getWorkflowMarketplace } = await import("@/lib/graph-api")
    vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)

    render(<WorkflowsPanel onClose={() => {}} />)
    await waitFor(() => screen.getByText("Deduplication"))

    await userEvent.click(screen.getByRole("button", { name: "Ingestion" }))

    // Source items should be visible
    expect(screen.getByText("Twitter Handle")).toBeInTheDocument()
    expect(screen.getByText("YouTube Channel")).toBeInTheDocument()
    // Janitor items should not be visible
    expect(screen.queryByText("Deduplication")).not.toBeInTheDocument()
    expect(screen.queryByText("Content Review")).not.toBeInTheDocument()
  })

  it("filters to only Janitor items", async () => {
    const { getWorkflowMarketplace } = await import("@/lib/graph-api")
    vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)

    render(<WorkflowsPanel onClose={() => {}} />)
    await waitFor(() => screen.getByText("Deduplication"))

    await userEvent.click(screen.getByRole("button", { name: "Janitor" }))

    // Janitor items should be visible
    expect(screen.getByText("Deduplication")).toBeInTheDocument()
    expect(screen.getByText("Content Review")).toBeInTheDocument()
    // Source items should not be visible
    expect(screen.queryByText("Twitter Handle")).not.toBeInTheDocument()
    expect(screen.queryByText("YouTube Channel")).not.toBeInTheDocument()
  })

  it("shows all items after selecting All filter", async () => {
    const { getWorkflowMarketplace } = await import("@/lib/graph-api")
    vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)

    render(<WorkflowsPanel onClose={() => {}} />)
    await waitFor(() => screen.getByText("Deduplication"))

    // Go to Janitor then back to All
    await userEvent.click(screen.getByRole("button", { name: "Janitor" }))
    await userEvent.click(screen.getByRole("button", { name: "All" }))

    expect(screen.getByText("Twitter Handle")).toBeInTheDocument()
    expect(screen.getByText("Deduplication")).toBeInTheDocument()
  })

  it("renders enabled dot for enabled workflow", async () => {
    const { getWorkflowMarketplace } = await import("@/lib/graph-api")
    vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)

    render(<WorkflowsPanel onClose={() => {}} />)
    await waitFor(() => screen.getByText("Deduplication"))

    const enabledDots = document.querySelectorAll("[data-testid='dot-enabled']")
    const disabledDots = document.querySelectorAll("[data-testid='dot-disabled']")
    // 2 enabled (rc-twitter, rc-deduplication), 2 disabled (rc-youtube, rc-content-review)
    expect(enabledDots.length).toBe(2)
    expect(disabledDots.length).toBe(2)
  })

  it("uses MOCK_WORKFLOW_MARKETPLACE in mock mode", async () => {
    const { isMocksEnabled } = await import("@/lib/mock-data")
    vi.mocked(isMocksEnabled).mockReturnValue(true)

    render(<WorkflowsPanel onClose={() => {}} />)

    await waitFor(() => {
      // twitter_handle item has no label — humanized name shown once
      expect(screen.getByText("Twitter Handle")).toBeInTheDocument()
      expect(screen.queryByText("twitter_handle")).not.toBeInTheDocument()
    })
  })

  // ── Admin accordion tests ────────────────────────────────────────────────

  describe("admin accordion", () => {
    beforeEach(() => {
      userState.isAdmin = true
    })

    it("non-admin: cards render as plain divs — no buttons with aria-expanded, no chevrons", async () => {
      userState.isAdmin = false
      const { getWorkflowMarketplace } = await import("@/lib/graph-api")
      vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)

      render(<WorkflowsPanel onClose={() => {}} />)
      await waitFor(() => screen.getByText("Deduplication"))

      // Only filter chip buttons (All, Ingestion, Janitor) + Close button = 4
      const allButtons = screen.getAllByRole("button")
      expect(allButtons.length).toBe(4)
      expect(document.querySelector("[aria-expanded]")).toBeNull()
    })

    it("admin: cards are buttons with aria-expanded attribute", async () => {
      const { getWorkflowMarketplace, getCronRuns } = await import("@/lib/graph-api")
      vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)
      vi.mocked(getCronRuns).mockResolvedValue({ runs: [] })

      render(<WorkflowsPanel onClose={() => {}} />)
      await waitFor(() => screen.getByText("Deduplication"))

      const expandableButtons = screen
        .getAllByRole("button")
        .filter((b) => b.hasAttribute("aria-expanded"))
      // 4 workflow cards
      expect(expandableButtons.length).toBe(4)
    })

    it("clicking a card expands it showing runs section", async () => {
      const { getWorkflowMarketplace, getCronRuns } = await import("@/lib/graph-api")
      vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)
      vi.mocked(getCronRuns).mockResolvedValue({ runs: [] })

      render(<WorkflowsPanel onClose={() => {}} />)
      await waitFor(() => screen.getByText("Deduplication"))

      const cardButtons = screen
        .getAllByRole("button")
        .filter((b) => b.hasAttribute("aria-expanded"))

      await userEvent.click(cardButtons[0])

      await waitFor(() => {
        expect(document.querySelector("[data-testid='runs-section']")).toBeTruthy()
      })
    })

    it("clicking an expanded card collapses it", async () => {
      const { getWorkflowMarketplace, getCronRuns } = await import("@/lib/graph-api")
      vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)
      vi.mocked(getCronRuns).mockResolvedValue({ runs: [] })

      render(<WorkflowsPanel onClose={() => {}} />)
      await waitFor(() => screen.getByText("Deduplication"))

      const cardButtons = screen
        .getAllByRole("button")
        .filter((b) => b.hasAttribute("aria-expanded"))

      // Expand
      await userEvent.click(cardButtons[0])
      await waitFor(() => expect(document.querySelector("[data-testid='runs-section']")).toBeTruthy())

      // Collapse
      await userEvent.click(cardButtons[0])
      await waitFor(() => expect(document.querySelector("[data-testid='runs-section']")).toBeNull())
    })

    it("opening a second card collapses the first (only one open at a time)", async () => {
      const { getWorkflowMarketplace, getCronRuns } = await import("@/lib/graph-api")
      vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)
      vi.mocked(getCronRuns).mockResolvedValue({ runs: [] })

      render(<WorkflowsPanel onClose={() => {}} />)
      await waitFor(() => screen.getByText("Deduplication"))

      const cardButtons = screen
        .getAllByRole("button")
        .filter((b) => b.hasAttribute("aria-expanded"))

      await userEvent.click(cardButtons[0])
      await waitFor(() => expect(document.querySelector("[data-testid='runs-section']")).toBeTruthy())

      await userEvent.click(cardButtons[1])
      await waitFor(() => {
        const sections = document.querySelectorAll("[data-testid='runs-section']")
        expect(sections.length).toBe(1)
      })
    })

    it("shows 'No runs yet' when API returns empty array", async () => {
      const { getWorkflowMarketplace, getCronRuns } = await import("@/lib/graph-api")
      vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)
      vi.mocked(getCronRuns).mockResolvedValue({ runs: [] })

      render(<WorkflowsPanel onClose={() => {}} />)
      await waitFor(() => screen.getByText("Deduplication"))

      const cardButtons = screen
        .getAllByRole("button")
        .filter((b) => b.hasAttribute("aria-expanded"))
      await userEvent.click(cardButtons[0])

      await waitFor(() => {
        expect(screen.getByText("No runs yet")).toBeInTheDocument()
      })
    })

    it("renders run rows with RunStatusBadge and relative timestamp", async () => {
      const { getWorkflowMarketplace, getCronRuns } = await import("@/lib/graph-api")
      vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)
      const mockRun: StakworkRun = {
        ref_id: "run-001",
        source_type: "twitter_handle",
        kind: "source",
        status: "completed",
        finished_at: Math.floor(Date.now() / 1000) - 3600,
      }
      vi.mocked(getCronRuns).mockResolvedValue({ runs: [mockRun] })

      render(<WorkflowsPanel onClose={() => {}} />)
      await waitFor(() => screen.getByText("Twitter Handle"))

      const cardButtons = screen
        .getAllByRole("button")
        .filter((b) => b.hasAttribute("aria-expanded"))
      await userEvent.click(cardButtons[0])

      await waitFor(() => {
        expect(screen.getByText("completed")).toBeInTheDocument()
      })
    })

    it("renders 'View on Stakwork' external link when project_id is present", async () => {
      const { getWorkflowMarketplace, getCronRuns } = await import("@/lib/graph-api")
      vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)
      const mockRun: StakworkRun = {
        ref_id: "run-001",
        source_type: "twitter_handle",
        kind: "source",
        status: "completed",
        finished_at: Math.floor(Date.now() / 1000) - 3600,
        project_id: 123456,
      }
      vi.mocked(getCronRuns).mockResolvedValue({ runs: [mockRun] })

      render(<WorkflowsPanel onClose={() => {}} />)
      await waitFor(() => screen.getByText("Twitter Handle"))

      const cardButtons = screen
        .getAllByRole("button")
        .filter((b) => b.hasAttribute("aria-expanded"))
      await userEvent.click(cardButtons[0])

      await waitFor(() => {
        const link = document.querySelector("[data-testid='stakwork-link']") as HTMLAnchorElement
        expect(link).toBeTruthy()
        expect(link.href).toBe("https://jobs.stakwork.com/admin/projects/123456")
      })
    })

    it("does not render stakwork link when project_id is absent", async () => {
      const { getWorkflowMarketplace, getCronRuns } = await import("@/lib/graph-api")
      vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)
      const mockRun: StakworkRun = {
        ref_id: "run-001",
        source_type: "twitter_handle",
        kind: "source",
        status: "completed",
        finished_at: Math.floor(Date.now() / 1000) - 3600,
      }
      vi.mocked(getCronRuns).mockResolvedValue({ runs: [mockRun] })

      render(<WorkflowsPanel onClose={() => {}} />)
      await waitFor(() => screen.getByText("Twitter Handle"))

      const cardButtons = screen
        .getAllByRole("button")
        .filter((b) => b.hasAttribute("aria-expanded"))
      await userEvent.click(cardButtons[0])

      await waitFor(() => {
        expect(document.querySelector("[data-testid='stakwork-link']")).toBeNull()
      })
    })

    it("renders error text below run row when error field is set", async () => {
      const { getWorkflowMarketplace, getCronRuns } = await import("@/lib/graph-api")
      vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)
      const mockRun: StakworkRun = {
        ref_id: "run-002",
        source_type: "twitter_handle",
        kind: "source",
        status: "error",
        error: "Stakwork dispatch timeout",
        finished_at: Math.floor(Date.now() / 1000) - 60,
      }
      vi.mocked(getCronRuns).mockResolvedValue({ runs: [mockRun] })

      render(<WorkflowsPanel onClose={() => {}} />)
      await waitFor(() => screen.getByText("Twitter Handle"))

      const cardButtons = screen
        .getAllByRole("button")
        .filter((b) => b.hasAttribute("aria-expanded"))
      await userEvent.click(cardButtons[0])

      await waitFor(() => {
        expect(screen.getByText("Stakwork dispatch timeout")).toBeInTheDocument()
      })
    })

    it("re-expanding a card does not call getCronRuns again (cache hit)", async () => {
      const { getWorkflowMarketplace, getCronRuns } = await import("@/lib/graph-api")
      vi.mocked(getWorkflowMarketplace).mockResolvedValue(MOCK_ITEMS)
      vi.mocked(getCronRuns).mockResolvedValue({ runs: [] })

      render(<WorkflowsPanel onClose={() => {}} />)
      await waitFor(() => screen.getByText("Twitter Handle"))

      const cardButtons = screen
        .getAllByRole("button")
        .filter((b) => b.hasAttribute("aria-expanded"))

      // Expand
      await userEvent.click(cardButtons[0])
      await waitFor(() => expect(document.querySelector("[data-testid='runs-section']")).toBeTruthy())

      // Collapse
      await userEvent.click(cardButtons[0])
      await waitFor(() => expect(document.querySelector("[data-testid='runs-section']")).toBeNull())

      // Re-expand
      await userEvent.click(cardButtons[0])
      await waitFor(() => expect(document.querySelector("[data-testid='runs-section']")).toBeTruthy())

      // getCronRuns should have been called only once — cache used on re-expand
      expect(vi.mocked(getCronRuns)).toHaveBeenCalledTimes(1)
    })
  })
})
