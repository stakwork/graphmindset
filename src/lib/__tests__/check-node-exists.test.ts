import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { getL402Mock, getSignedMessageMock } = vi.hoisted(() => ({
  getL402Mock: vi.fn(),
  getSignedMessageMock: vi.fn(),
}))

vi.mock("@/lib/sphinx", () => ({
  getL402: getL402Mock,
  getSignedMessage: getSignedMessageMock,
}))

import { checkNodeExists } from "@/lib/graph-api"

const API_URL = "http://localhost:3000/api"

describe("checkNodeExists", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    getL402Mock.mockReset()
    getSignedMessageMock.mockReset()
    getSignedMessageMock.mockResolvedValue({ signature: "", message: "" })
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("routes through api.get — URL contains /api/v2/nodes/check with correct params", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ exists: true, ref_id: "abc", status: "completed" }),
    }) as unknown as typeof fetch

    const result = await checkNodeExists("Episode", "https://youtube.com/watch?v=xyz")

    expect(result).toEqual({ exists: true, ref_id: "abc", status: "completed" })

    const [[url]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(url).toContain("/api/v2/nodes/check")
    expect(url).toContain("node_type=Episode")
    expect(url).toContain("key=")
  })

  it("returns safe fallback on network error without rethrowing", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error")) as unknown as typeof fetch

    const result = await checkNodeExists("Episode", "https://youtube.com/watch?v=xyz")

    expect(result).toEqual({ exists: false, ref_id: null, status: null })
  })

  it("returns safe fallback on non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }) as unknown as typeof fetch

    const result = await checkNodeExists("Episode", "https://youtube.com/watch?v=xyz")

    expect(result).toEqual({ exists: false, ref_id: null, status: null })
  })
})
