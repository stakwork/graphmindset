import { describe, it, expect, beforeEach } from "vitest"
import { cookieStorage, AUTH_COOKIE_DAYS } from "@/lib/cookie-storage"

describe("cookieStorage", () => {
  beforeEach(() => {
    // Clear all cookies between tests
    document.cookie.split(";").forEach((c) => {
      const key = c.trim().split("=")[0]
      document.cookie = `${key}=; Max-Age=0; Path=/`
    })
  })

  it("exports AUTH_COOKIE_DAYS as 30", () => {
    expect(AUTH_COOKIE_DAYS).toBe(30)
  })

  describe("setItem without days (session cookie)", () => {
    it("stores the value and does not include Max-Age", () => {
      cookieStorage.setItem("test_key", "test_value")
      expect(cookieStorage.getItem("test_key")).toBe("test_value")
      // document.cookie strips attributes — only the key=value pair is readable
      // Verify Max-Age is NOT in the raw string when we can inspect it
      // (jsdom exposes the full string via document.cookie which only shows key=value)
      expect(document.cookie).toContain("test_key=")
    })
  })

  describe("setItem with days (persistent cookie)", () => {
    it("stores the value and includes Max-Age when days is supplied", () => {
      // Intercept document.cookie setter to capture the full string
      let capturedCookieString = ""
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!
      const originalSet = descriptor.set!

      Object.defineProperty(document, "cookie", {
        set(value: string) {
          capturedCookieString = value
          originalSet.call(document, value)
        },
        get: descriptor.get,
        configurable: true,
      })

      cookieStorage.setItem("persistent_key", "persistent_value", AUTH_COOKIE_DAYS)

      // Restore original descriptor
      Object.defineProperty(document, "cookie", descriptor)

      expect(capturedCookieString).toContain("Max-Age=")
      expect(capturedCookieString).toContain(`${AUTH_COOKIE_DAYS * 24 * 60 * 60}`)
      expect(cookieStorage.getItem("persistent_key")).toBe("persistent_value")
    })
  })

  describe("setItem without days (session cookie — no Max-Age)", () => {
    it("does NOT include Max-Age in the cookie string", () => {
      let capturedCookieString = ""
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!
      const originalSet = descriptor.set!

      Object.defineProperty(document, "cookie", {
        set(value: string) {
          capturedCookieString = value
          originalSet.call(document, value)
        },
        get: descriptor.get,
        configurable: true,
      })

      cookieStorage.setItem("session_key", "session_value")

      Object.defineProperty(document, "cookie", descriptor)

      expect(capturedCookieString).not.toContain("Max-Age=")
      expect(cookieStorage.getItem("session_key")).toBe("session_value")
    })
  })

  it("getItem returns null for missing keys", () => {
    expect(cookieStorage.getItem("nonexistent")).toBeNull()
  })

  it("removeItem deletes a stored cookie", () => {
    cookieStorage.setItem("to_remove", "bye")
    expect(cookieStorage.getItem("to_remove")).toBe("bye")
    cookieStorage.removeItem("to_remove")
    expect(cookieStorage.getItem("to_remove")).toBeNull()
  })

  it("handles special characters in values", () => {
    const value = JSON.stringify({ macaroon: "abc123", preimage: "xyz==", identifier: "id/1" })
    cookieStorage.setItem("l402", value)
    expect(cookieStorage.getItem("l402")).toBe(value)
  })
})
