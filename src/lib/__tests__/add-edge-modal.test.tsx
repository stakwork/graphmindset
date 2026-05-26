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
  searchNodes: (...args: unknown[]) => mockSearchNodes(...args),
}))

vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => false,
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
// Modal store — per-selector mock
// ---------------------------------------------------------------------------
let mockActiveModal: string | null = null
let mockSourceNode: GraphNode | null = null
let mockClose = vi.fn()

vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      activeModal: mockActiveModal,
      sourceNode: mockSourceNode,
      close: mockClose,
    }),
}))

// ---------------------------------------------------------------------------
// Schema store — per-selector mock with sample edges
// ---------------------------------------------------------------------------
const SCHEMA_EDGES = [
  { ref_id: "e1", edge_type: "HAS_TOPIC", from_type: "Person", to_type: "Topic" },
  { ref_id: "e2", edge_type: "AUTHORED_BY", from_type: "Content", to_type: "Person" },
  { ref_id: "e3", edge_type: "HAS_TOPIC", from_type: "Content", to_type: "Topic" }, // duplicate — should dedupe
  { ref_id: "e4", edge_type: "CHILD_OF", from_type: "Episode", to_type: "Episode" }, // excluded
  { ref_id: "e5", edge_type: "RELATED_TO", from_type: "Person", to_type: "Person" },
]

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ edges: SCHEMA_EDGES }),
}))

// ---------------------------------------------------------------------------
// Import component after mocks are set up
// ---------------------------------------------------------------------------
import { AddEdgeModal } from "@/components/modals/add-edge-modal"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function openModal(sourceNode: GraphNode | null = null) {
  mockActiveModal = "addEdge"
  mockSourceNode = sourceNode
}

