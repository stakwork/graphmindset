import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"

import type { SchemaProposal } from "@/lib/graph-api"

const { mockGetSchemaProposal } = vi.hoisted(() => ({
  mockGetSchemaProposal: vi.fn(),
}))

vi.mock("@/lib/graph-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/graph-api")>()
  return {
    ...actual,
    getSchemaProposal: (...args: unknown[]) => mockGetSchemaProposal(...args),
  }
})

import { SchemaPromotionDialog } from "@/components/admin/schema-promotion-dialog"

function makeProposal(overrides: Partial<SchemaProposal> = {}): SchemaProposal {
  return {
    review_ref_id: "rev-1",
    intended_type: "PurchaseOrder",
    status: "pending",
    entry_count: 2,
    entry_ref_ids: ["entry-1", "entry-2"],
    entries: [
      {
        ref_id: "entry-1",
        name: "PO-1",
        intended_type: "PurchaseOrder",
        rejection_reason: "unknown_type",
      },
      {
        ref_id: "entry-2",
        name: "PO-2",
        intended_type: "PurchaseOrder",
        rejection_reason: "unknown_type",
      },
    ],
    edges: [],
    unresolved_subject_ids: [],
    properties: [
      {
        name: "supplier",
        inferred_type: "string",
        present_in: 2,
        suggested_required: true,
        sample: "Acme Corp",
      },
      {
        name: "notes",
        inferred_type: "string",
        present_in: 1,
        suggested_required: false,
        sample: "rush",
      },
    ],
    conflicts: [],
    node_key_candidates: ["supplier"],
    blocked_names: [],
    ...overrides,
  }
}

function renderDialog(
  onConfirm = vi.fn().mockResolvedValue(undefined),
  props: Partial<React.ComponentProps<typeof SchemaPromotionDialog>> = {}
) {
  render(
    <SchemaPromotionDialog
      open
      onOpenChange={vi.fn()}
      reviewRefId="rev-1"
      onConfirm={onConfirm}
      {...props}
    />
  )
  return onConfirm
}

