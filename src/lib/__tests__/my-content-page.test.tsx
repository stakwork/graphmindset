import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import React from "react"

// --- mock api ---
const mockApiGet = vi.fn()
vi.mock("@/lib/api", () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}))

// --- mock stores ---
let mockUserStore = { pubKey: "03abc123testkey", isAdmin: false }
vi.mock("@/stores/user-store", () => ({
  useUserStore: () => mockUserStore,
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

vi.mock("@/stores/graph-store", () => ({
  useGraphStore: (sel: (s: { setHoveredNode: () => void; setSidebarSelectedNode: () => void }) => unknown) =>
    sel({ setHoveredNode: vi.fn(), setSidebarSelectedNode: vi.fn() }),
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
    mockUserStore = { pubKey: "03abc123testkey", isAdmin: false }
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

  it("admin user sees Stakwork workflow link on node with project_id", async () => {
    mockUserStore = { pubKey: "03abc", isAdmin: true }
    mockApiGet.mockResolvedValue({
      nodes: [{
        node_type: "Podcast",
        ref_id: "ref-10",
        properties: { name: "Test Podcast", status: "processing", project_id: 12345 },
      }],
      totalCount: 1,
      totalProcessing: 1,
    })
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      const link = screen.getByRole("link", { name: /view stakwork workflow/i })
      expect(link).toHaveAttribute("href", "https://jobs.stakwork.com/admin/projects/12345")
      expect(link).toHaveAttribute("target", "_blank")
    })
  })

  it("non-admin user does not see Stakwork workflow link", async () => {
    mockApiGet.mockResolvedValue({
      nodes: [{
        node_type: "Podcast",
        ref_id: "ref-11",
        properties: { name: "Test Podcast", status: "processing", project_id: 12345 },
      }],
      totalCount: 1,
      totalProcessing: 1,
    })
    render(<MyContentPanel onClose={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText("Test Podcast")).toBeInTheDocument()
    })
    expect(screen.queryByRole("link", { name: /view stakwork workflow/i })).not.toBeInTheDocument()
  })
})