function closeModal() {
  mockActiveModal = null
  mockSourceNode = null
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
describe("AddEdgeModal", () => {
  beforeEach(() => {
    mockClose = vi.fn()
    vi.clearAllMocks()
    mockCreateEdge.mockResolvedValue({})
    mockSearchNodes.mockResolvedValue({ nodes: [] })
    closeModal()
  })

  it("does not render when modal is closed", () => {
    closeModal()
    render(<AddEdgeModal />)
    expect(screen.queryByText("Add Edge")).toBeNull()
  })

  it("renders when activeModal is 'addEdge'", () => {
    openModal()
    render(<AddEdgeModal />)
    expect(screen.getByRole("heading", { name: "Add Edge" })).toBeDefined()
  })

  it("renders with empty source and target NodeSearchInput fields when opened from toolbar", () => {
    openModal(null)
    render(<AddEdgeModal />)
    const sourceInput = screen.getByPlaceholderText("Search source node…") as HTMLInputElement
    const targetInput = screen.getByPlaceholderText("Search target node…") as HTMLInputElement
    expect(sourceInput.value).toBe("")
    expect(targetInput.value).toBe("")
  })

  it("pre-fills source field with node display name when sourceNode is set in the modal store", () => {
    openModal(FIXTURE_SOURCE)
    render(<AddEdgeModal />)
    // Selected state renders the node title, not a raw ref_id
    expect(screen.getByText("Source Topic")).toBeDefined()
    // Target should still be an empty search input
    expect(screen.getByPlaceholderText("Search target node…")).toBeDefined()
  })

  it("target field is always empty on open even when sourceNode is set", () => {
    openModal(FIXTURE_SOURCE)
    render(<AddEdgeModal />)
    const targetInput = screen.getByPlaceholderText("Search target node…") as HTMLInputElement
    expect(targetInput.value).toBe("")
  })

  // -------------------------------------------------------------------------
  // Edge type dropdown
  // -------------------------------------------------------------------------
  describe("Edge type dropdown", () => {
    it("excludes CHILD_OF from options", async () => {
      openModal()
      render(<AddEdgeModal />)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      expect(screen.queryByText("CHILD_OF")).toBeNull()
    })

    it("shows all unique edge types from schema store (deduped, no CHILD_OF)", async () => {
      openModal()
      render(<AddEdgeModal />)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      expect(screen.getAllByText("HAS_TOPIC").length).toBeGreaterThan(0)
      expect(screen.getAllByText("AUTHORED_BY").length).toBeGreaterThan(0)
      expect(screen.getAllByText("RELATED_TO").length).toBeGreaterThan(0)
    })
  })

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------
  describe("Validation", () => {
    it("shows an error when source is not selected on submit", async () => {
      openModal(null)
      render(<AddEdgeModal />)
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
      openModal(FIXTURE_SOURCE)
      render(<AddEdgeModal />)
      // Select edge type
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("HAS_TOPIC"))
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))
      expect(screen.getByText("All three fields are required.")).toBeDefined()
      expect(mockCreateEdge).not.toHaveBeenCalled()
    })

    it("shows an error when edge type is not selected on submit", async () => {
      openModal(null)
      render(<AddEdgeModal />)
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
      openModal(null)
      render(<AddEdgeModal />)
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
      openModal(FIXTURE_SOURCE)
      render(<AddEdgeModal />)
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
      openModal(null)
      render(<AddEdgeModal />)
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
      openModal(null)
      render(<AddEdgeModal />)
      await selectNode("Search source node…", FIXTURE_SOURCE)
      await selectNode("Search target node…", FIXTURE_TARGET)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("HAS_TOPIC"))
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))
      await waitFor(() => expect(mockCreateEdge).toHaveBeenCalled())
      await waitFor(() => expect(mockClose).toHaveBeenCalled(), { timeout: 2500 })
    })

    it("shows inline error and keeps modal open when createEdge rejects", async () => {
      mockCreateEdge.mockRejectedValueOnce(new Error("Duplicate edge"))
      openModal(null)
      render(<AddEdgeModal />)
      await selectNode("Search source node…", FIXTURE_SOURCE)
      await selectNode("Search target node…", FIXTURE_TARGET)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("HAS_TOPIC"))
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))
      await waitFor(() => {
        expect(screen.getByText("Duplicate edge")).toBeDefined()
      })
      // Modal stays open — title still visible
      expect(screen.getByRole("heading", { name: "Add Edge" })).toBeDefined()
      expect(mockClose).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Close / reset
  // -------------------------------------------------------------------------
  describe("Close behaviour", () => {
    it("calls close() when the dialog is dismissed via onOpenChange", async () => {
      openModal()
      const { rerender } = render(<AddEdgeModal />)
      // Simulate dialog close by changing activeModal
      mockActiveModal = null
      rerender(<AddEdgeModal />)
      expect(screen.queryByText("Add Edge")).toBeNull()
    })

    it("resets all field values and clears errors after close and reopen", async () => {
      mockCreateEdge.mockRejectedValueOnce(new Error("bad"))
      openModal(null)
      const { rerender } = render(<AddEdgeModal />)

      // Fill and submit to trigger error
      await selectNode("Search source node…", FIXTURE_SOURCE)
      await selectNode("Search target node…", FIXTURE_TARGET)
      const trigger = screen.getByText("Choose an edge type...").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("HAS_TOPIC"))
      await userEvent.click(screen.getByRole("button", { name: /add edge/i }))
      await waitFor(() => expect(screen.getByText("bad")).toBeDefined())

      // Close modal
      mockActiveModal = null
      mockSourceNode = null
      rerender(<AddEdgeModal />)

      // Reopen fresh
      mockActiveModal = "addEdge"
      mockSourceNode = null
      rerender(<AddEdgeModal />)

      // Fields should be reset — empty search inputs visible
      expect(screen.getByPlaceholderText("Search source node…")).toBeDefined()
      expect(screen.getByPlaceholderText("Search target node…")).toBeDefined()
      expect(screen.queryByText("bad")).toBeNull()
    })
  })
})
