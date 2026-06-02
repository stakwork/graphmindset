/**
 * Tests for UniverseHeader:
 * - Clicking header calls closeAllPanels, clearSelection, setSearchTerm
 * - Clicking in default state is a no-op (no throws)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"

const closeAllPanels = vi.fn()
const setSearchTerm = vi.fn()
const clearSelection = vi.fn()

const appState = {
  graphName: "Test Graph",
  closeAllPanels,
  setSearchTerm,
}

vi.mock("@/stores/app-store", () => ({
  useAppStore: (sel?: (s: unknown) => unknown) =>
    sel ? sel(appState) : appState,
}))

const graphState = {
  clearSelection,
}

vi.mock("@/stores/graph-store", () => ({
  useGraphStore: (sel?: (s: unknown) => unknown) =>
    sel ? sel(graphState) : graphState,
}))

describe("UniverseHeader", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders Universe and graph name", async () => {
    const { UniverseHeader } = await import(
      "@/components/layout/universe-header"
    )
    render(<UniverseHeader />)
    expect(screen.getByText("Universe")).toBeInTheDocument()
    expect(screen.getByText("Test Graph")).toBeInTheDocument()
  })

  it("calls closeAllPanels, clearSelection, and setSearchTerm on click", async () => {
    const { UniverseHeader } = await import(
      "@/components/layout/universe-header"
    )
    render(<UniverseHeader />)
    fireEvent.click(screen.getByText("Universe").closest("header")!)
    expect(closeAllPanels).toHaveBeenCalledTimes(1)
    expect(clearSelection).toHaveBeenCalledTimes(1)
    expect(setSearchTerm).toHaveBeenCalledWith("")
  })

  it("does not throw when already in default state", async () => {
    const { UniverseHeader } = await import(
      "@/components/layout/universe-header"
    )
    render(<UniverseHeader />)
    expect(() =>
      fireEvent.click(screen.getByText("Universe").closest("header")!)
    ).not.toThrow()
  })
})
