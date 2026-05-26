import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSearchNodes } = vi.hoisted(() => ({
  mockSearchNodes: vi.fn(),
}))

vi.mock("@/lib/graph-api", () => ({
  searchNodes: (...args: unknown[]) => mockSearchNodes(...args),
}))

vi.mock("@/lib/node-display", () => ({
  resolveNodeTitle: (node: { ref_id: string; properties?: Record<string, unknown> }) => {
    return (node.properties?.name as string) ?? node.ref_id
  },
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { NodeSearchInput } from "@/components/ui/node-search-input"
import type { GraphNode } from "@/lib/graph-api"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NODE_A: GraphNode = {
  ref_id: "node-abc-123",
  node_type: "Person",
  properties: { name: "Alice" },
}

const NODE_B: GraphNode = {
  ref_id: "node-xyz-456",
  node_type: "Topic",
  properties: { name: "Blockchain" },
}

const NODE_LONG_ID: GraphNode = {
  ref_id: "averylongrefidthatexceeds12chars",
  node_type: "Content",
  properties: { name: "Long ID Node" },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NodeSearchInput", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchNodes.mockResolvedValue({ nodes: [NODE_A, NODE_B] })
  })

  it("renders search input when value is null", () => {
    render(<NodeSearchInput value={null} onChange={vi.fn()} placeholder="Find node…" />)
    expect(screen.getByPlaceholderText("Find node…")).toBeInTheDocument()
  })

  it("renders selected state with title and type badge when value is a node", () => {
    render(<NodeSearchInput value={NODE_A} onChange={vi.fn()} />)
    expect(screen.getByText("Alice")).toBeInTheDocument()
    expect(screen.getByText("Person")).toBeInTheDocument()
    // No text input in selected state
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  })

  it("does NOT call searchNodes when query is empty", async () => {
    render(<NodeSearchInput value={null} onChange={vi.fn()} />)
    const input = screen.getByRole("textbox")
    await userEvent.click(input)
    // No typing — just wait a bit
    await new Promise((r) => setTimeout(r, 400))
    expect(mockSearchNodes).not.toHaveBeenCalled()
  })

  it("calls searchNodes after debounce when user types a query", async () => {
    render(<NodeSearchInput value={null} onChange={vi.fn()} />)
    const input = screen.getByRole("textbox")
    await userEvent.type(input, "alice")
    await waitFor(() => expect(mockSearchNodes).toHaveBeenCalledWith(
      "alice",
      { limit: 10 },
      expect.anything()
    ), { timeout: 1000 })
  })

  it("renders results dropdown with title, type badge, and truncated ref_id", async () => {
    render(<NodeSearchInput value={null} onChange={vi.fn()} />)
    const input = screen.getByRole("textbox")
    await userEvent.type(input, "alice")

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument()
      expect(screen.getByText("Blockchain")).toBeInTheDocument()
    }, { timeout: 1000 })

    // Type badges
    const personBadges = screen.getAllByText("Person")
    expect(personBadges.length).toBeGreaterThan(0)
    expect(screen.getByText("Topic")).toBeInTheDocument()

    // Truncated ref_ids
    expect(screen.getByText("node-abc-123")).toBeInTheDocument() // 12 chars exactly — no truncation
    expect(screen.getByText("node-xyz-456")).toBeInTheDocument()
  })

  it("truncates ref_id longer than 12 chars with ellipsis", async () => {
    mockSearchNodes.mockResolvedValue({ nodes: [NODE_LONG_ID] })
    render(<NodeSearchInput value={null} onChange={vi.fn()} />)
    const input = screen.getByRole("textbox")
    await userEvent.type(input, "long")

    await waitFor(() => {
      expect(screen.getByText("averylongref…")).toBeInTheDocument()
    }, { timeout: 1000 })
  })

  it("calls onChange with correct node and closes dropdown when result is clicked", async () => {
    const onChange = vi.fn()
    render(<NodeSearchInput value={null} onChange={onChange} />)
    const input = screen.getByRole("textbox")
    await userEvent.type(input, "alice")

    await waitFor(() => screen.getByText("Alice"), { timeout: 1000 })
    await userEvent.click(screen.getByText("Alice"))

    expect(onChange).toHaveBeenCalledWith(NODE_A)
    // Dropdown should be gone
    expect(screen.queryByText("Blockchain")).not.toBeInTheDocument()
  })

  it("shows 'No nodes found' empty state when API returns empty array", async () => {
    mockSearchNodes.mockResolvedValue({ nodes: [] })
    render(<NodeSearchInput value={null} onChange={vi.fn()} />)
    const input = screen.getByRole("textbox")
    await userEvent.type(input, "xyz")

    await waitFor(() => {
      expect(screen.getByText("No nodes found")).toBeInTheDocument()
    }, { timeout: 1000 })
  })

  it("X clear button resets to search state and calls onChange(null)", async () => {
    const onChange = vi.fn()
    render(<NodeSearchInput value={NODE_A} onChange={onChange} />)

    // Selected state visible
    expect(screen.getByText("Alice")).toBeInTheDocument()

    const clearBtn = screen.getByRole("button", { name: /clear selection/i })
    await userEvent.click(clearBtn)

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it("disabled prop disables the text input", () => {
    render(<NodeSearchInput value={null} onChange={vi.fn()} disabled />)
    const input = screen.getByRole("textbox") as HTMLInputElement
    expect(input.disabled).toBe(true)
  })

  it("outside click closes the open dropdown", async () => {
    render(
      <div>
        <NodeSearchInput value={null} onChange={vi.fn()} />
        <div data-testid="outside">outside</div>
      </div>
    )
    const input = screen.getByRole("textbox")
    await userEvent.type(input, "alice")

    await waitFor(() => screen.getByText("Alice"), { timeout: 1000 })

    // Click outside
    fireEvent.mouseDown(screen.getByTestId("outside"))

    await waitFor(() => {
      expect(screen.queryByText("Alice")).not.toBeInTheDocument()
    })
  })
})
