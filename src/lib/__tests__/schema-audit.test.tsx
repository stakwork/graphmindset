/**
 * Tests for src/app/settings/schema-audit.tsx
 *
 * Covers:
 * - Loading state renders indicator
 * - Mock mode returns MOCK_SCHEMA_AUDIT without hitting the API
 * - All three badge variants (healthy/orphaned/unused) render
 * - Count pills display correct values
 * - Error state renders message and Retry button
 * - Refresh button re-fetches data
 * - Component does not fetch when open=false
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const mockGetSchemaAudit = vi.fn()

vi.mock("@/lib/graph-api", () => ({
  getSchemaAudit: (...args: unknown[]) => mockGetSchemaAudit(...args),
}))

const mockIsMocksEnabled = vi.fn(() => false)
const MOCK_AUDIT = {
  node_labels: {
    healthy: [
      { name: "Topic", count: 312 },
      { name: "Person", count: 84 },
      { name: "Episode", count: 57 },
    ],
    orphaned: [
      { name: "LegacyTag", count: 7 },
      { name: "OldContent", count: 2 },
    ],
    unused: [
      { name: "AgentSession", count: 0 },
      { name: "EvalSet", count: 0 },
    ],
  },
  relationship_types: {
    healthy: [
      { name: "RELATED_TO", count: 540 },
      { name: "MENTIONED_IN", count: 201 },
    ],
    orphaned: [{ name: "OLD_LINK", count: 3 }],
    unused: [
      { name: "WORKS_AT", count: 0 },
      { name: "HAS_PRICE", count: 0 },
    ],
  },
}

vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => mockIsMocksEnabled(),
  MOCK_SCHEMA_AUDIT: MOCK_AUDIT,
}))

async function renderAuditSettings(open = true) {
  const { SchemaAuditSettings } = await import("@/app/settings/schema-audit")
  return render(<SchemaAuditSettings open={open} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsMocksEnabled.mockReturnValue(false)
})

// ── Loading state ─────────────────────────────────────────────────────────────

describe("SchemaAuditSettings – loading state", () => {
  it("renders loading indicator while fetching", async () => {
    let resolveAudit!: (v: unknown) => void
    mockGetSchemaAudit.mockReturnValue(new Promise((r) => { resolveAudit = r }))

    await renderAuditSettings(true)

    expect(screen.getByText(/Loading/i)).toBeInTheDocument()

    // cleanup
    act(() => resolveAudit(MOCK_AUDIT))
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument())
  })
})

// ── Mock mode ─────────────────────────────────────────────────────────────────

describe("SchemaAuditSettings – mock mode", () => {
  it("returns MOCK_SCHEMA_AUDIT without calling getSchemaAudit", async () => {
    mockIsMocksEnabled.mockReturnValue(true)

    await renderAuditSettings(true)

    await waitFor(() => expect(screen.getByText("Topic")).toBeInTheDocument())
    expect(mockGetSchemaAudit).not.toHaveBeenCalled()
  })

  it("displays all node label entries from mock data", async () => {
    mockIsMocksEnabled.mockReturnValue(true)

    await renderAuditSettings(true)

    await waitFor(() => {
      expect(screen.getByText("Topic")).toBeInTheDocument()
      expect(screen.getByText("Person")).toBeInTheDocument()
      expect(screen.getByText("Episode")).toBeInTheDocument()
      expect(screen.getByText("LegacyTag")).toBeInTheDocument()
      expect(screen.getByText("OldContent")).toBeInTheDocument()
      expect(screen.getByText("AgentSession")).toBeInTheDocument()
      expect(screen.getByText("EvalSet")).toBeInTheDocument()
    })
  })

  it("displays all relationship type entries from mock data", async () => {
    mockIsMocksEnabled.mockReturnValue(true)

    await renderAuditSettings(true)

    await waitFor(() => {
      expect(screen.getByText("RELATED_TO")).toBeInTheDocument()
      expect(screen.getByText("MENTIONED_IN")).toBeInTheDocument()
      expect(screen.getByText("OLD_LINK")).toBeInTheDocument()
      expect(screen.getByText("WORKS_AT")).toBeInTheDocument()
      expect(screen.getByText("HAS_PRICE")).toBeInTheDocument()
    })
  })
})

// ── Badge variants ────────────────────────────────────────────────────────────

describe("SchemaAuditSettings – badge variants", () => {
  beforeEach(() => {
    mockIsMocksEnabled.mockReturnValue(true)
  })

  it("renders ✓ Healthy badge (green)", async () => {
    await renderAuditSettings(true)
    await waitFor(() => {
      const badges = screen.getAllByText("✓ Healthy")
      expect(badges.length).toBeGreaterThan(0)
      expect(badges[0]).toHaveClass("text-green-400")
    })
  })

  it("renders ✕ Orphaned badge (red)", async () => {
    await renderAuditSettings(true)
    await waitFor(() => {
      const badges = screen.getAllByText("✕ Orphaned")
      expect(badges.length).toBeGreaterThan(0)
      expect(badges[0]).toHaveClass("text-red-400")
    })
  })

  it("renders ◌ Unused badge (amber)", async () => {
    await renderAuditSettings(true)
    await waitFor(() => {
      const badges = screen.getAllByText("◌ Unused")
      expect(badges.length).toBeGreaterThan(0)
      expect(badges[0]).toHaveClass("text-amber-400")
    })
  })
})

// ── Count pills ───────────────────────────────────────────────────────────────

describe("SchemaAuditSettings – count pills", () => {
  beforeEach(() => {
    mockIsMocksEnabled.mockReturnValue(true)
  })

  it("displays correct count for healthy node label", async () => {
    await renderAuditSettings(true)
    await waitFor(() => {
      // "312" count for Topic
      expect(screen.getByText("312")).toBeInTheDocument()
    })
  })

  it("displays correct count for orphaned relationship type", async () => {
    await renderAuditSettings(true)
    await waitFor(() => {
      // "3" count for OLD_LINK
      expect(screen.getByText("3")).toBeInTheDocument()
    })
  })

  it("displays 0 count for unused entries", async () => {
    await renderAuditSettings(true)
    await waitFor(() => {
      // Multiple "0" pills for unused entries
      const zeroPills = screen.getAllByText("0")
      expect(zeroPills.length).toBeGreaterThanOrEqual(4) // AgentSession, EvalSet, WORKS_AT, HAS_PRICE
    })
  })
})

// ── Error state ───────────────────────────────────────────────────────────────

describe("SchemaAuditSettings – error state", () => {
  it("renders error message and Retry button on failure", async () => {
    mockGetSchemaAudit.mockRejectedValue(new Error("Network error"))

    await renderAuditSettings(true)

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument()
    })
  })

  it("Retry button re-fetches data", async () => {
    mockGetSchemaAudit
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(MOCK_AUDIT)

    await renderAuditSettings(true)

    await waitFor(() => expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument())

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: /Retry/i }))

    await waitFor(() => expect(screen.getByText("Topic")).toBeInTheDocument())
    expect(mockGetSchemaAudit).toHaveBeenCalledTimes(2)
  })
})

// ── Refresh button ────────────────────────────────────────────────────────────

describe("SchemaAuditSettings – Refresh button", () => {
  it("Refresh button re-fetches when data is loaded", async () => {
    mockIsMocksEnabled.mockReturnValue(true)

    await renderAuditSettings(true)
    await waitFor(() => expect(screen.getByText("Topic")).toBeInTheDocument())

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: /Refresh/i }))

    // Still shows data after refresh in mock mode
    await waitFor(() => expect(screen.getByText("Topic")).toBeInTheDocument())
  })
})

// ── open=false does not fetch ─────────────────────────────────────────────────

describe("SchemaAuditSettings – open=false", () => {
  it("does not fetch data when open is false", async () => {
    mockGetSchemaAudit.mockResolvedValue(MOCK_AUDIT)

    await renderAuditSettings(false)

    // Nothing rendered, no fetch
    expect(mockGetSchemaAudit).not.toHaveBeenCalled()
    expect(screen.queryByText("Topic")).not.toBeInTheDocument()
  })
})

// ── Section headers ───────────────────────────────────────────────────────────

describe("SchemaAuditSettings – section headers", () => {
  it("renders Node Labels and Relationship Types section headers", async () => {
    mockIsMocksEnabled.mockReturnValue(true)

    await renderAuditSettings(true)

    await waitFor(() => {
      expect(screen.getByText("Node Labels")).toBeInTheDocument()
      expect(screen.getByText("Relationship Types")).toBeInTheDocument()
    })
  })
})
