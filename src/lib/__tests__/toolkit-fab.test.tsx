/**
 * Tests for ToolkitFAB mobile floating action button:
 * - FAB wrapper has sm:hidden class
 * - Desktop Toolkit root div has hidden sm:flex class
 * - Clicking FAB opens/closes the popup
 * - Clicking backdrop closes the popup
 * - Admin actions shown only when isAdmin=true
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"

// ── Store mocks ───────────────────────────────────────────────────────────────

const userState = { isAdmin: false, budget: 1234, pubKey: "abc" }
vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel?: (s: unknown) => unknown) => sel ? sel(userState) : userState,
}))

const modalOpen = vi.fn()
const modalOpenAdd = vi.fn()
vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel?: (s: unknown) => unknown) => {
    const state = { open: modalOpen, openAdd: modalOpenAdd }
    return sel ? sel(state) : state
  },
}))

const reviewState = { pendingCount: 0, setPendingCount: vi.fn() }
vi.mock("@/stores/review-store", () => ({
  useReviewStore: (sel?: (s: unknown) => unknown) => sel ? sel(reviewState) : reviewState,
}))

// ── Next.js router mock ───────────────────────────────────────────────────────
const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}))

// ── Sphinx / WebLN mocks ──────────────────────────────────────────────────────
vi.mock("@/lib/sphinx/detect", () => ({ isSphinx: () => false }))
vi.mock("@/lib/sphinx/bridge", () => ({ hasWebLN: () => false }))

// ── graph-api (listReviews used by desktop Toolkit useEffect) ─────────────────
vi.mock("@/lib/graph-api", () => ({
  listReviews: vi.fn().mockResolvedValue({ nodes: [], total: 0 }),
}))

// ── Tooltip shim (avoids Radix portal issues in jsdom) ───────────────────────
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render: r, children }: { render?: React.ReactElement; children?: React.ReactNode }) =>
    r ?? <>{children}</>,
  TooltipContent: () => null,
}))

// ── Default props ─────────────────────────────────────────────────────────────
const defaultProps = {
  sourcesOpen: false,
  onToggleSources: vi.fn(),
  myContentOpen: false,
  onToggleMyContent: vi.fn(),
  followingOpen: false,
  onToggleFollowing: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  userState.isAdmin = false
  userState.budget = 1234
  reviewState.pendingCount = 0
})

// ── ToolkitFAB tests ──────────────────────────────────────────────────────────

describe("ToolkitFAB", () => {
  it("FAB wrapper has sm:hidden class", async () => {
    const { ToolkitFAB } = await import("@/components/layout/toolkit")
    const { container } = render(<ToolkitFAB {...defaultProps} />)
    const wrapper = container.querySelector(".sm\\:hidden")
    expect(wrapper).not.toBeNull()
  })

  it("renders FAB button with 'Open menu' aria-label initially", async () => {
    const { ToolkitFAB } = await import("@/components/layout/toolkit")
    render(<ToolkitFAB {...defaultProps} />)
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument()
  })

  it("clicking FAB opens the popup with action buttons", async () => {
    const { ToolkitFAB } = await import("@/components/layout/toolkit")
    render(<ToolkitFAB {...defaultProps} />)

    const fab = screen.getByRole("button", { name: "Open menu" })
    fireEvent.click(fab)

    expect(screen.getByText("Add to graph")).toBeInTheDocument()
    expect(screen.getByText("My Content")).toBeInTheDocument()
    expect(screen.getByText("Sources")).toBeInTheDocument()
    expect(screen.getByText("Following")).toBeInTheDocument()
  })

  it("clicking FAB again (Close menu) closes the popup", async () => {
    const { ToolkitFAB } = await import("@/components/layout/toolkit")
    render(<ToolkitFAB {...defaultProps} />)

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }))
    expect(screen.getByText("Add to graph")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Close menu" }))
    expect(screen.queryByText("Add to graph")).not.toBeInTheDocument()
  })

  it("clicking backdrop closes the popup", async () => {
    const { ToolkitFAB } = await import("@/components/layout/toolkit")
    const { container } = render(<ToolkitFAB {...defaultProps} />)

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }))
    expect(screen.getByText("Add to graph")).toBeInTheDocument()

    // The backdrop is a fixed inset-0 div rendered before the wrapper
    const backdrop = container.querySelector(".fixed.inset-0.z-40")
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop!)
    expect(screen.queryByText("Add to graph")).not.toBeInTheDocument()
  })

  it("clicking an action button triggers the action and closes popup", async () => {
    const { ToolkitFAB } = await import("@/components/layout/toolkit")
    render(<ToolkitFAB {...defaultProps} />)

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }))
    fireEvent.click(screen.getByText("Add to graph"))

    expect(modalOpenAdd).toHaveBeenCalledWith("source")
    expect(screen.queryByText("Add to graph")).not.toBeInTheDocument()
  })

  it("Sources button calls onToggleSources and closes popup", async () => {
    const { ToolkitFAB } = await import("@/components/layout/toolkit")
    const onToggleSources = vi.fn()
    render(<ToolkitFAB {...defaultProps} onToggleSources={onToggleSources} />)

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }))
    fireEvent.click(screen.getByText("Sources"))

    expect(onToggleSources).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("Sources")).not.toBeInTheDocument()
  })

  it("admin actions are absent when isAdmin=false", async () => {
    userState.isAdmin = false
    const { ToolkitFAB } = await import("@/components/layout/toolkit")
    render(<ToolkitFAB {...defaultProps} />)

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }))
    expect(screen.queryByText("Ontology")).not.toBeInTheDocument()
    expect(screen.queryByText("Reviews")).not.toBeInTheDocument()
    expect(screen.queryByText("Settings")).not.toBeInTheDocument()
  })

  it("admin actions are present when isAdmin=true", async () => {
    userState.isAdmin = true
    const { ToolkitFAB } = await import("@/components/layout/toolkit")
    render(<ToolkitFAB {...defaultProps} />)

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }))
    expect(screen.getByText("Ontology")).toBeInTheDocument()
    expect(screen.getByText("Settings")).toBeInTheDocument()
    // Reviews label (no pending count)
    expect(screen.getByText("Reviews")).toBeInTheDocument()
  })

  it("Reviews label shows count when pendingCount > 0", async () => {
    userState.isAdmin = true
    reviewState.pendingCount = 5
    const { ToolkitFAB } = await import("@/components/layout/toolkit")
    render(<ToolkitFAB {...defaultProps} />)

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }))
    expect(screen.getByText("Reviews (5)")).toBeInTheDocument()
  })

  it("budget sats display shows formatted value", async () => {
    userState.budget = 2500
    const { ToolkitFAB } = await import("@/components/layout/toolkit")
    render(<ToolkitFAB {...defaultProps} />)

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }))
    expect(screen.getByText("2.5k sats")).toBeInTheDocument()
  })

  it("Settings button navigates to /settings via router.push (not openModal)", async () => {
    userState.isAdmin = true
    const { ToolkitFAB } = await import("@/components/layout/toolkit")
    render(<ToolkitFAB {...defaultProps} />)

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }))
    fireEvent.click(screen.getByText("Settings"))

    expect(mockPush).toHaveBeenCalledWith("/settings")
    // must NOT call openModal for settings
    expect(modalOpen).not.toHaveBeenCalledWith("settings")
  })
})

// ── Desktop Toolkit hidden class test ─────────────────────────────────────────

describe("Toolkit (desktop strip)", () => {
  it("root div has hidden sm:flex classes", async () => {
    const { Toolkit } = await import("@/components/layout/toolkit")
    const { container } = render(<Toolkit {...defaultProps} />)
    // The outermost div rendered by Toolkit
    const root = container.firstElementChild
    expect(root?.className).toContain("hidden")
    expect(root?.className).toContain("sm:flex")
  })

  it("Settings button in desktop toolbar navigates to /settings via router.push", async () => {
    userState.isAdmin = true
    const { Toolkit } = await import("@/components/layout/toolkit")
    render(<Toolkit {...defaultProps} />)

    const settingsBtn = screen.getByRole("button", { name: "Settings" })
    fireEvent.click(settingsBtn)

    expect(mockPush).toHaveBeenCalledWith("/settings")
    expect(modalOpen).not.toHaveBeenCalledWith("settings")
  })
})
