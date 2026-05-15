/**
 * Tests that GraphFloater initialises in `collapsed` mode on mobile viewports
 * and `mini` mode on desktop viewports, using the lazy useState initialiser.
 */
import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import React from "react"

// Top-level mocks (hoisted by vitest)
vi.mock("@/stores/graph-store", () => ({
  useGraphStore: (sel?: (s: unknown) => unknown) => {
    const state = {
      nodes: [],
      edges: [],
      setSelectedNode: vi.fn(),
      setSidebarSelectedNode: vi.fn(),
    }
    return sel ? sel(state) : state
  },
}))

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (sel?: (s: unknown) => unknown) => {
    const state = { schemas: [] }
    return sel ? sel(state) : state
  },
}))

vi.mock("@/components/universe/graph-canvas", () => ({
  GraphCanvas: () => <canvas data-testid="graph-canvas" />,
}))

function setInnerWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  })
}

describe("GraphFloater — mobile (375px) starts in collapsed mode", () => {
  it("renders the circular collapsed icon (role=button), not the mini panel", async () => {
    setInnerWidth(375)

    const { GraphFloater } = await import("@/components/universe/graph-floater")
    const { container } = render(<GraphFloater />)

    // Collapsed mode renders a div with role="button" and a rounded-full class
    const collapsedIcon = container.querySelector("[role='button']")
    expect(collapsedIcon).not.toBeNull()
    expect(collapsedIcon?.className).toContain("rounded-full")

    // The mini panel has class rounded-lg — it must NOT be present in collapsed mode
    const miniPanel = container.querySelector(".rounded-lg")
    expect(miniPanel).toBeNull()
  })
})

describe("GraphFloater — desktop (1024px) starts in mini mode", () => {
  it("renders the mini panel container (rounded-lg), not the collapsed icon", async () => {
    setInnerWidth(1024)
    vi.resetModules()

    vi.mock("@/stores/graph-store", () => ({
      useGraphStore: (sel?: (s: unknown) => unknown) => {
        const state = {
          nodes: [],
          edges: [],
          setSelectedNode: vi.fn(),
          setSidebarSelectedNode: vi.fn(),
        }
        return sel ? sel(state) : state
      },
    }))
    vi.mock("@/stores/schema-store", () => ({
      useSchemaStore: (sel?: (s: unknown) => unknown) => {
        const state = { schemas: [] }
        return sel ? sel(state) : state
      },
    }))
    vi.mock("@/components/universe/graph-canvas", () => ({
      GraphCanvas: () => <canvas data-testid="graph-canvas" />,
    }))

    const { GraphFloater } = await import("@/components/universe/graph-floater")
    const { container } = render(<GraphFloater />)

    // Mini mode renders the floating panel (rounded-lg), not the collapsed icon
    const miniPanel = container.querySelector(".rounded-lg")
    expect(miniPanel).not.toBeNull()

    // Collapsed icon uses role="button" — must NOT be present in mini mode
    const collapsedIcon = container.querySelector("[role='button']")
    expect(collapsedIcon).toBeNull()
  })
})

describe("GraphFloater — lazy initialiser source check", () => {
  it("source contains the lazy window.innerWidth < 768 guard", async () => {
    const fs = await import("fs")
    const src = fs.readFileSync("src/components/universe/graph-floater.tsx", "utf-8")
    expect(src).toContain("window.innerWidth < 768")
    expect(src).toContain('"collapsed"')
    expect(src).toMatch(/useState<Mode>\(\s*\(\)\s*=>/)
  })
})
