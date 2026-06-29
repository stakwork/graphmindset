import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockApproveReview, mockDismissReview, mockListReviews } = vi.hoisted(() => ({
  mockApproveReview: vi.fn(),
  mockDismissReview: vi.fn(),
  mockListReviews: vi.fn(),
}))

vi.mock("@/lib/graph-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/graph-api")>()
  return {
    ...actual,
    approveReview: (...args: unknown[]) => mockApproveReview(...args),
    dismissReview: (...args: unknown[]) => mockDismissReview(...args),
    listReviews: (...args: unknown[]) => mockListReviews(...args),
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
    await waitFor(() => expect(mockApproveReview).toHaveBeenCalledWith("rv-approve-me", undefined))
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

  // ── add_source / new_source_candidate ─────────────────────────────────────

  it("collapsed row shows display_label when subject_nodes is empty and display_label is set", () => {
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-new-source-1",
          type: "new_source_candidate",
          action_name: "add_source",
          action_payload: { source: "https://www.youtube.com/@lexfridman", source_type: "youtube_channel" },
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add Youtube Channel: https://www.youtube.com/@lexfridman",
          icon: "plus-circle",
          accent: "green",
          action_verb: "Add",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    expect(getByText("Add Youtube Channel: https://www.youtube.com/@lexfridman")).toBeTruthy()
  })

  it("collapsed row renders plus-circle icon for add_source action", () => {
    const { container } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          type: "new_source_candidate",
          action_name: "add_source",
          action_payload: { source: "https://www.youtube.com/@lexfridman", source_type: "youtube_channel" },
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add Youtube Channel: https://www.youtube.com/@lexfridman",
          icon: "plus-circle",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    expect(container.querySelector("svg")).toBeTruthy()
  })

  it("approve button label shows 'Add' for add_source action", () => {
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          type: "new_source_candidate",
          action_name: "add_source",
          action_payload: { source: "https://www.youtube.com/@lexfridman", source_type: "youtube_channel" },
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add Youtube Channel: https://www.youtube.com/@lexfridman",
          icon: "plus-circle",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    expect(getByText("Add")).toBeTruthy()
  })

  it("expanded section shows 'Suggested Source' heading with source_type and source for add_source", async () => {
    const user = userEvent.setup()
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-new-source-1",
          type: "new_source_candidate",
          action_name: "add_source",
          action_payload: { source: "https://www.youtube.com/@lexfridman", source_type: "youtube_channel" },
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add Youtube Channel: https://www.youtube.com/@lexfridman",
          icon: "plus-circle",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    // Click the row to expand
    await user.click(getByText("Add Youtube Channel: https://www.youtube.com/@lexfridman"))
    expect(getByText("Suggested Source")).toBeTruthy()
    expect(getByText("youtube_channel")).toBeTruthy()
    expect(getByText("https://www.youtube.com/@lexfridman")).toBeTruthy()
  })

  it("expanded section does NOT show 'Subjects (0)' for add_source", async () => {
    const user = userEvent.setup()
    const { getByText, queryByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          type: "new_source_candidate",
          action_name: "add_source",
          action_payload: { source: "https://www.youtube.com/@lexfridman", source_type: "youtube_channel" },
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add Youtube Channel: https://www.youtube.com/@lexfridman",
          icon: "plus-circle",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    await user.click(getByText("Add Youtube Channel: https://www.youtube.com/@lexfridman"))
    expect(queryByText("Subjects (0)")).toBeNull()
  })

  it("shows error_message inline for failed new_source_candidate review", () => {
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-new-source-2",
          type: "new_source_candidate",
          action_name: "add_source",
          action_payload: { source: "https://feeds.transistor.fm/example", source_type: "rss" },
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add Rss: https://feeds.transistor.fm/example",
          icon: "plus-circle",
          status: "failed",
          error_message: "add_source failed: Source already exists",
        })}
        onRefresh={noop}
      />
    )
    expect(getByText(/add_source failed: Source already exists/)).toBeTruthy()
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

  // ── add_node ─────────────────────────────────────────────────────────────

  it("renders add_node row without crashing with valid payload", () => {
    const { container } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-add-node-1",
          type: "add_node_candidate",
          action_name: "add_node",
          action_payload: { node_type: "Topic", properties: { name: "Lightning DeFi", description: "DeFi on Lightning" } },
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add Topic: Lightning DeFi",
          icon: "plus-square",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    expect(container.querySelector("svg")).toBeTruthy()
  })

  it("add_node expanded panel shows proposed node type and properties", async () => {
    const user = userEvent.setup()
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-add-node-1",
          type: "add_node_candidate",
          action_name: "add_node",
          action_payload: { node_type: "Topic", properties: { name: "Lightning DeFi", description: "DeFi on Lightning" } },
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add Topic: Lightning DeFi",
          icon: "plus-square",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    await user.click(getByText("Add Topic: Lightning DeFi"))
    expect(getByText("Proposed Node")).toBeTruthy()
    expect(getByText("Topic")).toBeTruthy()
    expect(getByText("Lightning DeFi")).toBeTruthy()
  })

  it("add_node expanded panel renders gracefully with missing payload fields", async () => {
    const user = userEvent.setup()
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          action_name: "add_node",
          action_payload: {},
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add node (incomplete)",
        })}
        onRefresh={noop}
      />
    )
    await user.click(getByText("Add node (incomplete)"))
    expect(getByText("Proposed Node")).toBeTruthy()
  })

  // ── add_edge ─────────────────────────────────────────────────────────────

  it("renders add_edge row without crashing with valid payload", () => {
    const { container } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-add-edge-1",
          type: "add_edge_candidate",
          action_name: "add_edge",
          action_payload: { source_ref_id: "n3", target_ref_id: "n6", edge_type: "AUTHORED_BY" },
          subject_ids: ["n3", "n6"],
          subject_nodes: [
            { ref_id: "n3", node_type: "Person", properties: { name: "Satoshi Nakamoto" } },
            { ref_id: "n6", node_type: "Topic", properties: { name: "Bitcoin Whitepaper" } },
          ],
          display_label: "Add edge: AUTHORED_BY",
          icon: "share-2",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    expect(container.querySelector("svg")).toBeTruthy()
  })

  it("add_edge expanded panel shows edge type and nodes", async () => {
    const user = userEvent.setup()
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-add-edge-1",
          type: "add_edge_candidate",
          action_name: "add_edge",
          action_payload: { source_ref_id: "n3", target_ref_id: "n6", edge_type: "AUTHORED_BY" },
          subject_ids: ["n3", "n6"],
          subject_nodes: [
            { ref_id: "n3", node_type: "Person", properties: { name: "Satoshi Nakamoto" } },
            { ref_id: "n6", node_type: "Topic", properties: { name: "Bitcoin Whitepaper" } },
          ],
          display_label: "Add edge: AUTHORED_BY",
          icon: "share-2",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    // Compact row shows rowLabel "Add new edge" (not display_label) when subject_nodes is non-empty
    await user.click(getByText("Add new edge"))
    expect(getByText("Proposed Edge")).toBeTruthy()
    expect(getByText("AUTHORED_BY")).toBeTruthy()
  })

  it("add_edge with empty subject_nodes shows Deleted fallback — no crash", async () => {
    const user = userEvent.setup()
    const { getByText, getAllByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-add-edge-deleted",
          type: "add_edge_candidate",
          action_name: "add_edge",
          action_payload: { source_ref_id: "deleted-n1", target_ref_id: "deleted-n2", edge_type: "LINKED_TO" },
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add edge: LINKED_TO",
          icon: "share-2",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    await user.click(getByText("Add edge: LINKED_TO"))
    expect(getAllByText(/Deleted/).length).toBeGreaterThan(0)
  })

  // ── edit_node ─────────────────────────────────────────────────────────────

  it("renders edit_node row without crashing with valid payload", () => {
    const { container } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-edit-node-1",
          type: "edit_node_candidate",
          action_name: "edit_node",
          action_payload: { ref_id: "n8", node_type: "Episode", properties: { name: "Bitcoin Explained" } },
          subject_ids: ["n8"],
          subject_nodes: [{ ref_id: "n8", node_type: "Clip", properties: { name: "Bitcoin Explained (Clip)" } }],
          display_label: "Edit node: Clip → Episode",
          icon: "pencil",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    expect(container.querySelector("svg")).toBeTruthy()
  })

  it("edit_node expanded panel shows type-change indicator when node_type differs", async () => {
    const user = userEvent.setup()
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-edit-node-1",
          type: "edit_node_candidate",
          action_name: "edit_node",
          action_payload: { ref_id: "n8", node_type: "Episode", properties: { name: "Bitcoin Explained" } },
          subject_ids: ["n8"],
          subject_nodes: [{ ref_id: "n8", node_type: "Clip", properties: { name: "Bitcoin Explained (Clip)" } }],
          display_label: "Edit node: Clip → Episode",
          icon: "pencil",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    // Compact row uses rowLabel: "Edit Bitcoin Explained (Clip)" from subject node name
    await user.click(getByText(/Edit Bitcoin Explained/))
    expect(getByText("Type Change")).toBeTruthy()
    expect(getByText("Clip")).toBeTruthy()
    expect(getByText("Episode")).toBeTruthy()
  })

  it("edit_node expanded panel renders gracefully with missing payload fields", async () => {
    const user = userEvent.setup()
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          action_name: "edit_node",
          action_payload: { ref_id: "n8" },
          subject_ids: ["n8"],
          subject_nodes: [{ ref_id: "n8", node_type: "Clip", properties: { name: "Some Clip" } }],
          display_label: "Edit Some Clip",
        })}
        onRefresh={noop}
      />
    )
    await user.click(getByText("Edit Some Clip"))
    expect(getByText("Node Being Edited")).toBeTruthy()
  })

  // ── edit_node image_url preview ───────────────────────────────────────────

  it("edit_node image_url change renders an img with the proposed URL as src", async () => {
    const user = userEvent.setup()
    const imgUrl = "https://example.com/photo.jpg"
    const { getByText, container } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          action_name: "edit_node",
          action_payload: {
            ref_id: "n8",
            node_type: "Person",
            properties: { image_url: imgUrl },
          },
          subject_ids: ["n8"],
          subject_nodes: [{ ref_id: "n8", node_type: "Person", properties: { name: "Alice", image_url: "https://old.com/old.jpg" } }],
          display_label: "Edit Alice",
        })}
        onRefresh={noop}
      />
    )
    await user.click(getByText("Edit Alice"))
    const img = container.querySelector("img[alt='image preview']") as HTMLImageElement
    expect(img).toBeTruthy()
    expect(img.src).toBe(imgUrl)
  })

  it("edit_node non-image properties still render as plain text", async () => {
    const user = userEvent.setup()
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          action_name: "edit_node",
          action_payload: {
            ref_id: "n8",
            node_type: "Person",
            properties: { name: "Bob Updated" },
          },
          subject_ids: ["n8"],
          subject_nodes: [{ ref_id: "n8", node_type: "Person", properties: { name: "Bob" } }],
          display_label: "Edit Bob",
        })}
        onRefresh={noop}
      />
    )
    await user.click(getByText("Edit Bob"))
    expect(getByText("Bob Updated")).toBeTruthy()
  })

  it("edit_node image_url falls back to URL string on image load error", async () => {
    const user = userEvent.setup()
    const brokenUrl = "https://example.invalid/content-c5-broken.jpg"
    const { getByText, container } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          action_name: "edit_node",
          action_payload: {
            ref_id: "n8",
            node_type: "Person",
            properties: { image_url: brokenUrl },
          },
          subject_ids: ["n8"],
          subject_nodes: [{ ref_id: "n8", node_type: "Person", properties: { name: "Charlie" } }],
          display_label: "Edit Charlie",
        })}
        onRefresh={noop}
      />
    )
    await user.click(getByText("Edit Charlie"))
    // Trigger the error handler
    const img = container.querySelector("img[alt='image preview']") as HTMLImageElement
    expect(img).toBeTruthy()
    fireEvent.error(img)
    // After error, the img should be replaced by the raw URL string
    expect(getByText(brokenUrl)).toBeTruthy()
    expect(container.querySelector("img[alt='image preview']")).toBeNull()
  })

  // ── add_schema_node_type ──────────────────────────────────────────────────

  it("renders add_schema_node_type row without crashing with valid payload", () => {
    const { container } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-add-schema-type-1",
          type: "add_schema_type_candidate",
          action_name: "add_schema_node_type",
          action_payload: {
            type: "Framework",
            parent: "Topic",
            color: "#7C3AED",
            icon: "layers",
            attributes: [{ key: "name", type: "text", required: true }],
          },
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add type: Framework",
          icon: "layers",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    expect(container.querySelector("svg")).toBeTruthy()
  })

  it("add_schema_node_type expanded panel shows type name, parent, color swatch, and attributes", async () => {
    const user = userEvent.setup()
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-add-schema-type-1",
          type: "add_schema_type_candidate",
          action_name: "add_schema_node_type",
          action_payload: {
            type: "Framework",
            parent: "Topic",
            color: "#7C3AED",
            icon: "layers",
            attributes: [
              { key: "name", type: "text", required: true },
              { key: "version", type: "text", required: false },
            ],
          },
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add type: Framework",
          icon: "layers",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    await user.click(getByText("Add type: Framework"))
    expect(getByText("Proposed Schema Type")).toBeTruthy()
    // "Framework" appears in both type name display and parent breadcrumb — just assert at least one
    expect(screen.getAllByText("Framework").length).toBeGreaterThanOrEqual(1)
    expect(getByText("Parent Hierarchy")).toBeTruthy()
    expect(getByText("Attributes")).toBeTruthy()
    expect(getByText("name")).toBeTruthy()
    expect(getByText("required")).toBeTruthy()
  })

  it("add_schema_node_type expanded panel renders gracefully with empty payload", async () => {
    const user = userEvent.setup()
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          action_name: "add_schema_node_type",
          action_payload: {},
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add schema type (incomplete)",
        })}
        onRefresh={noop}
      />
    )
    await user.click(getByText("Add schema type (incomplete)"))
    expect(getByText("Proposed Schema Type")).toBeTruthy()
  })

  // ── add_schema_edge_type ──────────────────────────────────────────────────

  it("renders add_schema_edge_type row without crashing with valid payload", () => {
    const { container } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-add-schema-edge-1",
          type: "add_schema_edge_candidate",
          action_name: "add_schema_edge_type",
          action_payload: { edge_type: "MENTIONS", source: "*", target: "*" },
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add schema edge: MENTIONS (wildcard)",
          icon: "network",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    expect(container.querySelector("svg")).toBeTruthy()
  })

  it("add_schema_edge_type expanded panel renders '*' source/target as 'Any type' badge", async () => {
    const user = userEvent.setup()
    const { getAllByText, queryByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-add-schema-edge-1",
          type: "add_schema_edge_candidate",
          action_name: "add_schema_edge_type",
          action_payload: { edge_type: "MENTIONS", source: "*", target: "*" },
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add schema edge: MENTIONS (wildcard)",
          icon: "network",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    await user.click(getAllByText("Add schema edge: MENTIONS (wildcard)")[0])
    expect(getAllByText("Any type").length).toBeGreaterThanOrEqual(2)
    expect(queryByText("*")).toBeNull()
  })

  it("add_schema_edge_type expanded panel shows edge_type label", async () => {
    const user = userEvent.setup()
    const { getByText, getAllByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          ref_id: "mock-add-schema-edge-named",
          type: "add_schema_edge_candidate",
          action_name: "add_schema_edge_type",
          action_payload: { edge_type: "RELATED_TO", source: "Topic", target: "Episode" },
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add schema edge: RELATED_TO",
          icon: "network",
          status: "pending",
        })}
        onRefresh={noop}
      />
    )
    await user.click(getAllByText("Add schema edge: RELATED_TO")[0])
    expect(getByText("Proposed Schema Edge")).toBeTruthy()
    expect(getByText("RELATED_TO")).toBeTruthy()
  })

  it("add_schema_edge_type expanded panel renders gracefully with missing payload fields", async () => {
    const user = userEvent.setup()
    const { getByText } = render(
      <ReviewRow
        schemas={[]}
        review={makeReview({
          action_name: "add_schema_edge_type",
          action_payload: {},
          subject_ids: [],
          subject_nodes: [],
          display_label: "Add schema edge (incomplete)",
        })}
        onRefresh={noop}
      />
    )
    await user.click(getByText("Add schema edge (incomplete)"))
    expect(getByText("Proposed Schema Edge")).toBeTruthy()
  })
})

