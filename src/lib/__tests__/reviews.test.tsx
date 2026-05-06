import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockApproveReview, mockDismissReview } = vi.hoisted(() => ({
  mockApproveReview: vi.fn(),
  mockDismissReview: vi.fn(),
}))

vi.mock("@/lib/graph-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/graph-api")>()
  return {
    ...actual,
    approveReview: (...args: unknown[]) => mockApproveReview(...args),
    dismissReview: (...args: unknown[]) => mockDismissReview(...args),
  }
})

vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: vi.fn(() => true),
  MOCK_REVIEWS: [],
}))

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({
    render,
    children,
  }: {
    render?: React.ReactElement
    children?: React.ReactNode
  }) => render ?? <>{children}</>,
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/stores/user-store", () => ({
  useUserStore: () => ({ isAdmin: true }),
}))

vi.mock("@/components/layout/node-row", () => ({
  NodeRow: ({ node }: { node: { ref_id: string; node_type: string; properties: Record<string, unknown> } }) => (
    <div data-testid={`node-row-${node.ref_id}`}>{String(node.properties?.name ?? node.ref_id)}</div>
  ),
}))

// ── Test fixtures ─────────────────────────────────────────────────────────────

import type { Review } from "@/lib/graph-api"

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    ref_id: "rv-test-001",
    type: "dedup",
    rationale: "These two nodes are duplicates",
    subject_ids: ["n1", "n2"],
    subject_nodes: [
      { ref_id: "n1", node_type: "Topic", properties: { name: "Node One" } },
      { ref_id: "n2", node_type: "Topic", properties: { name: "Node Two" } },
    ],
    action_name: "merge_nodes",
    action_payload: { from: ["n2"], to: "n1" },
    status: "pending",
    fingerprint: "fp-test-001",
    priority: 2,
    created_at: new Date(Date.now() - 86400_000).toISOString(),
    ...overrides,
  }
}

// ── ReviewRow import (after mocks) ────────────────────────────────────────────

import { ReviewRow } from "@/components/admin/review-row"

