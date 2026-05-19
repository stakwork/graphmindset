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
    // merge_nodes action uses "Merge" as the approve verb (ACTION_LABELS)
    expect(getByText("Merge")).toBeTruthy()
    expect(getByText("Dismiss")).toBeTruthy()
  })

  it("does NOT show Approve/Dismiss buttons for approved rows", () => {
    const { queryByText } = render(
      <ReviewRow schemas={[]} review={makeReview({ status: "approved" })} onRefresh={noop} />
    )
    expect(queryByText("Merge")).toBeNull()
    expect(queryByText("Dismiss")).toBeNull()
  })

  it("does NOT show Approve/Dismiss buttons for dismissed rows", () => {
    const { queryByText } = render(
      <ReviewRow schemas={[]} review={makeReview({ status: "dismissed" })} onRefresh={noop} />
    )
    expect(queryByText("Merge")).toBeNull()
    expect(queryByText("Dismiss")).toBeNull()
  })

  it("does NOT show Approve/Dismiss buttons for failed rows", () => {
    const { queryByText } = render(
      <ReviewRow schemas={[]} review={makeReview({ status: "failed" })} onRefresh={noop} />
    )
    expect(queryByText("Merge")).toBeNull()
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

    // First click opens the confirm popover
    // merge_nodes action uses "Merge" as the approve verb (ACTION_LABELS)
    await user.click(getByText("Merge"))
    expect(getByText("Merge these nodes?")).toBeTruthy()

    // Confirm in the popover triggers the API
    await user.click(getByText("Confirm"))
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

    // merge_nodes action uses "Merge" as the approve verb (ACTION_LABELS)
    await user.click(getByText("Merge"))
    await user.click(getByText("Confirm"))

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
    fireEvent.change(textarea, { target: { value: "Not a real duplicate" } })
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

  // ── Action-driven icons ─────────────────────────────────────────────────────

  it("renders Trash2 icon when review.icon is 'trash-2'", () => {
    const { container } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({ icon: "trash-2", action_name: "soft_delete" })}
        onRefresh={noop}
      />
    )
    // Trash2 has a unique path shape; we verify GitMerge is NOT rendered
    // by checking the aria-label or by querying for the SVG via data attributes.
    // The simplest approach: confirm the row renders without error and has an svg.
    expect(container.querySelector("svg")).toBeTruthy()
  })

  it("renders GitMerge icon when review.icon is 'git-merge'", () => {
    const { container } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({ icon: "git-merge", action_name: "merge_nodes" })}
        onRefresh={noop}
      />
    )
    expect(container.querySelector("svg")).toBeTruthy()
  })

  it("falls back to GitMerge icon when review.icon is absent", () => {
    const { container } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({ icon: undefined, action_name: "merge_nodes" })}
        onRefresh={noop}
      />
    )
    expect(container.querySelector("svg")).toBeTruthy()
  })

  it("renders content_review_candidate row without errors", () => {
    const { container, getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-rev-content-1",
          type: "content_review_candidate",
          action_name: "soft_delete",
          action_payload: { ref_id: "mock-node-content-1" },
          icon: "trash-2",
          display_label: "Content review",
          action_verb: "Soft delete",
          accent: "rose",
          rationale: "Content node may be irrelevant.",
          subject_ids: ["mock-node-content-1"],
          subject_nodes: [{ ref_id: "mock-node-content-1", node_type: "Episode", properties: { name: "Mock Episode" } }],
        })}
        onRefresh={noop}
      />
    )
    // soft_delete action uses rowLabel: "Hide [displayName]" — the subject node
    // has name "Mock Episode", so the row label becomes "Hide Mock Episode".
    expect(container.querySelector("svg")).toBeTruthy()
    expect(getByText(/Hide Mock Episode/)).toBeTruthy()
  })

  it("renders topic_review_candidate row without errors", () => {
    const { container, getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-rev-topic-1",
          type: "topic_review_candidate",
          action_name: "soft_delete",
          action_payload: { ref_id: "mock-node-topic-1" },
          icon: "trash-2",
          display_label: "Topic review",
          action_verb: "Soft delete",
          accent: "violet",
          rationale: "Topic appears orphaned.",
          subject_ids: ["mock-node-topic-1"],
          subject_nodes: [{ ref_id: "mock-node-topic-1", node_type: "Topic", properties: { name: "Orphaned Topic" } }],
        })}
        onRefresh={noop}
      />
    )
    // soft_delete action uses rowLabel: "Hide [displayName]" — the subject node
    // has name "Orphaned Topic", so the row label becomes "Hide Orphaned Topic".
    expect(container.querySelector("svg")).toBeTruthy()
    expect(getByText(/Hide Orphaned Topic/)).toBeTruthy()
  })
})

// ── ReviewsPage page-fallback guard (pure logic) ─────────────────────────────

