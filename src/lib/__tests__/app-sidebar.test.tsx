import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import React from "react"

// --- mock next/navigation ---
const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}))

// --- mock stores ---
const mockUserStore = vi.fn()
vi.mock("@/stores/user-store", () => ({
  useUserStore: () => mockUserStore(),
}))

vi.mock("@/stores/app-store", () => ({
  useAppStore: () => ({ graphName: "Test Graph" }),
}))

vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel: (s: { open: () => void }) => unknown) =>
    sel({ open: vi.fn() }),
}))

// --- mock sphinx ---
vi.mock("@/lib/sphinx/detect", () => ({ isSphinx: () => false }))
vi.mock("@/lib/sphinx/bridge", () => ({ hasWebLN: () => false }))

import { AppSidebar } from "@/components/layout/app-sidebar"

describe("AppSidebar – My Content nav item", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders 'My Content' nav item when pubKey is set", () => {
    mockUserStore.mockReturnValue({ isAdmin: false, budget: 0, pubKey: "03abc123" })
    render(<AppSidebar sourcesOpen={false} onToggleSources={() => {}} />)
    expect(screen.getByText("My Content")).toBeInTheDocument()
  })

  it("does NOT render 'My Content' nav item when pubKey is empty", () => {
    mockUserStore.mockReturnValue({ isAdmin: false, budget: 0, pubKey: "" })
    render(<AppSidebar sourcesOpen={false} onToggleSources={() => {}} />)
    expect(screen.queryByText("My Content")).not.toBeInTheDocument()
  })
})
