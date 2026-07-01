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

import { triggerEnrich, getLatestStakworkRun } from "@/lib/graph-api"

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
// triggerEnrich
// ---------------------------------------------------------------------------
describe("triggerEnrich", () => {
  it("POSTs to /api/v2/nodes/:refId/enrich and returns stakwork_run_ref_id", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, stakwork_run_ref_id: "enrich-run-abc" }),
    }) as unknown as typeof fetch

    const result = await triggerEnrich("person-123")

    expect(result).toEqual({ success: true, stakwork_run_ref_id: "enrich-run-abc" })
    const [[url, options]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(url).toContain("/api/v2/nodes/person-123/enrich")
    expect((options as RequestInit).method).toBe("POST")
  })

  it("throws on non-2xx response (500)", async () => {
    const mockResponse = { ok: false, status: 500, json: async () => ({}) }
    global.fetch = vi.fn().mockResolvedValue(mockResponse) as unknown as typeof fetch

    const err = await triggerEnrich("person-500").catch((e) => e)
    expect(err).toBeDefined()
    expect(err.status).toBe(500)
  })

  it("throws 400 when node type is unsupported (backend rejects)", async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      json: async () => ({ message: "Unsupported node type" }),
    }
    global.fetch = vi.fn().mockResolvedValue(mockResponse) as unknown as typeof fetch

    const err = await triggerEnrich("episode-999").catch((e) => e)
    expect(err).toBeDefined()
    expect(err.status).toBe(400)
  })

  it("throws 409 when a run is already in-flight", async () => {
    const mockResponse = {
      ok: false,
      status: 409,
      json: async () => ({ message: "Run already in-flight" }),
    }
    global.fetch = vi.fn().mockResolvedValue(mockResponse) as unknown as typeof fetch

    const err = await triggerEnrich("person-inflight").catch((e) => e)
    expect(err).toBeDefined()
    expect(err.status).toBe(409)
  })
})

// ---------------------------------------------------------------------------
// getLatestStakworkRun with web_search_enrich job type
// ---------------------------------------------------------------------------
describe("getLatestStakworkRun (web_search_enrich)", () => {
  it("GETs /api/v2/stakwork-runs/latest with job_type=web_search_enrich", async () => {
    const mockRun = {
      ref_id: "enrich-run-1",
      job_type: "web_search_enrich",
      status: "RUNNING",
      created_at: 1700000000,
      project_id: 12345,
    }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRun,
    }) as unknown as typeof fetch

    const result = await getLatestStakworkRun("person-xyz", "web_search_enrich")

    expect(result).toEqual(mockRun)
    const [[url]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(url).toContain("/api/v2/stakwork-runs/latest")
    expect(url).toContain("ref_id=person-xyz")
    expect(url).toContain("job_type=web_search_enrich")
  })

  it("returns run with project_id field", async () => {
    const mockRun = {
      ref_id: "enrich-run-2",
      job_type: "web_search_enrich",
      status: "COMPLETED",
      created_at: 1700001000,
      finished_at: 1700001500,
      project_id: 99999,
    }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRun,
    }) as unknown as typeof fetch

    const result = await getLatestStakworkRun("person-ok", "web_search_enrich")

    expect(result).not.toBeNull()
    expect(result?.status).toBe("COMPLETED")
    expect(result?.project_id).toBe(99999)
  })

  it("returns null when the server responds with 404", async () => {
    const mockResponse = { ok: false, status: 404, json: async () => ({}) }
    global.fetch = vi.fn().mockResolvedValue(mockResponse) as unknown as typeof fetch

    const result = await getLatestStakworkRun("person-404", "web_search_enrich")

    expect(result).toBeNull()
  })

  it("rethrows non-404 errors", async () => {
    const mockResponse = { ok: false, status: 500, json: async () => ({}) }
    global.fetch = vi.fn().mockResolvedValue(mockResponse) as unknown as typeof fetch

    const err = await getLatestStakworkRun("person-500", "web_search_enrich").catch((e) => e)
    expect(err).toBeDefined()
    expect(err.status).toBe(500)
  })
})
