import { describe, it, expect, vi, beforeEach } from "vitest"

const { apiGetMock } = vi.hoisted(() => ({ apiGetMock: vi.fn() }))
vi.mock("@/lib/api", () => ({
  api: { get: apiGetMock },
}))

import { getPrice } from "@/lib/sphinx/payment"

describe("getPrice", () => {
  beforeEach(() => {
    apiGetMock.mockReset()
  })

  it("defaults to method=post when no method is passed (backward-compatible)", async () => {
    apiGetMock.mockResolvedValue({ data: { price: 10, endpoint: "v2/content", method: "post" } })

    const price = await getPrice("v2/content")

    expect(price).toBe(10)
    const [url] = apiGetMock.mock.calls[0]
    expect(url).toBe("/getprice?endpoint=v2%2Fcontent&method=post")
  })

  it("uses method=get when explicitly requested (for v2/nodes/:id unlock route)", async () => {
    apiGetMock.mockResolvedValue({ data: { price: 20, endpoint: "v2/nodes/abc", method: "get" } })

    const price = await getPrice("v2/nodes/abc", "get")

    expect(price).toBe(20)
    const [url] = apiGetMock.mock.calls[0]
    expect(url).toBe("/getprice?endpoint=v2%2Fnodes%2Fabc&method=get")
  })

  it("forwards the AbortSignal to api.get", async () => {
    apiGetMock.mockResolvedValue({ data: { price: 10, endpoint: "v2/content", method: "post" } })
    const controller = new AbortController()

    await getPrice("v2/content", "get", controller.signal)

    const [, , signal] = apiGetMock.mock.calls[0]
    expect(signal).toBe(controller.signal)
  })

  it("returns 0 when the api call fails (fallback)", async () => {
    apiGetMock.mockRejectedValue(new Error("network"))

    const price = await getPrice("v2/nodes/abc", "get")

    expect(price).toBe(0)
  })

  it("returns the server-reported price verbatim", async () => {
    apiGetMock.mockResolvedValue({ data: { price: 42, endpoint: "anything", method: "get" } })
    expect(await getPrice("anything", "get")).toBe(42)
  })
})
