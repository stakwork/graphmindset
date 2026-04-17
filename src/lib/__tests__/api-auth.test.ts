import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { getL402Mock, getSignedMessageMock } = vi.hoisted(() => ({
  getL402Mock: vi.fn(),
  getSignedMessageMock: vi.fn(),
}))

vi.mock("@/lib/sphinx", () => ({
  getL402: getL402Mock,
  getSignedMessage: getSignedMessageMock,
}))

import { api } from "@/lib/api"

describe("api auto-attach L402 behavior", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    getL402Mock.mockReset()
    getSignedMessageMock.mockReset()
    getSignedMessageMock.mockResolvedValue({ signature: "", message: "" })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("auto-attaches the L402 token when no Authorization header is passed", async () => {
    getL402Mock.mockResolvedValue("LSAT mac:preimage")

    await api.get("/v2/nodes/abc")

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect((init.headers as Record<string, string>)?.Authorization).toBe("LSAT mac:preimage")
  })

  it("does NOT auto-attach when caller explicitly passes Authorization: '' (probe opt-out)", async () => {
    getL402Mock.mockResolvedValue("LSAT mac:preimage")

    await api.get("/v2/nodes/abc", { Authorization: "" })

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBe("")
    expect(getL402Mock).not.toHaveBeenCalled()
  })

  it("respects a caller-provided Authorization header verbatim", async () => {
    getL402Mock.mockResolvedValue("LSAT auto:attach")

    await api.get("/v2/nodes/abc", { Authorization: "Bearer custom" })

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer custom")
    expect(getL402Mock).not.toHaveBeenCalled()
  })

  it("does not auto-attach on payment endpoints (/buy_lsat must 402 with its own invoice)", async () => {
    getL402Mock.mockResolvedValue("LSAT mac:preimage")

    await api.post("/buy_lsat", { amount: 100 })

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
    expect(getL402Mock).not.toHaveBeenCalled()
  })
})
