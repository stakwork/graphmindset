/**
 * Tests for the frontend skin system:
 * - Skin registry (src/skins/index.ts): required fields, graceful fallback
 * - AppLayout: renders correct LeftPane/GraphPane for each skin
 * - AppearanceSettings: card selection + Save POSTs correct payload
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import React from "react"

// ─── User-store mock ───────────────────────────────────────────────────────────
vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel?: (s: { isAdmin: boolean }) => unknown) => {
    const state = { isAdmin: true }
    return sel ? sel(state) : state
  },
}))

// ─── Shared app-store mock (single declaration — vi.mock is hoisted) ───────────

const appStoreMockState = {
  activeSkin: "default" as string,
  setActiveSkin: vi.fn(),
  graphName: "My Graph",
  graphDescription: "A description",
}
vi.mock("@/stores/app-store", () => ({
  useAppStore: (sel?: (s: typeof appStoreMockState) => unknown) =>
    sel ? sel(appStoreMockState) : appStoreMockState,
}))

// ─── Stubs for panels – we only care which component is rendered ───────────────
vi.mock("@/components/layout/left-pane", () => ({
  LeftPane: () => <div data-testid="default-left-pane" />,
}))
vi.mock("@/components/universe/graph-pane", () => ({
  GraphPane: () => <div data-testid="default-graph-pane" />,
}))
vi.mock("@/skins/legal/legal-left-pane", () => ({
  LegalLeftPane: () => <div data-testid="legal-left-pane" />,
}))
vi.mock("@/skins/legal/legal-graph-pane", () => ({
  LegalGraphPane: () => <div data-testid="legal-graph-pane" />,
}))

// ─── AppLayout dependencies ────────────────────────────────────────────────────
vi.mock("@/hooks/use-neighbor-fetch", () => ({ useNeighborFetch: vi.fn() }))
vi.mock("@/hooks/use-deep-link", () => ({ useDeepLink: vi.fn() }))
vi.mock("@/hooks/use-panel-graph-sync", () => ({ usePanelGraphSync: vi.fn() }))
vi.mock("@/lib/mock-data", () => ({ isMocksEnabled: vi.fn().mockReturnValue(false) }))
vi.mock("@/app/ontology/mock-small", () => ({ SMALL_SCHEMAS: [] }))
vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel?: (s: { schemas: unknown[]; fetchAll: () => void }) => unknown) => {
    const state = { schemas: [], fetchAll: vi.fn() }
    return sel ? sel(state) : state
  },
}))
vi.mock("@/components/modals/add-modal", () => ({ AddModal: () => null }))
vi.mock("@/components/modals/budget-modal", () => ({ BudgetModal: () => null }))
vi.mock("@/components/modals/edit-node-modal", () => ({ EditNodeModal: () => null }))
vi.mock("@/components/player/media-player", () => ({ MediaPlayer: () => null }))

// Fix: include Panel, Group, Separator so resizable.tsx can import them
vi.mock("react-resizable-panels", () => {
  const PanelGroupComp = ({ children }: { children: React.ReactNode }) => <div>{children}</div>
  const PanelComp = ({ children }: { children: React.ReactNode }) => <div>{children}</div>
  const SeparatorComp = () => null
  return {
    Group: PanelGroupComp,
    Panel: PanelComp,
    Separator: SeparatorComp,
    useDefaultLayout: vi.fn().mockReturnValue({ defaultLayout: null, onLayoutChanged: vi.fn() }),
  }
})

vi.mock("@/lib/utils", () => ({
  cn: (...args: (string | undefined | null | false)[]) => args.filter(Boolean).join(" "),
}))

// ─── API mock ──────────────────────────────────────────────────────────────────
const mockApiPost = vi.fn().mockResolvedValue({})
vi.mock("@/lib/api", () => ({
  api: { post: (...args: unknown[]) => mockApiPost(...args) },
}))

// ─── Skin registry ─────────────────────────────────────────────────────────────

describe("Skin registry – SKINS", () => {
  it("SKINS['default'] has all required fields", async () => {
    const { SKINS } = await import("@/skins/index")
    const s = SKINS["default"]
    expect(s.id).toBe("default")
    expect(s.label).toBeTruthy()
    expect(s.description).toBeTruthy()
    expect(typeof s.LeftPane).toBe("function")
    expect(typeof s.GraphPane).toBe("function")
    expect(s.themeClass).toBeUndefined()
  })

  it("SKINS['legal'] has all required fields and themeClass", async () => {
    const { SKINS } = await import("@/skins/index")
    const s = SKINS["legal"]
    expect(s.id).toBe("legal")
    expect(s.label).toBeTruthy()
    expect(s.description).toBeTruthy()
    expect(typeof s.LeftPane).toBe("function")
    expect(typeof s.GraphPane).toBe("function")
    expect(s.themeClass).toBe("skin-legal")
  })

  it("falls back to SKINS.default when activeSkin is undefined", async () => {
    const { SKINS } = await import("@/skins/index")
    const skin = SKINS[undefined as unknown as "default"] ?? SKINS.default
    expect(skin.id).toBe("default")
  })
})

// ─── AppLayout skin wiring ─────────────────────────────────────────────────────

describe("AppLayout – skin wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiPost.mockResolvedValue({})
  })

  it("renders DefaultLeftPane and DefaultGraphPane for 'default' skin", async () => {
    appStoreMockState.activeSkin = "default"
    const { AppLayout } = await import("@/components/layout/app-layout")
    render(<AppLayout />)
    expect(screen.getByTestId("default-left-pane")).toBeInTheDocument()
    expect(screen.getByTestId("default-graph-pane")).toBeInTheDocument()
    expect(screen.queryByTestId("legal-left-pane")).not.toBeInTheDocument()
  })

  it("renders LegalLeftPane and LegalGraphPane for 'legal' skin", async () => {
    appStoreMockState.activeSkin = "legal"
    const { AppLayout } = await import("@/components/layout/app-layout")
    render(<AppLayout />)
    expect(screen.getByTestId("legal-left-pane")).toBeInTheDocument()
    expect(screen.getByTestId("legal-graph-pane")).toBeInTheDocument()
    expect(screen.queryByTestId("default-left-pane")).not.toBeInTheDocument()
  })

  it("applies skin-legal themeClass to wrapper for 'legal' skin", async () => {
    appStoreMockState.activeSkin = "legal"
    const { AppLayout } = await import("@/components/layout/app-layout")
    const { container } = render(<AppLayout />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain("skin-legal")
  })

  it("does not apply any themeClass for 'default' skin", async () => {
    appStoreMockState.activeSkin = "default"
    const { AppLayout } = await import("@/components/layout/app-layout")
    const { container } = render(<AppLayout />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).not.toContain("skin-legal")
  })
})

// ─── AppearanceSettings ─────────────────────────────────────────────────────────

describe("AppearanceSettings – skin selection and save", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appStoreMockState.activeSkin = "default"
    mockApiPost.mockResolvedValue({})
  })

  async function renderAppearance(skinOverride = "default") {
    appStoreMockState.activeSkin = skinOverride
    const { AppearanceSettings } = await import("@/app/settings/appearance-settings")
    render(<AppearanceSettings open={true} />)
  }

  it("renders skin cards for all skins", async () => {
    await renderAppearance()
    expect(screen.getByText("Default")).toBeInTheDocument()
    expect(screen.getByText("Legal")).toBeInTheDocument()
  })

  it("Save button is disabled when no change from active skin", async () => {
    await renderAppearance("default")
    const btn = screen.getByRole("button", { name: /Save Appearance/i })
    expect(btn).toBeDisabled()
  })

  it("enables Save button after selecting a different skin", async () => {
    await renderAppearance("default")
    // Click the "Legal" card button
    const legalCard = screen.getByText("Legal").closest("button") as HTMLElement
    fireEvent.click(legalCard)
    const btn = screen.getByRole("button", { name: /Save Appearance/i })
    expect(btn).not.toBeDisabled()
  })

  it("POSTs { ui_skin: 'legal' } to /about on Save", async () => {
    await renderAppearance("default")
    const legalCard = screen.getByText("Legal").closest("button") as HTMLElement
    fireEvent.click(legalCard)
    fireEvent.click(screen.getByRole("button", { name: /Save Appearance/i }))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith("/about", {
        title: "My Graph",
        description: "A description",
        ui_skin: "legal",
      })
    })
  })

  it("dispatches setActiveSkin('legal') after successful save", async () => {
    await renderAppearance("default")
    const legalCard = screen.getByText("Legal").closest("button") as HTMLElement
    fireEvent.click(legalCard)
    fireEvent.click(screen.getByRole("button", { name: /Save Appearance/i }))

    await waitFor(() => {
      expect(appStoreMockState.setActiveSkin).toHaveBeenCalledWith("legal")
    })
  })

  it("POSTs { ui_skin: 'default' } when switching back to Default", async () => {
    await renderAppearance("legal")
    const defaultCard = screen.getByText("Default").closest("button") as HTMLElement
    fireEvent.click(defaultCard)
    fireEvent.click(screen.getByRole("button", { name: /Save Appearance/i }))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith("/about", {
        title: "My Graph",
        description: "A description",
        ui_skin: "default",
      })
    })
  })

  it("renders nothing when open=false", async () => {
    const { AppearanceSettings } = await import("@/app/settings/appearance-settings")
    const { container } = render(<AppearanceSettings open={false} />)
    expect(container.firstChild).toBeNull()
  })
})
