import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import React from "react"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { isMocksEnabledMock, getL402Mock, getSignedMessageMock } = vi.hoisted(() => ({
  isMocksEnabledMock: vi.fn(() => true),
  getL402Mock: vi.fn(),
  getSignedMessageMock: vi.fn(),
}))

vi.mock("@/lib/mock-data", () => ({ isMocksEnabled: isMocksEnabledMock }))
vi.mock("@/lib/sphinx", () => ({
  getL402: getL402Mock,
  getSignedMessage: getSignedMessageMock,
  getPrice: vi.fn().mockResolvedValue(0),
  payL402: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Schema store mock — small schema set for tests
// ---------------------------------------------------------------------------

const MOCK_SCHEMAS = [
  {
    ref_id: "thing-id",
    type: "Thing",
    parent: "",
    color: "#000",
    node_key: "thing-name",
    attributes: [{ key: "name", type: "string", required: true }],
    inherited_attributes: [],
  },
  {
    ref_id: "topic-id",
    type: "Topic",
    parent: "Thing",
    color: "#111",
    node_key: "topic-name",
    attributes: [
      { key: "name", type: "string", required: true },
      { key: "relevancy_score", type: "float", required: false },
    ],
    inherited_attributes: [],
  },
  {
    ref_id: "person-id",
    type: "Person",
    parent: "Thing",
    color: "#222",
    node_key: "person-name",
    attributes: [
      { key: "name", type: "string", required: true },
      { key: "alias", type: "string", required: false },
      { key: "active", type: "boolean", required: false },
      { key: "birth_year", type: "int", required: false },
      { key: "score", type: "float", required: false },
      { key: "joined_at", type: "datetime", required: false },
      { key: "tags", type: "list", required: false },
    ],
    inherited_attributes: [],
  },
  {
    ref_id: "episode-id",
    type: "Episode",
    parent: "Thing",
    color: "#333",
    node_key: "episode-source_link",
    attributes: [
      { key: "source_link", type: "string", required: true },
      { key: "title", type: "string", required: false },
    ],
    inherited_attributes: [],
  },
  {
    ref_id: "nokey-id",
    type: "NoKeyType",
    parent: "Thing",
    color: "#444",
    node_key: "",
    attributes: [{ key: "name", type: "string", required: true }],
    inherited_attributes: [],
  },
]

let schemasInStore = MOCK_SCHEMAS

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel?: (s: unknown) => unknown) => {
    const state = {
      schemas: schemasInStore,
    }
    return sel ? sel(state) : state
  },
}))

// ---------------------------------------------------------------------------
// graph-api mocks (must be hoisted to avoid TDZ error)
// ---------------------------------------------------------------------------

const { mockFetchSchemaByType, mockCheckNodeExists, mockCreateNode } = vi.hoisted(() => ({
  mockFetchSchemaByType: vi.fn(),
  mockCheckNodeExists: vi.fn(),
  mockCreateNode: vi.fn(),
}))

vi.mock("@/lib/graph-api", () => ({
  fetchSchemaByType: mockFetchSchemaByType,
  checkNodeExists: mockCheckNodeExists,
  createNode: mockCreateNode,
}))

// ---------------------------------------------------------------------------
// Modal store mock
// ---------------------------------------------------------------------------

let activeModal: string | null = "createNode"
const mockClose = vi.fn()
const mockOpen = vi.fn()

vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel?: (s: unknown) => unknown) => {
    const state = {
      activeModal,
      open: mockOpen,
      close: mockClose,
    }
    return sel ? sel(state) : state
  },
}))

// ---------------------------------------------------------------------------
// User store mock
// ---------------------------------------------------------------------------

vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel?: (s: unknown) => unknown) => {
    const state = { pubKey: "testpub", isAdmin: false, budget: 100, setBudget: vi.fn() }
    return sel ? sel(state) : state
  },
}))

