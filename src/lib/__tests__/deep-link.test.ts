import { describe, it, expect, beforeEach } from "vitest"
import { buildSphinxDeepLink } from "@/lib/sphinx/deep-link"

describe("buildSphinxDeepLink", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { origin: "https://example.com" },
      writable: true,
      configurable: true,
    })
  })

  it("builds a sphinx.chat deep link with the encoded web URL", () => {
    const result = buildSphinxDeepLink("abc-123")
    const expectedWebUrl = "https://example.com/?id=abc-123"
    expect(result).toBe(
      `sphinx.chat://?action=webapp&url=${encodeURIComponent(expectedWebUrl)}`
    )
  })

  it("encodes special characters in the ref_id", () => {
    const result = buildSphinxDeepLink("ref/with spaces&chars")
    const expectedWebUrl = "https://example.com/?id=ref/with spaces&chars"
    expect(result).toBe(
      `sphinx.chat://?action=webapp&url=${encodeURIComponent(expectedWebUrl)}`
    )
  })
})
