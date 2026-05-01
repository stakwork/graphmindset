import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import React from "react"

// --- store mocks ---
let railPubKey = ""
vi.mock("@/stores/user-store", () => ({
  useUserStore: () => ({
    pubKey: railPubKey,
    isAdmin: false,
    budget: 0,
  }),
}))

vi.mock("@/stores/app-store", () => ({
  useAppStore: (sel?: (s: unknown) => unknown) => {
    const state = { graphName: "Test Graph" }
    return sel ? sel(state) : state
  },
}))

vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel: (s: { open: () => void }) => unknown) =>
    sel({ open: vi.fn() }),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/lib/sphinx/detect", () => ({
  isSphinx: () => false,
}))

vi.mock("@/lib/sphinx/bridge", () => ({
  hasWebLN: () => false,
}))

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}))

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ render, children }: { render?: React.ReactElement; children?: React.ReactNode }) =>
    render ? <>{render}</> : <>{children}</>,
}))

import { AppRail } from "@/components/layout/app-rail"

const noop = () => {}
const defaultProps = {
  onToggleMyContent: noop,
  myContentOpen: false,
  onToggleSources: noop,
  sourcesOpen: false,
}

describe("AppRail – My Content nav item visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    railPubKey = ""
  })

  it("shows My Content nav item when pubKey is empty", () => {
    railPubKey = ""
    render(<AppRail {...defaultProps} />)
    expect(screen.getByLabelText("My Content")).toBeInTheDocument()
  })

  it("shows My Content nav item when pubKey is set", () => {
    railPubKey = "03abc123testkey"
    render(<AppRail {...defaultProps} />)
    expect(screen.getByLabelText("My Content")).toBeInTheDocument()
  })
})