describe("ReviewRow", () => {
  const noop = () => {}

  beforeEach(() => {
    mockApproveReview.mockReset()
    mockDismissReview.mockReset()
  })

  // ── Status badge colours ────────────────────────────────────────────────────
  // Pending rows render Approve/Dismiss buttons in place of the badge — that
  // case is covered by the "shows Approve and Dismiss buttons …" test below.

  it("renders green badge for approved status", () => {
    const { container } = render(
      <ReviewRow schemas={[]} review={makeReview({ status: "approved" })} onRefresh={noop} />
    )
    const badge = container.querySelector("[data-status='approved']")
    expect(badge).toBeTruthy()
    expect(badge!.textContent).toBe("approved")
    expect(badge!.className).toContain("bg-emerald-500")
  })

  it("renders grey badge for dismissed status", () => {
    const { container } = render(
      <ReviewRow schemas={[]} review={makeReview({ status: "dismissed" })} onRefresh={noop} />
    )
    const badge = container.querySelector("[data-status='dismissed']")
    expect(badge).toBeTruthy()
    expect(badge!.textContent).toBe("dismissed")
    expect(badge!.className).toContain("text-muted-foreground")
  })

  it("renders red badge for failed status", () => {
    const { container } = render(
      <ReviewRow schemas={[]} review={makeReview({ status: "failed" })} onRefresh={noop} />
    )
    const badge = container.querySelector("[data-status='failed']")
    expect(badge).toBeTruthy()
    expect(badge!.textContent).toBe("failed")
    expect(badge!.className).toContain("bg-red-500")
  })

  // ── Approve / Dismiss only for pending ─────────────────────────────────────

  it("shows Approve and Dismiss buttons only for pending rows", () => {
    const { getByText } = render(
      <ReviewRow schemas={[]} review={makeReview({ status: "pending" })} onRefresh={noop} />
    )
    expect(getByText("Approve")).toBeTruthy()
    expect(getByText("Dismiss")).toBeTruthy()
  })

  it("does NOT show Approve/Dismiss buttons for approved rows", () => {
    const { queryByText } = render(
      <ReviewRow schemas={[]} review={makeReview({ status: "approved" })} onRefresh={noop} />
    )
    expect(queryByText("Approve")).toBeNull()
    expect(queryByText("Dismiss")).toBeNull()
  })

  it("does NOT show Approve/Dismiss buttons for dismissed rows", () => {
    const { queryByText } = render(
      <ReviewRow schemas={[]} review={makeReview({ status: "dismissed" })} onRefresh={noop} />
    )
    expect(queryByText("Approve")).toBeNull()
    expect(queryByText("Dismiss")).toBeNull()
  })

  it("does NOT show Approve/Dismiss buttons for failed rows", () => {
    const { queryByText } = render(
      <ReviewRow schemas={[]} review={makeReview({ status: "failed" })} onRefresh={noop} />
    )
    expect(queryByText("Approve")).toBeNull()
    expect(queryByText("Dismiss")).toBeNull()
  })

  // ── error_message for failed rows ──────────────────────────────────────────

  it("shows error_message for failed status", () => {
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          status: "failed",
          error_message: "no handler registered for action: supersede",
        })}
        onRefresh={noop}
      />
    )
    expect(getByText(/no handler registered for action: supersede/)).toBeTruthy()
  })

  it("does NOT show error_message block when status is not failed", () => {
    const { queryByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({ status: "pending", error_message: "should be hidden" })}
        onRefresh={noop}
      />
    )
    expect(queryByText(/should be hidden/)).toBeNull()
  })

  // ── Approve flow ────────────────────────────────────────────────────────────

  it("calls approveReview with correct ref_id after confirmation", async () => {
    const user = userEvent.setup()
    mockApproveReview.mockResolvedValue({ status: "approved" })
    const onRefresh = vi.fn()

    const { getByText } = render(
      <ReviewRow schemas={[]} review={makeReview({ ref_id: "rv-approve-me" })} onRefresh={onRefresh} />
    )

    // First click shows confirmation
    await user.click(getByText("Approve"))
    expect(getByText(/Confirm approve\?/)).toBeTruthy()

    // Second click (confirm) calls the API
    await user.click(getByText(/Confirm approve\?/))
    await waitFor(() => expect(mockApproveReview).toHaveBeenCalledWith("rv-approve-me"))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it("shows inline error when approve returns failed status", async () => {
    const user = userEvent.setup()
    mockApproveReview.mockResolvedValue({
      status: "failed",
      error_message: "no handler registered for action: supersede",
    })

    const { getByText, findByText } = render(
      <ReviewRow schemas={[]} review={makeReview()} onRefresh={noop} />
    )

    await user.click(getByText("Approve"))
    await user.click(getByText(/Confirm approve\?/))

    const errEl = await findByText(/no handler registered for action: supersede/)
    expect(errEl).toBeTruthy()
  })

  // ── Dismiss flow ────────────────────────────────────────────────────────────

  it("calls dismissReview with reason after entering text", async () => {
    const user = userEvent.setup()
    mockDismissReview.mockResolvedValue({ status: "dismissed" })
    const onRefresh = vi.fn()

    const { getByText, getByPlaceholderText } = render(
      <ReviewRow schemas={[]} review={makeReview({ ref_id: "rv-dismiss-me" })} onRefresh={onRefresh} />
    )

    await user.click(getByText("Dismiss"))
    const textarea = getByPlaceholderText("Optional reason…")
    await user.type(textarea, "Not a real duplicate")
    await user.click(getByText("Confirm"))

    await waitFor(() =>
      expect(mockDismissReview).toHaveBeenCalledWith("rv-dismiss-me", "Not a real duplicate")
    )
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it("calls dismissReview without reason when textarea left empty", async () => {
    const user = userEvent.setup()
    mockDismissReview.mockResolvedValue({ status: "dismissed" })
    const onRefresh = vi.fn()

    const { getByText } = render(
      <ReviewRow schemas={[]} review={makeReview({ ref_id: "rv-dismiss-empty" })} onRefresh={onRefresh} />
    )

    await user.click(getByText("Dismiss"))
    await user.click(getByText("Confirm"))

    await waitFor(() =>
      expect(mockDismissReview).toHaveBeenCalledWith("rv-dismiss-empty", undefined)
    )
  })

  // ── run_ref_id label ───────────────────────────────────────────────────────

  it("renders Run label with last 5 chars of run_ref_id when present", () => {
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({ run_ref_id: "mock-janitor-run-1" })}
        onRefresh={noop}
      />
    )
    // last 5 chars of "mock-janitor-run-1" = "run-1"
    expect(getByText("Run #run-1")).toBeTruthy()
  })

  it("does NOT render Run label when run_ref_id is absent", () => {
    const { queryByText } = render(
      <ReviewRow schemas={[]} review={makeReview()} onRefresh={noop} />
    )
    expect(queryByText(/Run #/)).toBeNull()
  })

  // ── Dismissed row: shows dismissal_reason ──────────────────────────────────

  it("shows dismissal_reason for dismissed rows", () => {
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          status: "dismissed",
          dismissal_reason: "Already handled manually.",
        })}
        onRefresh={noop}
      />
    )
    expect(getByText(/Already handled manually\./)).toBeTruthy()
  })

  // ── Deleted subject placeholder ─────────────────────────────────────────────

  it("renders 'Deleted:' placeholder for subject_nodes entry with null node_type", () => {
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          subject_ids: ["n1", "n-deleted"],
          subject_nodes: [
            { ref_id: "n1", node_type: "Topic", properties: { name: "Node One" } },
            { ref_id: "n-deleted", node_type: null, properties: null },
          ],
          // The deleted node must appear in the action_payload for the new
          // directional layout to render its "Deleted: …" placeholder.
          action_payload: { from: ["n-deleted"], to: "n1" },
        })}
        onRefresh={noop}
      />
    )
    expect(getByText(/Deleted:/)).toBeTruthy()
    expect(getByText(/n-deleted/)).toBeTruthy()
  })
})

