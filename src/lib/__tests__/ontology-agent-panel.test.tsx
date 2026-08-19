import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockTriggerOntologyAgent, mockGetStakworkRun, mockListReviews } =
  vi.hoisted(() => ({
    mockTriggerOntologyAgent: vi.fn(),
    mockGetStakworkRun: vi.fn(),
    mockListReviews: vi.fn(),
  }))

vi.mock("@/lib/graph-api", () => ({
  triggerOntologyAgent: (...args: unknown[]) => mockTriggerOntologyAgent(...args),
  getStakworkRun: (...args: unknown[]) => mockGetStakworkRun(...args),
  listReviews: (...args: unknown[]) => mockListReviews(...args),
}))

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: (
    sel: (s: { schemas: never[]; fetchAll: () => void }) => unknown
  ) => sel({ schemas: [], fetchAll: vi.fn() }),
}))

vi.mock("@/components/admin/review-row", () => ({
  ReviewRow: () => <div data-testid="review-row" />,
}))

// ── DOM stubs ─────────────────────────────────────────────────────────────────
// jsdom doesn't implement scrollTo; stub so the transcript scroll useEffect
// doesn't throw.
Element.prototype.scrollTo = () => {}

// crypto.randomUUID: counter-based stub — unique per call, no Web Crypto needed.
let _uuidCounter = 0
Object.defineProperty(globalThis.crypto, "randomUUID", {
  configurable: true,
  value: () => `test-uuid-${++_uuidCounter}`,
})

// ── Imports after mocks ───────────────────────────────────────────────────────
import { OntologyAgentPanel } from "@/app/admin/ontology/ontology-agent-panel"

// ── Shared setup / teardown ───────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockTriggerOntologyAgent.mockResolvedValue({ stakwork_run_ref_id: "run-001" })
  // Default: stays RUNNING so panel keeps busy unless overridden per-test.
  mockGetStakworkRun.mockResolvedValue({ ref_id: "run-001", status: "RUNNING" })
  mockListReviews.mockResolvedValue({ reviews: [] })
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPanel(onClose = vi.fn()) {
  return render(<OntologyAgentPanel onClose={onClose} />)
}

async function typeAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  text: string
) {
  const textarea = screen.getByPlaceholderText(/describe an ontology change/i)
  await user.type(textarea, text)
  await user.keyboard("{Enter}")
}

// ── session_id is forwarded on first submit ───────────────────────────────────

describe("OntologyAgentPanel – session_id forwarded to triggerOntologyAgent", () => {
  it("passes a non-empty sessionId on the first submit", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

    renderPanel()
    await typeAndSubmit(user, "Add a Podcast type")
    await waitFor(() => expect(mockTriggerOntologyAgent).toHaveBeenCalledOnce())

    const { sessionId } = mockTriggerOntologyAgent.mock.calls[0][0]
    expect(typeof sessionId).toBe("string")
    expect(sessionId.length).toBeGreaterThan(0)
  })

  it("passes the instruction text alongside sessionId", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

    renderPanel()
    await typeAndSubmit(user, "Add a new edge type")
    await waitFor(() => expect(mockTriggerOntologyAgent).toHaveBeenCalledOnce())

    const args = mockTriggerOntologyAgent.mock.calls[0][0]
    expect(args.instruction).toBe("Add a new edge type")
    expect(args).toHaveProperty("sessionId")
  })
})

// ── session_id is stable within one mounted instance ─────────────────────────
//
// Strategy: drive the poll cycle to COMPLETED so `busy` clears, then submit
// a second message and assert both calls used the same sessionId.
//
// The poll uses `setInterval(async () => {...}, 5000)`. Advancing fake time by
// 5 s once fires the interval callback, but the `await getStakworkRun()` inside
// it is async, so React state updates (setBusy(false)) happen asynchronously.
// We call advanceTimersByTimeAsync twice (same pattern as the deep-research
// polling tests in node-preview-panel.test.tsx) to flush both the interval
// timer and the promise chain inside it.

describe("OntologyAgentPanel – sessionId stability across submits", () => {
  it("reuses the same sessionId for consecutive submits within one instance", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

      mockTriggerOntologyAgent
        .mockResolvedValueOnce({ stakwork_run_ref_id: "run-A" })
        .mockResolvedValueOnce({ stakwork_run_ref_id: "run-B" })

      // Poll tick 1 → RUNNING, tick 2 → COMPLETED (clears busy)
      mockGetStakworkRun
        .mockResolvedValueOnce({ ref_id: "run-A", status: "RUNNING" })
        .mockResolvedValueOnce({ ref_id: "run-A", status: "COMPLETED" })
      mockListReviews.mockResolvedValue({ reviews: [] })

      renderPanel()

      // ── Submit #1 ──────────────────────────────────────────────────────────
      await typeAndSubmit(user, "First instruction")
      await waitFor(() => expect(mockTriggerOntologyAgent).toHaveBeenCalledOnce())
      const firstSessionId: string = mockTriggerOntologyAgent.mock.calls[0][0].sessionId

      // Type the second message while the panel is still busy — the Composer's
      // text state accepts typing regardless of the busy flag.
      const textarea = screen.getByPlaceholderText(/describe an ontology change/i)
      await user.type(textarea, "Second instruction")

      // Now drive the poll to completion: two 5-second ticks flush both the
      // setInterval callback and the async getStakworkRun chain inside it.
      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(5000)

      // busy is now false; the send button should be enabled (text is also non-empty)
      await waitFor(() =>
        expect(screen.getByTitle("Send")).not.toBeDisabled()
      )

      // ── Submit #2 — press Enter to send the pre-typed text ────────────────
      await user.keyboard("{Enter}")
      await waitFor(() => expect(mockTriggerOntologyAgent).toHaveBeenCalledTimes(2))
      const secondSessionId: string = mockTriggerOntologyAgent.mock.calls[1][0].sessionId

      // Same mounted instance → session_id must be identical.
      expect(secondSessionId).toBe(firstSessionId)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ── session_id resets on unmount/remount ──────────────────────────────────────

describe("OntologyAgentPanel – sessionId resets on remount", () => {
  it("generates a different sessionId for each new mounted instance", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      // ── First mount ──────────────────────────────────────────────────────────
      const user1 = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })
      const { unmount } = renderPanel()
      await typeAndSubmit(user1, "First session")
      await waitFor(() => expect(mockTriggerOntologyAgent).toHaveBeenCalledOnce())
      const firstSessionId: string = mockTriggerOntologyAgent.mock.calls[0][0].sessionId

      // Unmount simulates the user closing the panel.
      unmount()
      vi.clearAllMocks()
      mockTriggerOntologyAgent.mockResolvedValue({ stakwork_run_ref_id: "run-003" })
      mockGetStakworkRun.mockResolvedValue({ ref_id: "run-003", status: "RUNNING" })

      // ── Second mount ─────────────────────────────────────────────────────────
      const user2 = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })
      renderPanel()
      await typeAndSubmit(user2, "Second session")
      await waitFor(() => expect(mockTriggerOntologyAgent).toHaveBeenCalledOnce())
      const secondSessionId: string = mockTriggerOntologyAgent.mock.calls[0][0].sessionId

      // A fresh mount must produce a different session id.
      expect(secondSessionId).not.toBe(firstSessionId)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ── onClose forwarding ────────────────────────────────────────────────────────

describe("OntologyAgentPanel – onClose", () => {
  it("calls onClose when the X button is clicked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const onClose = vi.fn()
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })
      renderPanel(onClose)

      await user.click(screen.getByTitle("Close"))
      expect(onClose).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
