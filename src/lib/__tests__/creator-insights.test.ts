import { describe, it, expect } from "vitest"
import { getGrowthBadge } from "../creator-insights"

describe("getGrowthBadge", () => {
  it("returns 'up' when current > previous", () => {
    expect(getGrowthBadge(5, 3)).toBe("up")
  })

  it("returns 'flat' when current === previous", () => {
    expect(getGrowthBadge(3, 3)).toBe("flat")
  })

  it("returns 'down' when current < previous", () => {
    expect(getGrowthBadge(2, 5)).toBe("down")
  })

  it("returns 'flat' when both are zero", () => {
    expect(getGrowthBadge(0, 0)).toBe("flat")
  })

  it("returns 'up' when current is 1 and previous is 0", () => {
    expect(getGrowthBadge(1, 0)).toBe("up")
  })
})