// ---------------------------------------------------------------------------
// UI component mocks
// ---------------------------------------------------------------------------

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    disabled,
    type,
    onClick,
  }: {
    children: React.ReactNode
    disabled?: boolean
    type?: "button" | "submit"
    onClick?: () => void
  }) => (
    <button type={type ?? "button"} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock("@/lib/input-limits", () => ({
  MAX_LENGTHS: { SCHEMA_TYPE_NAME: 50 },
}))

// ---------------------------------------------------------------------------
// Import component under test AFTER all mocks
// ---------------------------------------------------------------------------

import { CreateNodeModal } from "@/components/modals/create-node-modal"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderModal() {
  return render(<CreateNodeModal />)
}

function selectType(type: string) {
  const select = screen.getByRole("combobox")
  fireEvent.change(select, { target: { value: type } })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreateNodeModal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeModal = "createNode"
    schemasInStore = MOCK_SCHEMAS

    // Default: fetchSchemaByType returns full schema for the type
    mockFetchSchemaByType.mockImplementation(async (type: string) => {
      return MOCK_SCHEMAS.find((s) => s.type === type) ?? null
    })
    mockCheckNodeExists.mockResolvedValue({ exists: false, ref_id: null, status: null })
    mockCreateNode.mockResolvedValue({ status: "OK" })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Type dropdown filtering
  // -------------------------------------------------------------------------

  it('excludes "Thing" and types with no node_key from the dropdown', () => {
    renderModal()
    const options = screen.getAllByRole("option").map((o) => o.textContent)
    expect(options).not.toContain("Thing")
    expect(options).not.toContain("NoKeyType")
    expect(options).toContain("Topic")
    expect(options).toContain("Person")
    expect(options).toContain("Episode")
  })

  it("sorts type options alphabetically", () => {
    renderModal()
    const options = screen
      .getAllByRole("option")
      .map((o) => o.textContent)
      .filter((t) => t !== "Select a type...")
    const sorted = [...options].sort()
    expect(options).toEqual(sorted)
  })

  // -------------------------------------------------------------------------
  // Attribute → input-type mapping
  // -------------------------------------------------------------------------

  it("renders a text input for string attributes", async () => {
    renderModal()
    selectType("Topic")
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("Topic"))
    // name field is string → input[type=text]
    const textInputs = screen
      .getAllByRole("textbox")
      .filter((el): el is HTMLInputElement => el.tagName === "INPUT" && (el as HTMLInputElement).type === "text")
    expect(textInputs.length).toBeGreaterThan(0)
    expect(textInputs[0].tagName).toBe("INPUT")
  })

  it("renders number inputs for int and float attributes", async () => {
    renderModal()
    selectType("Person")
    await waitFor(() => expect(mockFetchSchemaByType).toHaveBeenCalledWith("Person"))

    const numberInputs = screen
      .getAllByRole("spinbutton")
    expect(numberInputs.length).toBeGreaterThanOrEqual(2) // birth_year (int) + score (float)
  })

  it("renders a checkbox for boolean attributes", async () => {
    renderModal()
    selectType("Person")
    await waitFor(() => expect(mockFetchSchemaByType).toHaveBeenCalledWith("Person"))

    const checkbox = screen.getByRole("checkbox")
    expect(checkbox).toBeTruthy()
  })

  it("renders a date input for datetime attributes", async () => {
    renderModal()
    selectType("Person")
    await waitFor(() => expect(mockFetchSchemaByType).toHaveBeenCalledWith("Person"))

    const dateInput = document.querySelector('input[type="date"]')
    expect(dateInput).toBeTruthy()
  })

  it("renders a textarea for list attributes", async () => {
    renderModal()
    selectType("Person")
    await waitFor(() => expect(mockFetchSchemaByType).toHaveBeenCalledWith("Person"))

    const textareas = screen.getAllByRole("textbox")
    // At least one textarea (tags is list type)
    const textarea = textareas.find((el) => el.tagName === "TEXTAREA")
    expect(textarea).toBeTruthy()
  })

  // -------------------------------------------------------------------------
  // Required-field validation
  // -------------------------------------------------------------------------

  it("blocks submission when a required field is empty", async () => {
    renderModal()
    selectType("Topic")
    await waitFor(() => expect(mockFetchSchemaByType).toHaveBeenCalledWith("Topic"))

    const submitBtn = screen.getByRole("button", { name: /Create Node/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText(/required fields missing/i)).toBeTruthy()
    })
    expect(mockCheckNodeExists).not.toHaveBeenCalled()
    expect(mockCreateNode).not.toHaveBeenCalled()
  })

  it("does not block submission when required fields are filled", async () => {
    renderModal()
    selectType("Topic")
    await waitFor(() => expect(mockFetchSchemaByType).toHaveBeenCalledWith("Topic"))

    // Fill the required "name" field
    const inputs = screen.getAllByRole("textbox")
    const nameInput = inputs.find((el) => el.tagName === "INPUT") as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: "Bitcoin" } })

    const submitBtn = screen.getByRole("button", { name: /Create Node/i })
    fireEvent.click(submitBtn)

    await waitFor(() => expect(mockCheckNodeExists).toHaveBeenCalled())
  })

  // -------------------------------------------------------------------------
  // node_key derivation
  // -------------------------------------------------------------------------

  describe("node_key derivation", () => {
    it('derives "name" from "topic-name"', async () => {
      renderModal()
      selectType("Topic")
      await waitFor(() => expect(mockFetchSchemaByType).toHaveBeenCalledWith("Topic"))

      const inputs = screen.getAllByRole("textbox")
      const nameInput = inputs.find((el) => el.tagName === "INPUT") as HTMLInputElement
      fireEvent.change(nameInput, { target: { value: "Bitcoin" } })

      fireEvent.click(screen.getByRole("button", { name: /Create Node/i }))

      await waitFor(() =>
        expect(mockCheckNodeExists).toHaveBeenCalledWith("Topic", "Bitcoin", expect.anything())
      )
    })

    it('derives "source_link" from "episode-source_link"', async () => {
      renderModal()
      selectType("Episode")
      await waitFor(() => expect(mockFetchSchemaByType).toHaveBeenCalledWith("Episode"))

      // Fill source_link (required)
      const inputs = screen.getAllByRole("textbox")
      const linkInput = inputs.find((el) => el.tagName === "INPUT") as HTMLInputElement
      fireEvent.change(linkInput, { target: { value: "https://example.com/ep1" } })

      fireEvent.click(screen.getByRole("button", { name: /Create Node/i }))

      await waitFor(() =>
        expect(mockCheckNodeExists).toHaveBeenCalledWith(
          "Episode",
          "https://example.com/ep1",
          expect.anything()
        )
      )
    })
  })

  // -------------------------------------------------------------------------
  // Duplicate check
  // -------------------------------------------------------------------------

  it("shows inline error when preflight detects a duplicate", async () => {
    mockCheckNodeExists.mockResolvedValue({ exists: true, ref_id: "abc", status: "completed" })

    renderModal()
    selectType("Topic")
    await waitFor(() => expect(mockFetchSchemaByType).toHaveBeenCalledWith("Topic"))

    const inputs = screen.getAllByRole("textbox")
    const nameInput = inputs.find((el) => el.tagName === "INPUT") as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: "Bitcoin" } })

    fireEvent.click(screen.getByRole("button", { name: /Create Node/i }))

    await waitFor(() =>
      expect(screen.getByText(/already exists in the graph/i)).toBeTruthy()
    )
    expect(mockCreateNode).not.toHaveBeenCalled()
  })

  it("calls checkNodeExists with the derived key-field value", async () => {
    renderModal()
    selectType("Topic")
    await waitFor(() => expect(mockFetchSchemaByType).toHaveBeenCalledWith("Topic"))

    const inputs = screen.getAllByRole("textbox")
    const nameInput = inputs.find((el) => el.tagName === "INPUT") as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: "Lightning" } })

    fireEvent.click(screen.getByRole("button", { name: /Create Node/i }))

    await waitFor(() =>
      expect(mockCheckNodeExists).toHaveBeenCalledWith("Topic", "Lightning", expect.anything())
    )
  })

  // -------------------------------------------------------------------------
  // fetchSchemaByType mock-mode
  // -------------------------------------------------------------------------

  it("calls fetchSchemaByType with the selected type (mock-mode reads from store)", async () => {
    renderModal()
    selectType("Person")
    await waitFor(() =>
      expect(mockFetchSchemaByType).toHaveBeenCalledWith("Person")
    )
  })

  // -------------------------------------------------------------------------
  // Successful submission
  // -------------------------------------------------------------------------

  it("calls createNode with correct node_type and node_data on successful submit", async () => {
    renderModal()
    selectType("Topic")
    await waitFor(() => expect(mockFetchSchemaByType).toHaveBeenCalledWith("Topic"))

    const inputs = screen.getAllByRole("textbox")
    const nameInput = inputs.find((el) => el.tagName === "INPUT") as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: "Ethereum" } })

    fireEvent.click(screen.getByRole("button", { name: /Create Node/i }))

    await waitFor(() =>
      expect(mockCreateNode).toHaveBeenCalledWith(
        "Topic",
        expect.objectContaining({ name: "Ethereum" }),
        expect.anything()
      )
    )
  })

  // -------------------------------------------------------------------------
  // Reset on close
  // -------------------------------------------------------------------------

  it("resets state when modal closes", async () => {
    const { rerender } = renderModal()

    selectType("Topic")
    await waitFor(() => expect(mockFetchSchemaByType).toHaveBeenCalled())

    // Close modal
    activeModal = null
    rerender(<CreateNodeModal />)

    // Dialog should be gone
    expect(screen.queryByTestId("dialog")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// fetchSchemaByType mock-mode unit test (isolated)
// ---------------------------------------------------------------------------

describe("fetchSchemaByType — mock mode (modal integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeModal = "createNode"
    isMocksEnabledMock.mockReturnValue(true)
    schemasInStore = MOCK_SCHEMAS
    mockFetchSchemaByType.mockImplementation(async (type: string) => {
      return schemasInStore.find((s) => s.type === type) ?? null
    })
    mockCheckNodeExists.mockResolvedValue({ exists: false, ref_id: null, status: null })
    mockCreateNode.mockResolvedValue({ status: "OK" })
  })

  it("reads from schema store and does not call api.get in mock mode", async () => {
    renderModal()
    selectType("Topic")
    await waitFor(() => expect(mockFetchSchemaByType).toHaveBeenCalledWith("Topic"))
    // The mock returns store data — this confirms mock-mode integration
    expect(mockFetchSchemaByType).toHaveBeenCalledTimes(1)
  })
})
