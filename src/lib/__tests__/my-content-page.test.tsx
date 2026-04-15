import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import React from "react"

// --- mock next/navigation ---
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// --- mock AuthGuard (render children directly) ---
vi.mock("@/components/auth/auth-guard", () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// --- mock api ---
const mockApiGet = vi.fn()
vi.mock("@/lib/api", () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}))

// --- mock user store ---
vi.mock("@/stores/user-store", () => ({
  useUserStore: () => ({ pubKey: "03abc123testkey" }),
}))

const mockOpen = vi.fn()
vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel: (s: { open: typeof mockOpen }) => unknown) =>
    sel({ open: mockOpen }),
}))

import MyContentPage from "@/app/my-content/page"

const TWO_NODES = {
  nodes: [
    {
      node_type: "web_page",
      ref_id: "ref-1",
      properties: {
        source: "https://example.com",
        source_type: "web_page",
        status: "complete",
      },
    },
    {
      node_type: "tweet",
      ref_id: "ref-2",
      properties: {
        source: "https://twitter.com/user/status/123",
        source_type: "tweet",
        status: "processing",
      },
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

describe("MyContentPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders items, status badges, and processing banner", async () => {
    mockApiGet.mockResolvedValue(TWO_NODES)
    render(<MyContentPage />)

    // Wait for content to load
    await waitFor(() => {
      expect(screen.getByText("https://example.com")).toBeInTheDocument()
    })

    // Both items rendered
    expect(screen.getByText("https://example.com")).toBeInTheDocument()
    expect(screen.getByText("https://twitter.com/user/status/123")).toBeInTheDocument()

    // Status badges
    expect(screen.getByText("Complete")).toBeInTheDocument()
    expect(screen.getByText("Processing")).toBeInTheDocument()

    // Amber processing banner
    expect(screen.getByText(/1 item.* still processing/i)).toBeInTheDocument()
  })

  it("renders empty state with Add Content button when no nodes", async () => {
    mockApiGet.mockResolvedValue(EMPTY_RESPONSE)
    render(<MyContentPage />)

    await waitFor(() => {
      expect(screen.getByText("No content yet")).toBeInTheDocument()
    })

    expect(screen.getByRole("button", { name: /add content/i })).toBeInTheDocument()
    // No processing banner
    expect(screen.queryByText(/still processing/i)).not.toBeInTheDocument()
  })

  it("calls api.get with the correct pubkey query param", async () => {
    mockApiGet.mockResolvedValue(EMPTY_RESPONSE)
    render(<MyContentPage />)
    await waitFor(() => {
      expect(screen.getByText("No content yet")).toBeInTheDocument()
    })
    expect(mockApiGet).toHaveBeenCalledWith("/v2/content?pubkey=03abc123testkey")
  })
})
