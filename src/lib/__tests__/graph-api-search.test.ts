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

vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => false,
  MOCK_REVIEWS: [],
  MOCK_WORKFLOW_MARKETPLACE: [],
}))

import { searchNodes } from "@/lib/graph-api"

const originalFetch = global.fetch

beforeEach(() => {
  getSignedMessageMock.mockResolvedValue({ signature: "", message: "" })
  getL402Mock.mockResolvedValue(null)
})

afterEach(() => {
  global.fetch = originalFetch
  vi.clearAllMocks()
})

describe("searchNodes — ui_skin param", () => {
  it("appends ui_skin=legal when opt is provided", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [], edges: [] }),
    }) as unknown as typeof fetch

    await searchNodes("foo", { ui_skin: "legal" })

    const [[url]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(url).toContain("ui_skin=legal")
  })

  it("omits ui_skin when opt is not provided", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [], edges: [] }),
    }) as unknown as typeof fetch

    await searchNodes("foo")

    const [[url]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(url).not.toContain("ui_skin")
  })

  it("omits ui_skin when opt is undefined", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [], edges: [] }),
    }) as unknown as typeof fetch

    await searchNodes("foo", { ui_skin: undefined })

    const [[url]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(url).not.toContain("ui_skin")
  })
})
