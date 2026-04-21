import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import React from "react"

// --- mock api ---
const mockApiGet = vi.fn()
vi.mock("@/lib/api", () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}))

// --- mock stores ---
interface MyContentUserStore {
  pubKey: string
  routeHint: string
  isAdmin: boolean
}
let myContentUserOverrides: Partial<MyContentUserStore> = {}
vi.mock("@/stores/user-store", () => ({
  useUserStore: () => ({
    pubKey: "03abc123testkey",
    routeHint: "",
    isAdmin: false,
    ...myContentUserOverrides,
  }),
}))

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel: (s: { schemas: never[] }) => unknown) =>
    sel({ schemas: [] }),
}))

const mockOpen = vi.fn()
vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel: (s: { open: typeof mockOpen }) => unknown) =>
    sel({ open: mockOpen }),
}))

// --- mock mock-data (disable mock mode so tests hit api.get) ---
vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => false,
  MOCK_CONTENT: { nodes: [], totalCount: 0, totalProcessing: 0 },
}))

// --- mock node-preview-panel ---
vi.mock("@/components/layout/node-preview-panel", () => ({
  NodePreviewPanel: () => <div data-testid="node-preview" />,
}))

import { MyContentPanel } from "@/components/layout/my-content-panel"

const TWO_NODES = {
  nodes: [
    {
      node_type: "Tweet",
      ref_id: "ref-1",
      properties: { name: "Bitcoin is freedom", status: "complete" },
    },
    {
      node_type: "Podcast",
      ref_id: "ref-2",
      properties: { name: "What Bitcoin Did #412", status: "processing" },
    },
  ],
  totalCount: 2,
  totalProcessing: 1,
}

const EMPTY_RESPONSE = {
  nodes: [],
  totalCount: 0,
  totalProcessing: 0,
}

describe("MyContentPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    myContentUserOverrides = {}
  })

  it("renders items with processing banner", async () => {
    mockApiGet.mockResolvedValue(TWO_NODES)
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText("Bitcoin is freedom")).toBeInTheDocument()
    })

    expect(screen.getByText("What Bitcoin Did #412")).toBeInTheDocument()
    expect(screen.getByText(/1 item.* still processing/i)).toBeInTheDocument()
  })

  it("renders empty state with Add Content button", async () => {
    mockApiGet.mockResolvedValue(EMPTY_RESPONSE)
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText("No content yet")).toBeInTheDocument()
    })

    expect(screen.getByRole("button", { name: /add content/i })).toBeInTheDocument()
    expect(screen.getByText("Add content and start earning money for contributing")).toBeInTheDocument()
    expect(screen.queryByText(/still processing/i)).not.toBeInTheDocument()
  })

  it("renders read-only boost amount when node has boost property", async () => {
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: { name: "Bitcoin is freedom", status: "complete", boost: 150 },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("150")).toBeInTheDocument()
      expect(screen.getByText("sats")).toBeInTheDocument()
    })
  })

  it("renders no boost display when boost is absent", async () => {
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: { name: "Bitcoin is freedom", status: "complete" },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.queryByText("sats")).not.toBeInTheDocument()
    })
  })

  it("calls the correct API endpoint", async () => {
    mockApiGet.mockResolvedValue(EMPTY_RESPONSE)
    render(<MyContentPanel onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText("No content yet")).toBeInTheDocument()
    })

    expect(mockApiGet).toHaveBeenCalledWith(
      "/v2/content?pubkey=03abc123testkey&sort_by=date&limit=100"
    )
  })

  it("hides boost sats display when node pubkey matches user pubKey (contributor)", async () => {
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: { name: "Bitcoin is freedom", status: "complete", boost: 150, pubkey: "03abc123testkey" },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    // pubKey matches node pubkey, no routeHint
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: false }
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("Bitcoin is freedom")).toBeInTheDocument()
    })
    expect(screen.queryByText("sats")).not.toBeInTheDocument()
  })

  it("hides boost sats display when isAdmin is true", async () => {
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: { name: "Bitcoin is freedom", status: "complete", boost: 200, pubkey: "03someoneelse" },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: true }
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("Bitcoin is freedom")).toBeInTheDocument()
    })
    expect(screen.queryByText("sats")).not.toBeInTheDocument()
  })
})

describe("MyContentPanel – Stakwork badge link", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    myContentUserOverrides = {}
  })

  it("renders badge as <a> with correct href when admin + project_id + error status", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: true }
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: { name: "Failed Node", status: "error", project_id: "99999" },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("Failed Node")).toBeInTheDocument()
    })
    const link = screen.getByRole("link", { name: /failed/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute("href", "https://jobs.stakwork.com/admin/projects/99999")
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("renders badge as plain <span> (no <a>) when non-admin with project_id", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: false }
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: { name: "Failed Node", status: "error", project_id: "99999" },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("Failed Node")).toBeInTheDocument()
    })
    expect(screen.queryByRole("link", { name: /failed/i })).toBeNull()
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })

  it("renders badge as plain <span> (no <a>) when admin but no project_id", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: true }
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: { name: "Failed Node", status: "error" },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("Failed Node")).toBeInTheDocument()
    })
    expect(screen.queryByRole("link", { name: /failed/i })).toBeNull()
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })

  it("stopPropagation: clicking badge link does not trigger parent row onClick", async () => {
    myContentUserOverrides = { pubKey: "03abc123testkey", routeHint: "", isAdmin: true }
    mockApiGet.mockResolvedValue({
      nodes: [
        {
          node_type: "Tweet",
          ref_id: "ref-1",
          properties: { name: "Failed Node", status: "error", project_id: "99999" },
        },
      ],
      totalCount: 1,
      totalProcessing: 0,
    })
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("Failed Node")).toBeInTheDocument()
    })
    const link = screen.getByRole("link", { name: /failed/i })
    // Should not open node preview panel after clicking link
    fireEvent.click(link)
    expect(screen.queryByTestId("node-preview")).toBeNull()
  })
})
