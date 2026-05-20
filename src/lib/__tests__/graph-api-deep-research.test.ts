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

import { triggerDeepResearch, getLatestStakworkRun } from "@/lib/graph-api"

const originalFetch = global.fetch

beforeEach(() => {
  getSignedMessageMock.mockResolvedValue({ signature: "", message: "" })
  getL402Mock.mockResolvedValue(null)
})

afterEach(() => {
  global.fetch = originalFetch
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// triggerDeepResearch
// ---------------------------------------------------------------------------
describe("triggerDeepResearch", () => {
  it("POSTs to /api/v2/nodes/:refId/deep-research and returns stakwork_run_ref_id", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, stakwork_run_ref_id: "run-abc" }),
    }) as unknown as typeof fetch

    const result = await triggerDeepResearch("topic-123")

    expect(result).toEqual({ success: true, stakwork_run_ref_id: "run-abc" })
    const [[url, options]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(url).toContain("/api/v2/nodes/topic-123/deep-research")
    expect((options as RequestInit).method).toBe("POST")
  })

  it("throws on 402 (L402 challenge) — caller handles payment retry", async () => {
    const mockResponse = { ok: false, status: 402, json: async () => ({ price: 50 }) }
    global.fetch = vi.fn().mockResolvedValue(mockResponse) as unknown as typeof fetch

    const err = await triggerDeepResearch("topic-402").catch((e) => e)
    expect(err).toBeDefined()
    expect(err.status).toBe(402)
  })

  it("throws on non-2xx response (500)", async () => {
    const mockResponse = { ok: false, status: 500, json: async () => ({}) }
    global.fetch = vi.fn().mockResolvedValue(mockResponse) as unknown as typeof fetch

    const err = await triggerDeepResearch("topic-500").catch((e) => e)
    expect(err).toBeDefined()
    expect(err.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// getLatestStakworkRun
// ---------------------------------------------------------------------------
describe("getLatestStakworkRun", () => {
  it("GETs /api/v2/stakwork-runs/latest with correct query params", async () => {
    const mockRun = {
      ref_id: "dr-run-1",
      job_type: "deep_research",
      status: "RUNNING",
      created_at: 1700000000,
    }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRun,
    }) as unknown as typeof fetch

    const result = await getLatestStakworkRun("topic-xyz", "deep_research")

    expect(result).toEqual(mockRun)
    const [[url]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(url).toContain("/api/v2/stakwork-runs/latest")
    expect(url).toContain("ref_id=topic-xyz")
    expect(url).toContain("job_type=deep_research")
  })

  it("returns null when the server responds with 404", async () => {
    // api.ts throws the response object on non-ok; getLatestStakworkRun catches 404 → null
    const mockResponse = { ok: false, status: 404, json: async () => ({}) }
    global.fetch = vi.fn().mockResolvedValue(mockResponse) as unknown as typeof fetch

    const result = await getLatestStakworkRun("topic-404", "deep_research")

    expect(result).toBeNull()
  })

  it("returns typed StakworkRun on 200", async () => {
    const mockRun = {
      ref_id: "dr-run-2",
      job_type: "deep_research",
      status: "COMPLETED",
      created_at: 1700001000,
      finished_at: 1700001500,
    }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRun,
    }) as unknown as typeof fetch

    const result = await getLatestStakworkRun("topic-ok", "deep_research")

    expect(result).not.toBeNull()
    expect(result?.status).toBe("COMPLETED")
    expect(result?.ref_id).toBe("dr-run-2")
    expect(result?.finished_at).toBe(1700001500)
  })

  it("rethrows non-404 errors", async () => {
    const mockResponse = { ok: false, status: 500, json: async () => ({}) }
    global.fetch = vi.fn().mockResolvedValue(mockResponse) as unknown as typeof fetch

    const err = await getLatestStakworkRun("topic-500", "deep_research").catch((e) => e)
    expect(err).toBeDefined()
    expect(err.status).toBe(500)
  })
})