describe("SchemaPromotionDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSchemaProposal.mockResolvedValue(makeProposal())
  })

  it("renders the inferred properties with their samples", async () => {
    renderDialog()
    expect(await screen.findByLabelText("Include supplier")).toBeInTheDocument()
    expect(screen.getByText("notes")).toBeInTheDocument()
    expect(screen.getByText("Acme Corp")).toBeInTheDocument()
  })

  it("shows how many entries supplied a partially-present property", async () => {
    renderDialog()
    expect(await screen.findByText("in 1/2")).toBeInTheDocument()
  })

  it("submits required properties bare and optional ones with a ? prefix", async () => {
    const onConfirm = renderDialog()
    await screen.findByLabelText("Include supplier")

    await userEvent.click(screen.getByTestId("schema-promotion-confirm"))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    const override = onConfirm.mock.calls[0][0]
    expect(override.type).toBe("PurchaseOrder")
    expect(override.attributes).toEqual({
      supplier: "string",
      notes: "?string",
    })
  })

  it("sends the entry ref ids so the entries get promoted", async () => {
    const onConfirm = renderDialog()
    await screen.findByLabelText("Include supplier")

    await userEvent.click(screen.getByTestId("schema-promotion-confirm"))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect(onConfirm.mock.calls[0][0].entries).toEqual(["entry-1", "entry-2"])
  })

  it("prefixes the node_key with the lowercased type", async () => {
    const onConfirm = renderDialog()
    await screen.findByLabelText("Include supplier")

    await userEvent.click(screen.getByTestId("schema-promotion-confirm"))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect(onConfirm.mock.calls[0][0].node_key).toBe("purchaseorder-supplier")
  })

  it("excludes a deselected property from the submitted attributes", async () => {
    const onConfirm = renderDialog()
    await screen.findByLabelText("Include supplier")

    await userEvent.click(screen.getByLabelText("Include notes"))
    await userEvent.click(screen.getByTestId("schema-promotion-confirm"))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect(onConfirm.mock.calls[0][0].attributes).toEqual({
      supplier: "string",
    })
  })

  it("warns that excluded properties are dropped from the replay", async () => {
    renderDialog()
    await screen.findByLabelText("Include supplier")

    await userEvent.click(screen.getByLabelText("Include notes"))

    expect(
      await screen.findByText(/dropped when the parked entries are replayed/i)
    ).toBeInTheDocument()
  })

  it("surfaces type conflicts found across entries", async () => {
    mockGetSchemaProposal.mockResolvedValue(
      makeProposal({
        conflicts: [
          { name: "total", types_seen: ["int", "string"], resolved_to: "string" },
        ],
      })
    )
    renderDialog()
    expect(await screen.findByText(/widened to/i)).toBeInTheDocument()
  })

  it("blocks submission while a reserved name is still in the table", async () => {
    mockGetSchemaProposal.mockResolvedValue(
      makeProposal({
        properties: [
          {
            name: "status",
            inferred_type: "string",
            present_in: 2,
            suggested_required: true,
            sample: "live",
          },
        ],
        blocked_names: [{ name: "status", reason: "reserved" }],
        node_key_candidates: [],
      })
    )
    renderDialog()
    await screen.findByText(/cannot be used/i)

    expect(screen.getByTestId("schema-promotion-confirm")).toBeDisabled()
  })

  it("blocks submission when every property is excluded", async () => {
    renderDialog()
    await screen.findByLabelText("Include supplier")

    await userEvent.click(screen.getByLabelText("Include supplier"))
    await userEvent.click(screen.getByLabelText("Include notes"))

    expect(
      await screen.findByText(/include at least one property/i)
    ).toBeInTheDocument()
    expect(screen.getByTestId("schema-promotion-confirm")).toBeDisabled()
  })

  it("omits node_key when the chosen property is made optional", async () => {
    const onConfirm = renderDialog()
    await screen.findByLabelText("Include supplier")

    // supplier is the node_key candidate; making it optional disqualifies it
    await userEvent.click(screen.getByLabelText("supplier required"))
    await userEvent.click(screen.getByTestId("schema-promotion-confirm"))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect(onConfirm.mock.calls[0][0].node_key).toBeUndefined()
  })

  it("reports a load failure instead of rendering an empty table", async () => {
    mockGetSchemaProposal.mockRejectedValue(new Error("boom"))
    renderDialog()
    expect(await screen.findByText(/boom/)).toBeInTheDocument()
    expect(screen.getByTestId("schema-promotion-confirm")).toBeDisabled()
  })

  it("notes subjects that are no longer parked entries", async () => {
    mockGetSchemaProposal.mockResolvedValue(
      makeProposal({ unresolved_subject_ids: ["gone-1"] })
    )
    renderDialog()
    expect(
      await screen.findByText(/no longer parked entries and will be skipped/i)
    ).toBeInTheDocument()
  })

  it("names the nodes being promoted, not just how many", async () => {
    renderDialog()
    expect(await screen.findByText("PO-1")).toBeInTheDocument()
    expect(screen.getByText("PO-2")).toBeInTheDocument()
  })

  it("shows the relationships that will be promoted with them", async () => {
    mockGetSchemaProposal.mockResolvedValue(
      makeProposal({
        edges: [
          {
            ref_id: "edge-1",
            intended_type: "SUPPLIED_BY",
            source_ref_id: "entry-1",
            source_name: "PO-1",
            source_intended_type: "PurchaseOrder",
            target_ref_id: "entry-2",
            target_name: "PO-2",
            target_intended_type: "PurchaseOrder",
            both_ends_in_review: true,
          },
        ],
      })
    )
    renderDialog()
    expect(await screen.findByText("SUPPLIED_BY")).toBeInTheDocument()
    expect(screen.getByText(/1 promoted/)).toBeInTheDocument()
  })

  it("flags an edge whose other end stays parked", async () => {
    // The admin needs this before approving: the promoted node comes out
    // disconnected from whatever is on the far side.
    mockGetSchemaProposal.mockResolvedValue(
      makeProposal({
        edges: [
          {
            ref_id: "edge-2",
            intended_type: "FULFILLED_BY",
            source_ref_id: "entry-1",
            source_name: "PO-1",
            source_intended_type: "PurchaseOrder",
            target_ref_id: "other-review-entry",
            target_name: "Globex",
            target_intended_type: "Supplier",
            both_ends_in_review: false,
          },
        ],
      })
    )
    renderDialog()
    expect(await screen.findByText(/still parked/)).toBeInTheDocument()
    expect(screen.getByText(/1 left parked/)).toBeInTheDocument()
  })

  it("omits the relationships section when there are none", async () => {
    renderDialog()
    await screen.findByText("PO-1")
    expect(screen.queryByText(/Relationships/)).not.toBeInTheDocument()
  })
})