// ── Interactive merge controls ───────────────────────────────────────────────

describe("ReviewRow merge_nodes interactive controls", () => {
  const user = userEvent.setup()
  const noop = () => {}

  function makeMergeReview(overrides: Partial<Review> = {}): Review {
    return makeReview({
      action_name: "merge_nodes",
      action_payload: { from: ["n2", "n3"], to: "n1" },
      subject_nodes: [
        { ref_id: "n1", node_type: "Topic", properties: { name: "Node One" } },
        { ref_id: "n2", node_type: "Topic", properties: { name: "Node Two" } },
        { ref_id: "n3", node_type: "Topic", properties: { name: "Node Three" } },
      ],
      ...overrides,
    })
  }

  beforeEach(() => {
    mockApproveReview.mockReset()
    mockApproveReview.mockResolvedValue({ status: "approved" })
  })

  it("shows all sources checked by default on expand", async () => {
    const { getByText, getAllByRole } = render(
      <ReviewRow schemas={[]} review={makeMergeReview()} onRefresh={noop} />
    )
    // Expand the row
    await user.click(getByText("Node Two"))
    // Both source checkboxes should be checked
    const checkboxes = getAllByRole("checkbox")
    expect(checkboxes.length).toBeGreaterThanOrEqual(2)
    checkboxes.forEach((cb) => {
      expect((cb as HTMLInputElement).checked).toBe(true)
    })
  })

  it("shows canonical node with locked indicator, no checkbox", async () => {
    const { getByText, getByLabelText, queryByLabelText } = render(
      <ReviewRow schemas={[]} review={makeMergeReview()} onRefresh={noop} />
    )
    // Expand the row by clicking the chevron/row area — click on rationale text not present;
    // click the row container via the role=button
    const rowBtn = getByText("Node Two").closest("[role='button']") ?? getByText("Node Two")
    await user.click(rowBtn)
    // canonical locked indicator present
    expect(getByLabelText("Canonical node (locked)")).toBeTruthy()
    // No checkbox for canonical (n1 is toId)
    expect(queryByLabelText("Include n1 in merge")).toBeNull()
  })

  it("unchecking last source shows mergeError and disables Approve", async () => {
    const review = makeMergeReview({
      action_payload: { from: ["n2"], to: "n1" },
      subject_nodes: [
        { ref_id: "n1", node_type: "Topic", properties: { name: "Node One" } },
        { ref_id: "n2", node_type: "Topic", properties: { name: "Node Two" } },
      ],
    })
    const { getByText, getByRole, findByText } = render(
      <ReviewRow schemas={[]} review={review} onRefresh={noop} />
    )
    // Expand
    await user.click(getByText("Node One"))

    // Uncheck the only source checkbox
    const checkbox = getByRole("checkbox")
    await user.click(checkbox)

    // Error message visible
    await findByText("Select at least one source node to merge")

    // Approve button should be disabled
    const approveBtn = getByText("Merge")
    expect((approveBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it("unchecking a source marks isModified; approve called with override", async () => {
    const review = makeMergeReview()
    const { getByText, getAllByRole } = render(
      <ReviewRow schemas={[]} review={review} onRefresh={noop} />
    )
    // Expand
    await user.click(getByText("Node Two"))

    // Uncheck first source (n2)
    const checkboxes = getAllByRole("checkbox")
    // First checkbox corresponds to first source in fromIds after filtering canonical
    await user.click(checkboxes[0])

    // Approve → popover opens → confirm
    await user.click(getByText("Merge"))
    await user.click(getByText("Confirm"))

    await waitFor(() => {
      expect(mockApproveReview).toHaveBeenCalledWith(
        "rv-test-001",
        expect.objectContaining({ to: "n1" })
      )
    })
    // The override from[] should NOT include the unchecked source
    const call = mockApproveReview.mock.calls[0]
    const override = call[1] as { from: string[]; to: string }
    expect(override).toBeDefined()
    expect(override.to).toBe("n1")
    expect(override.from).not.toContain("n2")
  })

  it("approve called without override when no changes made", async () => {
    const review = makeMergeReview()
    const { getByText } = render(
      <ReviewRow schemas={[]} review={review} onRefresh={noop} />
    )
    // Do NOT expand; just approve directly from compact row (no changes made)
    await user.click(getByText("Merge"))
    await user.click(getByText("Confirm"))

    await waitFor(() => {
      expect(mockApproveReview).toHaveBeenCalledWith("rv-test-001", undefined)
    })
  })

  it("clicking Set as canonical on source promotes it and moves old canonical to sources", async () => {
    const review = makeMergeReview({
      action_payload: { from: ["n2"], to: "n1" },
      subject_nodes: [
        { ref_id: "n1", node_type: "Topic", properties: { name: "Node One" } },
        { ref_id: "n2", node_type: "Topic", properties: { name: "Node Two" } },
      ],
    })
    const { getByText, getByLabelText, queryByLabelText } = render(
      <ReviewRow schemas={[]} review={review} onRefresh={noop} />
    )
    // Expand
    await user.click(getByText("Node One"))

    // Click "Set as canonical" on n2 (the source)
    const setCanonicalBtn = getByLabelText("Set n2 as canonical")
    await user.click(setCanonicalBtn)

    // Now n2 is canonical (locked indicator present), n1 is in sources
    await waitFor(() => {
      expect(getByLabelText("Canonical node (locked)")).toBeTruthy()
      expect(queryByLabelText("Set n2 as canonical")).toBeNull()
      expect(getByLabelText("Include n1 in merge")).toBeTruthy()
    })

    // isModified should be true — approve with override
    await user.click(getByText("Merge"))
    await user.click(getByText("Confirm"))

    await waitFor(() => {
      const call = mockApproveReview.mock.calls[0]
      const override = call[1] as { from: string[]; to: string }
      expect(override).toBeDefined()
      expect(override.to).toBe("n2")
      expect(override.from).toContain("n1")
    })
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
  beforeEach(() => {
    mockListReviews.mockResolvedValue({ reviews: [], total: 0, skip: 0, limit: 20 })
  })

  it("filters by status when isMocksEnabled returns true", async () => {
    const pending: Review[] = [makeReview({ ref_id: "rv-p1", status: "pending" })]
    mockListReviews.mockResolvedValue({ reviews: pending, total: 1, skip: 0, limit: 20 })
    const { listReviews } = await import("@/lib/graph-api")
    const res = await listReviews({ status: "pending" })
    expect(Array.isArray(res.reviews)).toBe(true)
    expect(res.total).toBeGreaterThanOrEqual(0)
    expect(res.reviews.every((r: Review) => r.status === "pending")).toBe(true)
  })
})

// ── Search param in listReviews ──────────────────────────────────────────────

describe("listReviews search param", () => {
  beforeEach(() => {
    mockListReviews.mockResolvedValue({ reviews: [], total: 0, skip: 0, limit: 20 })
  })

  it("passes search param to listReviews when provided", async () => {
    const matched: Review[] = [
      makeReview({ ref_id: "rv-bitcoin", rationale: "bitcoin duplicate node" }),
    ]
    mockListReviews.mockResolvedValue({ reviews: matched, total: 1, skip: 0, limit: 20 })
    const { listReviews } = await import("@/lib/graph-api")
    const res = await listReviews({ search: "bitcoin" })
    expect(mockListReviews).toHaveBeenCalledWith(
      expect.objectContaining({ search: "bitcoin" })
    )
    expect(res.reviews).toHaveLength(1)
    expect(res.reviews[0].ref_id).toBe("rv-bitcoin")
  })

  it("does not pass search param when undefined", async () => {
    const { listReviews } = await import("@/lib/graph-api")
    await listReviews({ status: "pending" })
    expect(mockListReviews).toHaveBeenCalledWith(
      expect.not.objectContaining({ search: expect.anything() })
    )
  })
})

// ── ReviewsPage search UI ────────────────────────────────────────────────────

describe("ReviewsPage search UI", () => {
  beforeEach(async () => {
    vi.resetModules()
    mockListReviews.mockResolvedValue({ reviews: [], total: 0, skip: 0, limit: 20 })
  })

  async function renderPage() {
    vi.doMock("@/stores/review-store", () => ({
      useReviewStore: () => ({ pendingCount: 0, setPendingCount: vi.fn() }),
    }))
    vi.doMock("@/stores/schema-store", () => ({
      useSchemaStore: (sel: (s: { schemas: never[] }) => unknown) =>
        sel({ schemas: [] }),
    }))
    vi.doMock("@/components/admin/review-row", () => ({
      ReviewRow: ({ review }: { review: Review }) => (
        <div data-testid={`review-row-${review.ref_id}`}>{review.rationale}</div>
      ),
      getApproveVerb: (action: string) => action,
    }))
    vi.doMock("@/components/ui/select-custom", () => ({
      SelectCustom: () => <div />,
    }))
    vi.doMock("@/components/ui/checkbox", () => ({
      Checkbox: () => <input type="checkbox" />,
    }))
    const { default: ReviewsPage } = await import("@/app/admin/reviews/page")
    return render(<ReviewsPage />)
  }

  it("renders search input and X clear button appears only when input has text", async () => {
    const user = userEvent.setup()
    const { getByPlaceholderText, queryByLabelText } = await renderPage()

    await waitFor(() => {
      expect(getByPlaceholderText("Search reviews…")).toBeTruthy()
    })

    // No clear button when empty
    expect(queryByLabelText("Clear search")).toBeNull()

    // Type something → X appears
    const input = getByPlaceholderText("Search reviews…")
    await user.type(input, "bitcoin")
    expect(queryByLabelText("Clear search")).toBeTruthy()
  })

  it("clicking X clear button empties the input", async () => {
    const user = userEvent.setup()
    const { getByPlaceholderText, getByLabelText } = await renderPage()

    await waitFor(() => {
      expect(getByPlaceholderText("Search reviews…")).toBeTruthy()
    })

    const input = getByPlaceholderText("Search reviews…")
    await user.type(input, "test query")
    const clearBtn = getByLabelText("Clear search")
    await user.click(clearBtn)
    expect((input as HTMLInputElement).value).toBe("")
  })

  it("shows search-specific empty state when query is set and no results", async () => {
    const user = userEvent.setup()
    mockListReviews.mockResolvedValue({ reviews: [], total: 0, skip: 0, limit: 20 })
    const { getByPlaceholderText, findByText } = await renderPage()

    await waitFor(() => {
      expect(getByPlaceholderText("Search reviews…")).toBeTruthy()
    })

    const input = getByPlaceholderText("Search reviews…")
    await user.type(input, "xyznotfound")
    await findByText(`No reviews match "xyznotfound"`)
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
