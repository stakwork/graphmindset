import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"
import type { GraphNode } from "@/lib/graph-api"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockCreateEdge, mockSearchNodes } = vi.hoisted(() => ({
  mockCreateEdge: vi.fn().mockResolvedValue({}),
  mockSearchNodes: vi.fn().mockResolvedValue({ nodes: [] }),
}))

vi.mock("@/lib/graph-api", () => ({
  createEdge: (...args: unknown[]) => mockCreateEdge(...args),
  searchNodesForEdge: (...args: unknown[]) => mockSearchNodes(...args),
}))

vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => false,
}))

// Pricing / payment helpers — edge creation is a paid action.
vi.mock("@/lib/sphinx", () => ({
  getPrice: vi.fn().mockResolvedValue(0),
  payL402: vi.fn().mockResolvedValue(undefined),
}))

// User store — only setBudget is read by the edge form.
vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ setBudget: vi.fn() }),
}))

// ---------------------------------------------------------------------------
// Fixture nodes
// ---------------------------------------------------------------------------
const FIXTURE_SOURCE: GraphNode = {
  ref_id: "node-source-ref",
  node_type: "Topic",
  properties: { name: "Source Topic" },
}

const FIXTURE_TARGET: GraphNode = {
  ref_id: "node-target-ref",
  node_type: "Person",
  properties: { name: "Target Person" },
}

// ---------------------------------------------------------------------------
// Modal store — per-selector mock. AddEdgeForm reads sourceNode (for prefill)
// and close. The modal shell owns open/close gating, so those aren't tested
// here.
// ---------------------------------------------------------------------------
let mockSourceNode: GraphNode | null = null
let mockClose = vi.fn()

const mockOpen = vi.fn()
vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      sourceNode: mockSourceNode,
      close: mockClose,
      open: mockOpen,
    }),
}))

// ---------------------------------------------------------------------------
// Schema store — per-selector mock with sample edges
// ---------------------------------------------------------------------------
// Edge schemas are directional source_type -> target_type. `source`/`target`
// hold the connected schema NODES' ref_ids (not type names); type matching uses
// source_type/target_type. FIXTURE_SOURCE is a Topic and FIXTURE_TARGET a
// Person, so the Topic->Person edges are what the picker offers once both are
// selected. `attributes` carry the edge type's property definitions.
const SCHEMA_EDGES = [
  { ref_id: "e1", edge_type: "HAS_TOPIC", source: "s-topic", target: "s-person", source_type: "Topic", target_type: "Person" },
  { ref_id: "e2", edge_type: "AUTHORED_BY", source: "s-content", target: "s-person", source_type: "Content", target_type: "Person" },
  { ref_id: "e3", edge_type: "HAS_TOPIC", source: "s-content", target: "s-topic", source_type: "Content", target_type: "Topic" }, // duplicate edge_type — should dedupe
  { ref_id: "e4", edge_type: "CHILD_OF", source: "s-ep", target: "s-ep", source_type: "Episode", target_type: "Episode" }, // excluded
  { ref_id: "e5", edge_type: "RELATED_TO", source: "s-person", target: "s-person2", source_type: "Person", target_type: "Person" },
  // Topic->Person with optional attribute definitions (schema-driven fields)
  { ref_id: "e6", edge_type: "MENTIONS", source: "s-topic", target: "s-person", source_type: "Topic", target_type: "Person", attributes: { note: "?string", confidence: "?float" } },
  // Topic->Person with a REQUIRED attribute
  { ref_id: "e7", edge_type: "ROLE_AT", source: "s-topic", target: "s-person", source_type: "Topic", target_type: "Person", attributes: { role: "string" } },
]

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ edges: SCHEMA_EDGES, schemas: [] }),
}))

// ---------------------------------------------------------------------------
// Import component after mocks are set up
// ---------------------------------------------------------------------------
import { AddEdgeForm } from "@/components/modals/add-edge-form"
import { payL402 } from "@/lib/sphinx"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function withSource(sourceNode: GraphNode | null = null) {
  mockSourceNode = sourceNode
}