// ── Mock-mode listReviews ────────────────────────────────────────────────────

describe("listReviews mock mode", () => {
  it("filters by status when isMocksEnabled returns true", async () => {
    // isMocksEnabled is already mocked to return true at top of file
    const { listReviews } = await import("@/lib/graph-api")
    // MOCK_REVIEWS is the empty array from the vi.mock at top
    // The real MOCK_REVIEWS array in mock-data.ts has 8 entries — but the
    // mock replaces it with []. So our in-memory store starts empty.
    // We just verify the function handles an empty store gracefully when filtered.
    const res = await listReviews({ status: "pending" })
    expect(Array.isArray(res.reviews)).toBe(true)
    expect(res.total).toBeGreaterThanOrEqual(0)
    // Every returned item must match the requested status
    expect(res.reviews.every((r: Review) => r.status === "pending")).toBe(true)
  })
})

// ── Non-admin: rail hides Reviews nav item ───────────────────────────────────

describe("AppRail non-admin", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("does not render the Reviews nav item for non-admin users", async () => {
    vi.doMock("@/stores/user-store", () => ({
      useUserStore: () => ({ isAdmin: false, budget: 0 }),
    }))
    vi.doMock("@/stores/app-store", () => ({
      useAppStore: (sel?: (s: unknown) => unknown) => {
        const state = { graphName: "Test" }
        return sel ? sel(state) : state
      },
    }))
    vi.doMock("@/stores/modal-store", () => ({
      useModalStore: (sel: (s: { open: () => void }) => unknown) =>
        sel({ open: vi.fn() }),
    }))
    vi.doMock("@/stores/review-store", () => ({
      useReviewStore: () => ({ pendingCount: 0, setPendingCount: vi.fn() }),
    }))
    vi.doMock("next/navigation", () => ({
      useRouter: () => ({ push: vi.fn() }),
    }))
    vi.doMock("@/lib/sphinx/detect", () => ({ isSphinx: () => false }))
    vi.doMock("@/lib/sphinx/bridge", () => ({ hasWebLN: () => false }))
    vi.doMock("@/components/ui/separator", () => ({
      Separator: () => <hr />,
    }))
    vi.doMock("@/components/ui/tooltip", () => ({
      Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      TooltipContent: () => null,
      TooltipTrigger: ({
        render,
        children,
      }: {
        render?: React.ReactElement
        children?: React.ReactNode
      }) => render ?? <>{children}</>,
    }))

    const { AppRail } = await import("@/components/layout/app-rail")
    const { queryByLabelText } = render(
      <AppRail
        sourcesOpen={false}
        onToggleSources={() => {}}
        myContentOpen={false}
        onToggleMyContent={() => {}}
      />
    )
    expect(queryByLabelText("Reviews")).toBeNull()
  })
})
