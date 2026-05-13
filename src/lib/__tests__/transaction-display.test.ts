import { describe, it, expect } from "vitest"
import { isViewGrantRow } from "../transaction-display"

describe("isViewGrantRow", () => {
  it("returns true for a zero-amount purchase (view-grant row)", () => {
    expect(isViewGrantRow({ action: "purchase", type: "debit", amount: 0 })).toBe(true)
  })

  it("returns false for a non-zero purchase", () => {
    expect(isViewGrantRow({ action: "purchase", type: "debit", amount: 10 })).toBe(false)
  })

  it("returns false for a zero-amount top_up", () => {
    expect(isViewGrantRow({ action: "top_up", type: "credit", amount: 0 })).toBe(false)
  })

  it("returns false for a zero-amount payout", () => {
    expect(isViewGrantRow({ action: "payout", type: "credit", amount: 0 })).toBe(false)
  })

  it("returns false for a zero-amount boost", () => {
    expect(isViewGrantRow({ action: "boost", type: "debit", amount: 0 })).toBe(false)
  })

  it("handles string amounts — returns true for '0' purchase", () => {
    expect(isViewGrantRow({ action: "purchase", type: "debit", amount: "0" as unknown as number })).toBe(true)
  })

  it("handles string amounts — returns false for '10' purchase", () => {
    expect(isViewGrantRow({ action: "purchase", type: "debit", amount: "10" as unknown as number })).toBe(false)
  })
})