/** Type a query into a NodeSearchInput, wait for the dropdown result, and click it */
async function selectNode(placeholder: string, node: GraphNode) {
  mockSearchNodes.mockResolvedValue({ nodes: [node] })
  const input = screen.getByPlaceholderText(placeholder)
  await userEvent.type(input, node.properties?.name as string)
  await waitFor(() => {
    // result row should appear — match by ref_id truncation or name
    expect(screen.getAllByText(node.properties?.name as string).length).toBeGreaterThan(0)
  })
  // Click the result row (last occurrence is the dropdown item)
  const rows = screen.getAllByText(node.properties?.name as string)
  await userEvent.click(rows[rows.length - 1])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("AddEdgeForm", () => {
  beforeEach(() => {
    mockClose = vi.fn()
    vi.clearAllMocks()
    mockCreateEdge.mockResolvedValue({})
    mockSearchNodes.mockResolvedValue({ nodes: [] })
    withSource(null)
  })

  it("renders empty source and target NodeSearchInput fields when opened from toolbar", () => {
    withSource(null)
    render(<AddEdgeForm />)
    const sourceInput = screen.getByPlaceholderText("Search source node…") as HTMLInputElement
    const targetInput = screen.getByPlaceholderText("Search target node…") as HTMLInputElement
    expect(sourceInput.value).toBe("")
    expect(targetInput.value).toBe("")
  })

  it("pre-fills source field with node display name when sourceNode is set in the modal store", () => {
    withSource(FIXTURE_SOURCE)
    render(<AddEdgeForm />)
    // Selected state renders the node title, not a raw ref_id
    expect(screen.getByText("Source Topic")).toBeDefined()
    // Target should still be an empty search input
    expect(screen.getByPlaceholderText("Search target node…")).toBeDefined()
  })

  it("target field is always empty on open even when sourceNode is set", () => {
    withSource(FIXTURE_SOURCE)
    render(<AddEdgeForm />)
    const targetInput = screen.getByPlaceholderText("Search target node…") as HTMLInputElement
    expect(targetInput.value).toBe("")
  })

  // -------------------------------------------------------------------------
  // Edge type dropdown
  // -------------------------------------------------------------------------
  describe("Edge type dropdown", () => {
    it("excludes CHILD_OF from options", async () => {
      withSource()
      render(<AddEdgeForm />)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      expect(screen.queryByText("CHILD_OF")).toBeNull()
    })

    it("shows all unique edge types from schema store (deduped, no CHILD_OF)", async () => {
      withSource()
      render(<AddEdgeForm />)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      expect(screen.getAllByText("HAS_TOPIC").length).toBeGreaterThan(0)
      expect(screen.getAllByText("AUTHORED_BY").length).toBeGreaterThan(0)
      expect(screen.getAllByText("RELATED_TO").length).toBeGreaterThan(0)
    })

    it("renders schema-defined properties and sends filled ones as edge_data", async () => {
      withSource(null)
      render(<AddEdgeForm />)
      await selectNode("Search source node…", FIXTURE_SOURCE) // Topic
      await selectNode("Search target node…", FIXTURE_TARGET) // Person
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("MENTIONS"))
      // Optional field "note" (?string) renders with a type-hint placeholder
      const noteInput = screen.getByPlaceholderText("string")
      await userEvent.type(noteInput, "as discussed")
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))
      await waitFor(() => {
        expect(mockCreateEdge).toHaveBeenCalledWith({
          source: "node-source-ref",
          target: "node-target-ref",
          edge_type: "MENTIONS",
          edge_data: { note: "as discussed" },
        })
      })
    })

    it("blocks submit when a required schema property is empty", async () => {
      withSource(null)
      render(<AddEdgeForm />)
      await selectNode("Search source node…", FIXTURE_SOURCE)
      await selectNode("Search target node…", FIXTURE_TARGET)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("ROLE_AT"))
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))
      expect(screen.getByText(/Missing required property: role/i)).toBeDefined()
      expect(mockCreateEdge).not.toHaveBeenCalled()
    })

    it("custom type mode sends a free-typed edge_type with create_schema_if_missing", async () => {
      withSource(null)
      render(<AddEdgeForm />)
      await selectNode("Search source node…", FIXTURE_SOURCE)
      await selectNode("Search target node…", FIXTURE_TARGET)
      // Switch to free-text mode and type a brand-new relationship type
      await userEvent.click(screen.getByText("+ Custom type"))
      const input = screen.getByPlaceholderText("e.g. FOUND_AT")
      await userEvent.type(input, "found at")
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))
      await waitFor(() => {
        expect(mockCreateEdge).toHaveBeenCalledWith({
          source: "node-source-ref",
          target: "node-target-ref",
          edge_type: "FOUND_AT",
          create_schema_if_missing: true,
        })
      })
    })

    it("filters edge types to those valid for the selected source/target node types", async () => {
      withSource(null)
      render(<AddEdgeForm />)
      // Topic (source) -> Person (target): only HAS_TOPIC is defined for this pair
      await selectNode("Search source node…", FIXTURE_SOURCE)
      await selectNode("Search target node…", FIXTURE_TARGET)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      expect(screen.getAllByText("HAS_TOPIC").length).toBeGreaterThan(0)
      // Defined for other type pairs — must not be offered here
      expect(screen.queryByText("AUTHORED_BY")).toBeNull()
      expect(screen.queryByText("RELATED_TO")).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------
  describe("Validation", () => {
    it("shows an error when source is not selected on submit", async () => {
      withSource(null)
      render(<AddEdgeForm />)
      // Select target only
      await selectNode("Search target node…", FIXTURE_TARGET)
      // Select edge type
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("HAS_TOPIC"))
      // Submit without source
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))
      expect(screen.getByText("All three fields are required.")).toBeDefined()
      expect(mockCreateEdge).not.toHaveBeenCalled()
    })

    it("shows an error when target is not selected on submit", async () => {
      withSource(FIXTURE_SOURCE)
      render(<AddEdgeForm />)
      // Select edge type
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("HAS_TOPIC"))
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))
      expect(screen.getByText("All three fields are required.")).toBeDefined()
      expect(mockCreateEdge).not.toHaveBeenCalled()
    })

    it("shows an error when edge type is not selected on submit", async () => {
      withSource(null)
      render(<AddEdgeForm />)
      await selectNode("Search source node…", FIXTURE_SOURCE)
      await selectNode("Search target node…", FIXTURE_TARGET)
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))
      expect(screen.getByText("All three fields are required.")).toBeDefined()
      expect(mockCreateEdge).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------
  describe("Submission", () => {
    it("calls createEdge with ref_id values from selected nodes on valid submit", async () => {
      withSource(null)
      render(<AddEdgeForm />)
      await selectNode("Search source node…", FIXTURE_SOURCE)
      await selectNode("Search target node…", FIXTURE_TARGET)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("HAS_TOPIC"))
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))
      await waitFor(() => {
        expect(mockCreateEdge).toHaveBeenCalledWith({
          source: "node-source-ref",
          target: "node-target-ref",
          edge_type: "HAS_TOPIC",
        })
      })
    })

    it("calls createEdge with pre-filled source node ref_id and selected target", async () => {
      withSource(FIXTURE_SOURCE)
      render(<AddEdgeForm />)
      await selectNode("Search target node…", FIXTURE_TARGET)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("HAS_TOPIC"))
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))
      await waitFor(() => {
        expect(mockCreateEdge).toHaveBeenCalledWith({
          source: "node-source-ref",
          target: "node-target-ref",
          edge_type: "HAS_TOPIC",
        })
      })
    })

    it("shows success state after createEdge resolves", async () => {
      withSource(null)
      render(<AddEdgeForm />)
      await selectNode("Search source node…", FIXTURE_SOURCE)
      await selectNode("Search target node…", FIXTURE_TARGET)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("HAS_TOPIC"))
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))
      await waitFor(() => {
        expect(screen.getByText("Edge created!")).toBeDefined()
      })
    })

    it("calls close after success auto-close timeout", async () => {
      withSource(null)
      render(<AddEdgeForm />)
      await selectNode("Search source node…", FIXTURE_SOURCE)
      await selectNode("Search target node…", FIXTURE_TARGET)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("HAS_TOPIC"))
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))
      await waitFor(() => expect(mockCreateEdge).toHaveBeenCalled())
      await waitFor(() => expect(mockClose).toHaveBeenCalled(), { timeout: 2500 })
    })

    it("on 402, settles the L402 invoice and retries, then succeeds", async () => {
      mockCreateEdge.mockRejectedValueOnce(new Response(null, { status: 402 }))
      mockCreateEdge.mockResolvedValueOnce({})
      withSource(null)
      render(<AddEdgeForm />)
      await selectNode("Search source node…", FIXTURE_SOURCE)
      await selectNode("Search target node…", FIXTURE_TARGET)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("HAS_TOPIC"))
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))

      await waitFor(() => expect(payL402).toHaveBeenCalled())
      await waitFor(() => expect(mockCreateEdge).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(screen.getByText("Edge created!")).toBeDefined())
      expect(mockOpen).not.toHaveBeenCalled()
    })

    it("opens the budget bar when payment fails on a 402", async () => {
      mockCreateEdge.mockRejectedValue(new Response(null, { status: 402 }))
      vi.mocked(payL402).mockRejectedValueOnce(new Error("not enough sats"))
      withSource(null)
      render(<AddEdgeForm />)
      await selectNode("Search source node…", FIXTURE_SOURCE)
      await selectNode("Search target node…", FIXTURE_TARGET)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("HAS_TOPIC"))
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))

      await waitFor(() => expect(mockOpen).toHaveBeenCalledWith("budget"))
      expect(mockClose).not.toHaveBeenCalled()
      // Form must be re-enabled (not wedged on "Creating…") so the user can
      // retry after topping up.
      await waitFor(() => {
        const btn = screen.getByRole("button", { name: /add edge/i })
        expect(btn).not.toBeDisabled()
      })
      expect(screen.queryByRole("button", { name: /creating/i })).toBeNull()
    })

    it("shows inline error and keeps the form mounted when createEdge rejects", async () => {
      mockCreateEdge.mockRejectedValueOnce(new Error("Duplicate edge"))
      withSource(null)
      render(<AddEdgeForm />)
      await selectNode("Search source node…", FIXTURE_SOURCE)
      await selectNode("Search target node…", FIXTURE_TARGET)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("HAS_TOPIC"))
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))
      await waitFor(() => {
        expect(screen.getByText("Duplicate edge")).toBeDefined()
      })
      // Form stays mounted — submit button still present, close not called
      expect(screen.getByRole("button", { name: /add edge/i })).toBeDefined()
      expect(mockClose).not.toHaveBeenCalled()
    })
  })
})
