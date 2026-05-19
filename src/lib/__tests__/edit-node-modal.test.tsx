import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAdminUpdateNode } = vi.hoisted(() => ({
  mockAdminUpdateNode: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/graph-api", () => ({
  adminUpdateNode: (...args: unknown[]) => mockAdminUpdateNode(...args),
}))

vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => false,
}))

// ---------------------------------------------------------------------------
// Modal store — per-selector mock
// ---------------------------------------------------------------------------
let mockActiveModal: string | null = null
let mockEditingNode: Record<string, unknown> | null = null
const mockClose = vi.fn()
const mockOpenEdit = vi.fn()

vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      activeModal: mockActiveModal,
      editingNode: mockEditingNode,
      close: mockClose,
      openEdit: mockOpenEdit,
    }),
}))

// ---------------------------------------------------------------------------
// Schema store — per-selector mock
// ---------------------------------------------------------------------------
const SCHEMAS = [
  {
    ref_id: "s1",
    type: "Person",
    parent: "Thing",
    node_key: "person-name",
    color: "#ff0000",
    icon: "user",
    attributes: [
      { key: "name", type: "string", required: true },
      { key: "bio", type: "string", required: false },
    ],
    inherited_attributes: [],
  },
  {
    ref_id: "s2",
    type: "Organisation",
    parent: "Thing",
    node_key: "organisation-name",
    color: "#00ff00",
    icon: "building",
    attributes: [
      { key: "name", type: "string", required: true },
      { key: "description", type: "string", required: false },
    ],
    inherited_attributes: [],
  },
]

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ schemas: SCHEMAS }),
}))

// ---------------------------------------------------------------------------
// Graph store — per-selector mock
// ---------------------------------------------------------------------------
const mockClearSelection = vi.fn()
const mockSetSelectedNode = vi.fn()

vi.mock("@/stores/graph-store", () => ({
  useGraphStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ clearSelection: mockClearSelection, setSelectedNode: mockSetSelectedNode }),
}))

// ---------------------------------------------------------------------------
// User store — always admin so the modal renders
// ---------------------------------------------------------------------------
vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ isAdmin: true }),
}))

// ---------------------------------------------------------------------------
// Import component after mocks are set up
// ---------------------------------------------------------------------------
import { EditNodeModal } from "@/components/modals/edit-node-modal"

