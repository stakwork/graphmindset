import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock sphinx helpers so api.ts can be imported without side-effects
const { getL402Mock, getSignedMessageMock } = vi.hoisted(() => ({
  getL402Mock: vi.fn(),
  getSignedMessageMock: vi.fn(),
}))

vi.mock("@/lib/sphinx", () => ({
  getL402: getL402Mock,
  getSignedMessage: getSignedMessageMock,
}))

// Disable mocks mode so the real API paths are exercised
vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => false,
  MOCK_REVIEWS: [],
  MOCK_WORKFLOW_MARKETPLACE: [],
}))

import { triggerOntologyAgent } from "@/lib/graph-api"

const originalFetch = global.fetch

beforeEach(() => {
  getSignedMessageMock.mockResolvedValue({ signature: "", message: "" })
  getL402Mock.mockResolvedValue(null)
})

afterEach(() => {
  global.fetch = originalFetch
  vi.clearAllMocks()
})

describe("triggerOntologyAgent", () => {
  it("accepts an options object and POSTs to /v2/schema/ontology-agent", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stakwork_run_ref_id: "run-42" }),
    }) as unknown as typeof fetch

    const result = await triggerOntologyAgent({
      instruction: "Add a Podcast type",
      sessionId: "test-session-uuid",
    })

    expect(result).toEqual({ stakwork_run_ref_id: "run-42" })
    const [[url, options]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(url).toContain("/v2/schema/ontology-agent")
    expect((options as RequestInit).method).toBe("POST")
  })

  it("includes session_id in the POST body", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stakwork_run_ref_id: "run-session" }),
    }) as unknown as typeof fetch

    await triggerOntologyAgent({
      instruction: "Add a Podcast type",
      sessionId: "stable-session-abc",
    })

    const [[, options]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    const body = JSON.parse((options as RequestInit).body as string)
    expect(body.session_id).toBe("stable-session-abc")
    expect(body.instruction).toBe("Add a Podcast type")
  })

  it("includes history in the POST body when provided", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stakwork_run_ref_id: "run-hist" }),
    }) as unknown as typeof fetch

    const history = [{ role: "user" as const, content: "prior message" }]

    await triggerOntologyAgent({
      instruction: "Follow-up instruction",
      history,
      sessionId: "session-with-history",
    })

    const [[, options]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    const body = JSON.parse((options as RequestInit).body as string)
    expect(body.history).toEqual(history)
    expect(body.session_id).toBe("session-with-history")
  })

  it("defaults history to [] when not provided", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stakwork_run_ref_id: "run-nohistory" }),
    }) as unknown as typeof fetch

    await triggerOntologyAgent({
      instruction: "No history here",
      sessionId: "session-no-history",
    })

    const [[, options]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    const body = JSON.parse((options as RequestInit).body as string)
    expect(body.history).toEqual([])
  })

  it("throws on non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch

    const err = await triggerOntologyAgent({
      instruction: "Will fail",
      sessionId: "any-session",
    }).catch((e) => e)

    expect(err).toBeDefined()
    expect(err.status).toBe(500)
  })
})

describe("triggerOntologyAgent (mock mode)", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("returns a mock run ref without calling fetch when mocks are enabled", async () => {
    vi.doMock("@/lib/mock-data", () => ({
      isMocksEnabled: () => true,
      MOCK_REVIEWS: [],
      MOCK_WORKFLOW_MARKETPLACE: [],
    }))

    global.fetch = vi.fn() as unknown as typeof fetch

    // Dynamically import so the mock is picked up
    const { triggerOntologyAgent: triggerMock } = await import("@/lib/graph-api")

    const result = await triggerMock({
      instruction: "Some instruction",
      sessionId: "mock-session",
    })

    expect(result.stakwork_run_ref_id).toMatch(/^mock-ontology-run-/)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
