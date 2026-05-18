import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---- SSR guard: getSocket throws when window is undefined ----
describe("getSocket – SSR guard", () => {
  let originalWindow: Window & typeof globalThis

  beforeEach(() => {
    vi.resetModules()
    originalWindow = global.window
    // @ts-expect-error: simulate SSR
    delete global.window
  })

  afterEach(() => {
    global.window = originalWindow
  })

  it("throws when window is undefined", async () => {
    const { getSocket } = await import("@/lib/socket")
    expect(() => getSocket()).toThrow("Socket not available in SSR")
  })
})