// ---------------------------------------------------------------------------
// Test node fixture
// ---------------------------------------------------------------------------
const PERSON_NODE = {
  ref_id: "node-abc",
  node_type: "Person",
  properties: {
    name: "Alice",
    bio: "A developer",
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function openModal(node: Record<string, unknown> = PERSON_NODE) {
  mockActiveModal = "editNode"
  mockEditingNode = node
}

function closeModal() {
  mockActiveModal = null
  mockEditingNode = null
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("EditNodeModal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminUpdateNode.mockResolvedValue({})
    closeModal()
  })

  it("does not render when modal is closed", () => {
    closeModal()
    render(<EditNodeModal />)
    expect(screen.queryByText("Edit Node")).toBeNull()
  })

  it("renders when activeModal is 'editNode'", () => {
    openModal()
    render(<EditNodeModal />)
    expect(screen.getByText("Edit Node")).toBeDefined()
  })

  // -------------------------------------------------------------------------
  // Phase A — property editing
  // -------------------------------------------------------------------------
  describe("Phase A — property editing", () => {
    it("pre-fills fields from the node's current properties", () => {
      openModal()
      render(<EditNodeModal />)

      expect(screen.getByDisplayValue("Alice")).toBeDefined()
      expect(screen.getByDisplayValue("A developer")).toBeDefined()
    })

    it("marks required fields with an asterisk via label", () => {
      openModal()
      render(<EditNodeModal />)

      // Required 'name' field label includes '*' suffix
      // getByText with exact:false finds label text containing asterisk
      const asterisks = document.querySelectorAll(".text-destructive")
      expect(asterisks.length).toBeGreaterThan(0)
    })

    it("shows the current node type in the type selector", () => {
      openModal()
      render(<EditNodeModal />)
      // SelectCustom renders the selected value label
      expect(screen.getByText("Person")).toBeDefined()
    })

    it("does not show remap section when type is unchanged", () => {
      openModal()
      render(<EditNodeModal />)
      expect(screen.queryByText("Property Remapping")).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Phase B — remap section
  // -------------------------------------------------------------------------
  describe("Phase B — remap section", () => {
    it("shows remap section when type changes", async () => {
      openModal()
      render(<EditNodeModal />)

      // Open the SelectCustom dropdown for type
      const trigger = screen.getByText("Person").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)

      // Click 'Organisation' option in the dropdown
      const orgOption = screen.getByText("Organisation")
      await userEvent.click(orgOption)

      expect(screen.getByText("Property Remapping")).toBeDefined()
    })

    it("shows auto-matched section for exact key matches after type change", async () => {
      // 'name' exists in both Person and Organisation — exact match
      openModal()
      render(<EditNodeModal />)

      const trigger = screen.getByText("Person").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("Organisation"))

      expect(screen.getByText("Auto-matched")).toBeDefined()
    })

    it("hides remap section when type is reset to original", async () => {
      openModal()
      render(<EditNodeModal />)

      // Change to Organisation
      const trigger = screen.getByText("Person").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("Organisation"))
      expect(screen.getByText("Property Remapping")).toBeDefined()

      // Change back to Person — remap section should disappear
      const trigger2 = screen.getByText("Organisation").closest("button") as HTMLButtonElement
      await userEvent.click(trigger2)
      await userEvent.click(screen.getAllByText("Person")[0])
      expect(screen.queryByText("Property Remapping")).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Required field guard
  // -------------------------------------------------------------------------
  describe("Required field guard", () => {
    it("Save button is enabled when required fields have values", () => {
      openModal() // name = "Alice" (filled)
      render(<EditNodeModal />)
      expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled()
    })

    it("Save button is disabled when required field is empty", () => {
      openModal({
        ref_id: "node-abc",
        node_type: "Person",
        properties: { name: "", bio: "A developer" },
      })
      render(<EditNodeModal />)
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    })

    it("Save becomes enabled once required field is filled", async () => {
      openModal({
        ref_id: "node-abc",
        node_type: "Person",
        properties: { name: "", bio: "" },
      })
      render(<EditNodeModal />)

      const saveButton = screen.getByRole("button", { name: "Save" })
      expect(saveButton).toBeDisabled()

      // Type into the name input (it has placeholder "Required")
      const nameInput = screen.getAllByPlaceholderText("Required")[0]
      await userEvent.type(nameInput, "Alice")

      expect(saveButton).not.toBeDisabled()
    })
  })

  // -------------------------------------------------------------------------
  // Save flow
  // -------------------------------------------------------------------------
  describe("Save flow", () => {
    it("calls adminUpdateNode with correct payload", async () => {
      openModal()
      render(<EditNodeModal />)

      await userEvent.click(screen.getByRole("button", { name: "Save" }))

      await waitFor(() => expect(mockAdminUpdateNode).toHaveBeenCalledOnce())

      const payload = mockAdminUpdateNode.mock.calls[0][0]
      expect(payload.ref_id).toBe("node-abc")
      expect(payload.node_type).toBe("Person")
      expect(payload.node_data.name).toBe("Alice")
    })

    it("closes modal and refreshes node on success", async () => {
      openModal()
      render(<EditNodeModal />)

      await userEvent.click(screen.getByRole("button", { name: "Save" }))

      await waitFor(() => expect(mockClose).toHaveBeenCalledOnce())
      expect(mockClearSelection).toHaveBeenCalledOnce()
      expect(mockSetSelectedNode).toHaveBeenCalledWith(PERSON_NODE)
    })

    it("shows inline error on save failure", async () => {
      mockAdminUpdateNode.mockRejectedValueOnce(new Error("Duplicate node key"))
      openModal()
      render(<EditNodeModal />)

      await userEvent.click(screen.getByRole("button", { name: "Save" }))

      await waitFor(() => {
        expect(screen.getByText("Duplicate node key")).toBeDefined()
      })
    })

    it("does not close modal on save failure", async () => {
      mockAdminUpdateNode.mockRejectedValueOnce(new Error("Invalid type"))
      openModal()
      render(<EditNodeModal />)

      await userEvent.click(screen.getByRole("button", { name: "Save" }))

      await waitFor(() => {
        expect(screen.getByText("Invalid type")).toBeDefined()
      })
      expect(mockClose).not.toHaveBeenCalled()
    })

    it("sends type_to_be_deleted when node type changes", async () => {
      openModal()
      render(<EditNodeModal />)

      // Change type to Organisation
      const trigger = screen.getByText("Person").closest("button") as HTMLButtonElement
      await userEvent.click(trigger)
      await userEvent.click(screen.getByText("Organisation"))

      // 'name' is pre-filled from the node (Alice), satisfying the required field
      await userEvent.click(screen.getByRole("button", { name: "Save" }))

      await waitFor(() => expect(mockAdminUpdateNode).toHaveBeenCalledOnce())

      const payload = mockAdminUpdateNode.mock.calls[0][0]
      expect(payload.node_type).toBe("Organisation")
      expect(payload.type_to_be_deleted).toEqual(["Person"])
    })

    it("does not send type_to_be_deleted when type is unchanged", async () => {
      openModal()
      render(<EditNodeModal />)

      await userEvent.click(screen.getByRole("button", { name: "Save" }))

      await waitFor(() => expect(mockAdminUpdateNode).toHaveBeenCalledOnce())

      const payload = mockAdminUpdateNode.mock.calls[0][0]
      expect(payload.type_to_be_deleted).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------------
  describe("Cancel", () => {
    it("calls close() on Cancel", async () => {
      openModal()
      render(<EditNodeModal />)

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
      expect(mockClose).toHaveBeenCalledOnce()
    })
  })
})


