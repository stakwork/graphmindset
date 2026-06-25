/**
 * Tests for src/app/admin/(console)/general/page.tsx — the graph name/description
 * form lifted out of the old settings page.
 *
 * Covers:
 * - Inputs pre-filled from the app store
 * - Save calls api.post("/about") and setGraphMeta
 * - Cancel resets the form to store values
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

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

vi.mock("@/lib/input-limits", () => ({
  MAX_LENGTHS: { GRAPH_NAME: 100, GRAPH_DESCRIPTION: 500 },
}))

async function renderPage() {
  const { default: GeneralSettingsPage } = await import(
    "@/app/admin/(console)/general/page"
  )
  return render(<GeneralSettingsPage />)
}

beforeEach(() => {
  vi.clearAllMocks()
  appState.graphName = "Test Graph"
  appState.graphDescription = "A test description"
})

describe("GeneralSettingsPage", () => {
  it("renders name and description pre-filled from the store", async () => {
    await renderPage()
    const name = screen.getByLabelText(/Graph Name/i) as HTMLInputElement
    const desc = screen.getByLabelText(/Description/i) as HTMLTextAreaElement
    expect(name.value).toBe("Test Graph")
    expect(desc.value).toBe("A test description")
  })

  it("calls api.post('/about') and setGraphMeta on save", async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText(/Graph Name/i), {
      target: { value: "New Name" },
    })
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }))

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith("/about", {
        title: "New Name",
        description: "A test description",
      })
    )
    await waitFor(() =>
      expect(appState.setGraphMeta).toHaveBeenCalledWith(
        "New Name",
        "A test description"
      )
    )
  })

  it("Cancel resets the form to store values", async () => {
    await renderPage()
    const name = screen.getByLabelText(/Graph Name/i) as HTMLInputElement
    fireEvent.change(name, { target: { value: "Changed" } })
    expect(name.value).toBe("Changed")
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }))
    expect(name.value).toBe("Test Graph")
  })
})
