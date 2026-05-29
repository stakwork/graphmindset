/**
 * Tests for src/app/settings/page.tsx
 *
 * Covers:
 * - Admin guard: non-admins are redirected to "/"
 * - Admin guard: authenticated non-admin renders null
 * - Admin-only tabs not rendered for non-admins
 * - General form fields present for admins
 * - Tab query-param logic: ?tab=janitors → "janitor" active (invalid tab falls back)
 * - Saving calls api.post("/about") and setGraphMeta
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import React, { Suspense } from "react"

// ── Store mocks ───────────────────────────────────────────────────────────────

const userState = { isAuthenticated: false, isAdmin: false }
vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel?: (s: unknown) => unknown) => (sel ? sel(userState) : userState),
}))

const appState = {
  graphName: "Test Graph",
  graphDescription: "A test description",
  setGraphMeta: vi.fn(),
}
vi.mock("@/stores/app-store", () => ({
  useAppStore: (sel?: (s: unknown) => unknown) => (sel ? sel(appState) : appState),
}))

const mockApiPost = vi.fn().mockResolvedValue({})
vi.mock("@/lib/api", () => ({
  api: { post: (...args: unknown[]) => mockApiPost(...args) },
}))

// ── Next.js mocks ─────────────────────────────────────────────────────────────

const mockReplace = vi.fn()
const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => mockSearchParams,
}))

let mockSearchParams: { get: (key: string) => string | null } = { get: () => null }

// ── Dynamic import shimmed to synchronous stubs ───────────────────────────────

vi.mock("@/components/modals/radar-settings", () => ({
  RadarSettings: ({ open }: { open: boolean }) =>
    open ? <div data-testid="radar-settings">Radar</div> : null,
}))
vi.mock("@/components/modals/janitor-settings", () => ({
  JanitorSettings: ({ open }: { open: boolean }) =>
    open ? <div data-testid="janitor-settings">Janitor</div> : null,
}))
vi.mock("@/components/modals/domain-settings", () => ({
  DomainSettings: ({ open }: { open: boolean }) =>
    open ? <div data-testid="domain-settings">Domains</div> : null,
}))

// next/dynamic is used in the page; replace with a passthrough so mocked modules are used
vi.mock("next/dynamic", () => ({
  default: (
    loader: () => Promise<{ default?: unknown; [k: string]: unknown }>,
    _opts?: unknown
  ) => {
    // Return a component that lazily calls the loader and renders
    // We need to resolve synchronously for tests; use a wrapper.
    const DynamicWrapper = (props: Record<string, unknown>) => {
      const [Comp, setComp] = React.useState<React.ComponentType<Record<string, unknown>> | null>(null)
      React.useEffect(() => {
        loader().then((mod) => {
          const exported = Object.values(mod).find(
            (v) => typeof v === "function"
          ) as React.ComponentType<Record<string, unknown>> | undefined
          if (exported) setComp(() => exported)
        })
      }, [])
      return Comp ? <Comp {...props} /> : null
    }
    return DynamicWrapper
  },
}))

// ── Input limits ─────────────────────────────────────────────────────────────

vi.mock("@/lib/input-limits", () => ({
  MAX_LENGTHS: { GRAPH_NAME: 100, GRAPH_DESCRIPTION: 500 },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

async function renderPage() {
  const { default: SettingsPage } = await import("@/app/settings/page")
  const { unmount } = render(
    <Suspense fallback={null}>
      <SettingsPage />
    </Suspense>
  )
  return { unmount }
}

beforeEach(() => {
  vi.clearAllMocks()
  userState.isAuthenticated = false
  userState.isAdmin = false
  mockSearchParams = { get: () => null }
  appState.graphName = "Test Graph"
  appState.graphDescription = "A test description"
})

// ── Admin guard ───────────────────────────────────────────────────────────────

describe("SettingsPage – admin guard", () => {
  it("redirects authenticated non-admin to /", async () => {
    userState.isAuthenticated = true
    userState.isAdmin = false
    await renderPage()
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/")
    })
  })

  it("renders null when authenticated and not admin", async () => {
    userState.isAuthenticated = true
    userState.isAdmin = false
    const { unmount } = await renderPage()
    // page returns null for non-admins
    await waitFor(() => {
      expect(screen.queryByText("Graph Settings")).not.toBeInTheDocument()
    })
    unmount()
  })

  it("does NOT redirect when isAdmin=true", async () => {
    userState.isAuthenticated = true
    userState.isAdmin = true
    await renderPage()
    await waitFor(() => {
      expect(mockReplace).not.toHaveBeenCalled()
    })
  })

  it("does NOT redirect when not yet authenticated", async () => {
    userState.isAuthenticated = false
    userState.isAdmin = false
    await renderPage()
    // no redirect fired because the guard only fires when isAuthenticated && !isAdmin
    expect(mockReplace).not.toHaveBeenCalled()
  })
})

// ── General tab content ───────────────────────────────────────────────────────

describe("SettingsPage – General tab", () => {
  beforeEach(() => {
    userState.isAuthenticated = true
    userState.isAdmin = true
  })

  it("renders the Graph Settings heading", async () => {
    await renderPage()
    expect(screen.getByText("Graph Settings")).toBeInTheDocument()
  })

  it("renders graph name input pre-filled", async () => {
    await renderPage()
    const input = screen.getByLabelText(/Graph Name/i) as HTMLInputElement
    expect(input).toBeInTheDocument()
    expect(input.value).toBe("Test Graph")
  })

  it("renders description textarea pre-filled", async () => {
    await renderPage()
    const textarea = screen.getByLabelText(/Description/i) as HTMLTextAreaElement
    expect(textarea).toBeInTheDocument()
    expect(textarea.value).toBe("A test description")
  })

  it("shows Save Changes and Cancel buttons for admins", async () => {
    await renderPage()
    expect(screen.getByRole("button", { name: /Save Changes/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeInTheDocument()
  })
})

// ── Admin-only tabs ───────────────────────────────────────────────────────────

describe("SettingsPage – admin-only tabs", () => {
  it("shows Schedule, Janitors, Domains tabs for admins", async () => {
    userState.isAuthenticated = true
    userState.isAdmin = true
    await renderPage()
    expect(screen.getByRole("tab", { name: /Schedule/i })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Janitors/i })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Domains/i })).toBeInTheDocument()
  })

  it("does not show admin-only tabs for non-admins (not yet authenticated)", async () => {
    // Not authenticated, not admin → page still renders (no redirect guard fires for unauthenticated)
    userState.isAuthenticated = false
    userState.isAdmin = false
    await renderPage()
    expect(screen.queryByRole("tab", { name: /Schedule/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: /Janitors/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: /Domains/i })).not.toBeInTheDocument()
  })
})

// ── Tab query-param logic ─────────────────────────────────────────────────────

describe("SettingsPage – tab query param", () => {
  beforeEach(() => {
    userState.isAuthenticated = true
    userState.isAdmin = true
  })

  it("defaults to general tab when no ?tab param", async () => {
    mockSearchParams = { get: () => null }
    await renderPage()
    const generalTab = screen.getByRole("tab", { name: /General/i })
    expect(generalTab).toHaveAttribute("aria-selected", "true")
  })

  it("activates janitor tab for ?tab=janitor", async () => {
    mockSearchParams = { get: (k: string) => (k === "tab" ? "janitor" : null) }
    await renderPage()
    const janitorTab = screen.getByRole("tab", { name: /Janitors/i })
    expect(janitorTab).toHaveAttribute("aria-selected", "true")
  })

  it("activates radar tab for ?tab=radar", async () => {
    mockSearchParams = { get: (k: string) => (k === "tab" ? "radar" : null) }
    await renderPage()
    const radarTab = screen.getByRole("tab", { name: /Schedule/i })
    expect(radarTab).toHaveAttribute("aria-selected", "true")
  })

  it("activates domains tab for ?tab=domains", async () => {
    mockSearchParams = { get: (k: string) => (k === "tab" ? "domains" : null) }
    await renderPage()
    const domainsTab = screen.getByRole("tab", { name: /Domains/i })
    expect(domainsTab).toHaveAttribute("aria-selected", "true")
  })

  it("falls back to general for unknown ?tab value", async () => {
    mockSearchParams = { get: (k: string) => (k === "tab" ? "unknown-tab-xyz" : null) }
    await renderPage()
    const generalTab = screen.getByRole("tab", { name: /General/i })
    expect(generalTab).toHaveAttribute("aria-selected", "true")
  })

  it("falls back to general for admin-only tab when not admin", async () => {
    // Non-admin with ?tab=janitor → should resolve to general
    userState.isAuthenticated = false
    userState.isAdmin = false
    mockSearchParams = { get: (k: string) => (k === "tab" ? "janitor" : null) }
    await renderPage()
    const generalTab = screen.getByRole("tab", { name: /General/i })
    expect(generalTab).toHaveAttribute("aria-selected", "true")
  })

  it("updates URL when switching tabs", async () => {
    mockSearchParams = { get: () => null }
    await renderPage()
    const radarTab = screen.getByRole("tab", { name: /Schedule/i })
    fireEvent.click(radarTab)
    expect(mockReplace).toHaveBeenCalledWith("/settings?tab=radar")
  })
})

// ── Save handler ──────────────────────────────────────────────────────────────

describe("SettingsPage – save handler", () => {
  beforeEach(() => {
    userState.isAuthenticated = true
    userState.isAdmin = true
  })

  it("calls api.post('/about') and setGraphMeta on save", async () => {
    await renderPage()

    const nameInput = screen.getByLabelText(/Graph Name/i)
    fireEvent.change(nameInput, { target: { value: "New Name" } })

    const saveBtn = screen.getByRole("button", { name: /Save Changes/i })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith("/about", {
        title: "New Name",
        description: "A test description",
      })
    })
    await waitFor(() => {
      expect(appState.setGraphMeta).toHaveBeenCalledWith("New Name", "A test description")
    })
  })

  it("Cancel button resets form to store values", async () => {
    await renderPage()

    const nameInput = screen.getByLabelText(/Graph Name/i) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: "Changed Name" } })
    expect(nameInput.value).toBe("Changed Name")

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }))
    expect(nameInput.value).toBe("Test Graph")
  })
})

// ── Back button ───────────────────────────────────────────────────────────────

describe("SettingsPage – back button", () => {
  it("back button navigates to /", async () => {
    userState.isAuthenticated = true
    userState.isAdmin = true
    await renderPage()
    const backBtn = screen.getByRole("button", { name: "" }) // ArrowLeft icon button
    fireEvent.click(backBtn)
    expect(mockPush).toHaveBeenCalledWith("/")
  })
})
