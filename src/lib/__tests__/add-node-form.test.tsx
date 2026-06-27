/**
 * Tests for AddNodeForm error-surfacing behaviour.
 * Verifies that when createNode() throws a non-402 Response, the actual
 * Jarvis error body is extracted and shown — not the generic fallback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"

// ---------------------------------------------------------------------------
// Hoisted mocks — must be set up before any imports that reference the modules
// ---------------------------------------------------------------------------

const { mockCheckNodeExists, mockCreateNode, mockGetPrice, mockGetSchemaDomains } = vi.hoisted(
  () => ({
    mockCheckNodeExists: vi.fn().mockResolvedValue({ exists: false }),
    mockCreateNode: vi.fn().mockResolvedValue({ status: "ok" }),
    mockGetPrice: vi.fn().mockResolvedValue(0),
    mockGetSchemaDomains: vi.fn().mockResolvedValue({ hidden_types: [], hidden_domains: [] }),
  })
)

vi.mock("@/lib/graph-api", () => ({
  checkNodeExists: (...args: unknown[]) => mockCheckNodeExists(...args),
  createNode: (...args: unknown[]) => mockCreateNode(...args),
  getSchemaDomains: (...args: unknown[]) => mockGetSchemaDomains(...args),
  addImageContent: vi.fn(),
  ALLOWED_IMAGE_TYPES: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  MAX_IMAGE_UPLOAD_BYTES: 10 * 1024 * 1024,
}))

vi.mock("@/lib/sphinx", () => ({
  getPrice: (...args: unknown[]) => mockGetPrice(...args),
  payL402: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Modal store — preselectedNodeType = "Lingo" to skip type selection
// ---------------------------------------------------------------------------
const mockClose = vi.fn()
let mockPreselectedNodeType: string | null = "Lingo"

vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel?: (s: unknown) => unknown) => {
    const state = {
      activeModal: "add",
      close: mockClose,
      preselectedNodeType: mockPreselectedNodeType,
    }
    return sel ? sel(state) : state
  },
}))

// ---------------------------------------------------------------------------
// User store
// ---------------------------------------------------------------------------
const mockSetBudget = vi.fn()

vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel?: (s: unknown) => unknown) => {
    const state = {
      pubKey: "testpubkey",
      routeHint: "",
      isAdmin: false,
      budget: 500,
      setBudget: mockSetBudget,
    }
    return sel ? sel(state) : state
  },
}))

// ---------------------------------------------------------------------------
// Schema store — Lingo schema with name (required) and lingo_type (optional)
// ---------------------------------------------------------------------------
const LINGO_SCHEMA = {
  ref_id: "lingo-ref",
  type: "Lingo",
  parent: "Thing",
  node_key: "lingo-name",
  color: "#64748b",
  attributes: [
    { key: "name", type: "string", required: true },
    { key: "definition", type: "string", required: false },
    { key: "lingo_type", type: "string", required: false },
  ],
  inherited_attributes: [],
}

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel?: (s: unknown) => unknown) => {
    const state = { schemas: [LINGO_SCHEMA], edges: [] }
    return sel ? sel(state) : state
  },
}))

// ---------------------------------------------------------------------------
// Import component after mocks
// ---------------------------------------------------------------------------
import { AddNodeForm } from "@/components/modals/add-node-form"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fill the name field and click submit */
async function fillAndSubmit(name = "test lingo") {
  const nameInput = await screen.findByPlaceholderText("Required")
  await userEvent.clear(nameInput)
  await userEvent.type(nameInput, name)
  const submitBtn = screen.getByRole("button", { name: /add lingo/i })
  await userEvent.click(submitBtn)
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks()
  mockPreselectedNodeType = "Lingo"
  mockCheckNodeExists.mockResolvedValue({ exists: false })
  mockCreateNode.mockResolvedValue({ status: "ok" })
  mockGetPrice.mockResolvedValue(0)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AddNodeForm — error body surfacing", () => {
  it("a. displays the Jarvis 400 message body instead of generic fallback", async () => {
    const errorResponse = new Response(
      JSON.stringify({ message: "Unknown attribute 'lingo_type' for schema 'Lingo'." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
    mockCreateNode.mockRejectedValue(errorResponse)

    render(<AddNodeForm />)
    await fillAndSubmit()

    await waitFor(() => {
      expect(
        screen.getByText("Unknown attribute 'lingo_type' for schema 'Lingo'.")
      ).toBeInTheDocument()
    })
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument()
  })

  it("b. displays errorCode when message is absent", async () => {
    const errorResponse = new Response(
      JSON.stringify({ errorCode: "ERROR_SCHEMA_ATTRIBUTE_UNKNOWN" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
    mockCreateNode.mockRejectedValue(errorResponse)

    render(<AddNodeForm />)
    await fillAndSubmit()

    await waitFor(() => {
      expect(screen.getByText("ERROR_SCHEMA_ATTRIBUTE_UNKNOWN")).toBeInTheDocument()
    })
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument()
  })

  it("c. displays HTTP status fallback when body is unparseable", async () => {
    const errorResponse = new Response("not json", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    })
    mockCreateNode.mockRejectedValue(errorResponse)

    render(<AddNodeForm />)
    await fillAndSubmit()

    await waitFor(() => {
      expect(screen.getByText("Node creation failed (HTTP 400)")).toBeInTheDocument()
    })
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument()
  })

  it("d. displays generic fallback for non-Response throws", async () => {
    mockCreateNode.mockRejectedValue(new Error("network failure"))

    render(<AddNodeForm />)
    await fillAndSubmit()

    await waitFor(() => {
      expect(
        screen.getByText("Something went wrong. Please try again.")
      ).toBeInTheDocument()
    })
  })
})
