import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { getL402Mock, getSignedMessageMock } = vi.hoisted(() => ({
  getL402Mock: vi.fn(),
  getSignedMessageMock: vi.fn(),
}))

vi.mock("@/lib/sphinx/bridge", () => ({
  getL402: getL402Mock,
  getSignedMessage: getSignedMessageMock,
  hasWebLN: vi.fn(),
  payInvoice: vi.fn(),
  enable: vi.fn(),
}))

vi.mock("@/lib/sphinx/detect", () => ({
  isSphinx: vi.fn(() => false),
  isAndroid: vi.fn(() => false),
}))

import { Lsat } from "lsat-js"
import { fetchBuyLsatChallenge } from "@/lib/sphinx/payment"

// 402 response with a www-authenticate header. We mock Lsat.fromHeader in
// each test that exercises parsing, so the header value doesn't need to be
// a real LSAT challenge.
function build402Response(): Response {
  return new Response(null, {
    status: 402,
    headers: {
      "www-authenticate": 'LSAT macaroon="testmac", invoice="lnbctest"',
    },
  })
}

describe("fetchBuyLsatChallenge", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    getL402Mock.mockReset()
    getSignedMessageMock.mockReset()
    getSignedMessageMock.mockResolvedValue({ signature: "", message: "" })
    getL402Mock.mockResolvedValue("")
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("parses the LSAT challenge from a 402 response and returns invoice + macaroon", async () => {
    // Spy on Lsat.fromHeader so we don't need a perfectly-formed macaroon.
    const fromHeaderSpy = vi.spyOn(Lsat, "fromHeader").mockReturnValue({
      invoice: "lnbc100u1p0testinvoice",
      baseMacaroon: "test_base_macaroon",
      paymentHash: "a".repeat(64),
      id: "test_lsat_id",
    } as unknown as ReturnType<typeof Lsat.fromHeader>)

    global.fetch = vi.fn().mockResolvedValue(build402Response()) as unknown as typeof fetch

    const result = await fetchBuyLsatChallenge(1000)

    expect(result).toEqual({
      invoice: "lnbc100u1p0testinvoice",
      baseMacaroon: "test_base_macaroon",
      paymentHash: "a".repeat(64),
      id: "test_lsat_id",
    })
    expect(fromHeaderSpy).toHaveBeenCalledOnce()
    fromHeaderSpy.mockRestore()
  })

  it("throws when /buy_lsat returns 200 instead of 402 (regression: PR 405's broken contract)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, payment_request: "lnbc...", macaroon: "x" }),
    }) as unknown as typeof fetch

    await expect(fetchBuyLsatChallenge(1000)).rejects.toThrow(/Expected 402/)
  })

  it("throws when the 402 response has no www-authenticate header", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 402 }),
    ) as unknown as typeof fetch

    await expect(fetchBuyLsatChallenge(1000)).rejects.toThrow(/No www-authenticate header/)
  })

  it("propagates non-402 errors unchanged", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 500 }),
    ) as unknown as typeof fetch

    // The api layer throws the Response on non-ok statuses; fetchBuyLsatChallenge
    // should re-throw anything that isn't a 402.
    await expect(fetchBuyLsatChallenge(1000)).rejects.toBeInstanceOf(Response)
  })

  it("does not attach Authorization (auto-attach is skipped on /buy_lsat)", async () => {
    getL402Mock.mockResolvedValue("LSAT existing:preimage")
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 402, headers: { "www-authenticate": "LSAT macaroon=\"x\", invoice=\"y\"" } }),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    vi.spyOn(Lsat, "fromHeader").mockReturnValue({
      invoice: "y",
      baseMacaroon: "x",
      paymentHash: "h",
      id: "i",
    } as unknown as ReturnType<typeof Lsat.fromHeader>)

    await fetchBuyLsatChallenge(1000)

    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>)?.Authorization).toBeUndefined()
    expect(getL402Mock).not.toHaveBeenCalled()
  })
})
