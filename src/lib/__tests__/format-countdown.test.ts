import { describe, it, expect } from "vitest"
import { formatCountdown } from "@/lib/format-countdown"

describe("formatCountdown", () => {
  it('returns "00:00" for 0 seconds', () => {
    expect(formatCountdown(0)).toBe("00:00")
  })

  it('returns "01:30" for 90 seconds', () => {
    expect(formatCountdown(90)).toBe("01:30")
  })

  it('returns "59:59" for 3599 seconds', () => {
    expect(formatCountdown(3599)).toBe("59:59")
  })

  it('returns "01:00" for 60 seconds', () => {
    expect(formatCountdown(60)).toBe("01:00")
  })

  it('returns "00:01" for 1 second', () => {
    expect(formatCountdown(1)).toBe("00:01")
  })

  it("clamps negative values to 00:00", () => {
    expect(formatCountdown(-5)).toBe("00:00")
  })

  it("floors fractional seconds", () => {
    expect(formatCountdown(90.9)).toBe("01:30")
  })
})