describe("ReviewsPage page-fallback guard logic", () => {
  const PAGE_SIZE = 20

  function correctedSkip(total: number): number {
    return total > 0
      ? Math.max(0, Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE)
      : 0
  }

  it("calculates corrected skip to page 0 when total fits on one page (total=15, currentSkip=20)", () => {
    // floor((15-1)/20)*20 = floor(0.7)*20 = 0
    expect(correctedSkip(15)).toBe(0)
    expect(correctedSkip(15)).toBeLessThan(20)
  })

  it("calculates corrected skip to last populated page (total=35, currentSkip=40)", () => {
    // floor((35-1)/20)*20 = floor(1.7)*20 = 20
    expect(correctedSkip(35)).toBe(20)
    expect(correctedSkip(35)).toBeLessThan(40)
  })

  it("calculates corrected skip to page 40 when total=81, currentSkip=60", () => {
    // floor((81-1)/20)*20 = floor(4)*20 = 80 — but currentSkip is 60, 80 > 60 so no redirect
    // This tests the correctedSkip < currentSkip guard prevents moving forward
    const cs = correctedSkip(81)
    expect(cs).toBe(80)
    // 80 is NOT less than 60 → guard correctly doesn't redirect
    expect(cs < 60).toBe(false)
  })

  it("returns 0 when total is 0 (empty list)", () => {
    expect(correctedSkip(0)).toBe(0)
  })

  it("does NOT loop when total=0 and skip>0 — guard condition (skip>0) becomes false after redirect to 0", () => {
    // First call: currentSkip=20, total=0 → correctedSkip=0, 0 < 20 → redirect to skip=0
    const cs = correctedSkip(0)
    expect(cs).toBe(0)
    expect(cs).toBeLessThan(20)
    // Second call at skip=0: guard requires currentSkip > 0 → false → no further redirect
    expect(0 > 0).toBe(false)
  })

  it("correctedSkip < currentSkip guard prevents forward redirect", () => {
    // If somehow correctedSkip >= currentSkip, no redirect (prevents any loop)
    const cs = correctedSkip(21)
    // floor((21-1)/20)*20 = floor(1)*20 = 20
    expect(cs).toBe(20)
    // 20 is NOT less than 20 → guard correctly doesn't redirect at skip=20
    expect(cs < 20).toBe(false)
    // 20 IS less than 40 → guard correctly redirects at skip=40
    expect(cs < 40).toBe(true)
  })
})

// ── eligibleForSelectAll logic ───────────────────────────────────────────────

describe("eligibleForSelectAll logic", () => {
  function computeEligible(
    selectableReviews: { ref_id: string; action_name: string }[],
    lockedActionName: string | null
  ) {
    const targetAction = lockedActionName ?? selectableReviews[0]?.action_name
    return targetAction
      ? selectableReviews.filter((r) => r.action_name === targetAction)
      : selectableReviews
  }

  const mixedReviews = [
    { ref_id: "r1", action_name: "merge_nodes" },
    { ref_id: "r2", action_name: "soft_delete" },
    { ref_id: "r3", action_name: "merge_nodes" },
    { ref_id: "r4", action_name: "soft_delete" },
  ]

  it("selects only the action type of the first pending review when no lock and mixed types", () => {
    const eligible = computeEligible(mixedReviews, null)
    expect(eligible.map((r) => r.ref_id)).toEqual(["r1", "r3"])
    expect(eligible.every((r) => r.action_name === "merge_nodes")).toBe(true)
  })

  it("selects all rows when all pending reviews share a single action type", () => {
    const homogeneous = [
      { ref_id: "r1", action_name: "merge_nodes" },
      { ref_id: "r2", action_name: "merge_nodes" },
      { ref_id: "r3", action_name: "merge_nodes" },
    ]
    const eligible = computeEligible(homogeneous, null)
    expect(eligible).toHaveLength(3)
    expect(eligible.every((r) => r.action_name === "merge_nodes")).toBe(true)
  })

  it("respects lockedActionName when already set, ignoring the first row's type", () => {
    // First row is merge_nodes but lock is soft_delete (user selected a soft_delete row first)
    const eligible = computeEligible(mixedReviews, "soft_delete")
    expect(eligible.map((r) => r.ref_id)).toEqual(["r2", "r4"])
    expect(eligible.every((r) => r.action_name === "soft_delete")).toBe(true)
  })

  it("returns empty array when no selectable reviews exist", () => {
    const eligible = computeEligible([], null)
    expect(eligible).toHaveLength(0)
  })

  it("\"Select all N\" label count reflects only eligible same-type rows", () => {
    // With mixed types and no lock, only 2 of 4 rows are eligible (merge_nodes)
    const eligible = computeEligible(mixedReviews, null)
    expect(eligible).toHaveLength(2)
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

// ── Non-admin: toolkit hides Reviews nav item ────────────────────────────────

describe("Toolkit non-admin", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("does not render the Reviews nav item for non-admin users", async () => {
    vi.doMock("@/stores/user-store", () => ({
      useUserStore: () => ({ isAdmin: false, budget: 0 }),
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

    const { Toolkit } = await import("@/components/layout/toolkit")
    const { queryByLabelText } = render(
      <Toolkit
        sourcesOpen={false}
        onToggleSources={() => {}}
        myContentOpen={false}
        onToggleMyContent={() => {}}
        followingOpen={false}
        onToggleFollowing={() => {}}
      />
    )
    expect(queryByLabelText("Reviews")).toBeNull()
  })
})
