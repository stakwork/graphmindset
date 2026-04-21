import { describe, it, expect } from "vitest"
import { displayNodeType } from "@/lib/utils"

describe("displayNodeType", () => {
  it('maps "Radar" to "Source"', () => {
    expect(displayNodeType("Radar")).toBe("Source")
  })

  it("passes through other node types unchanged", () => {
    expect(displayNodeType("Tweet")).toBe("Tweet")
    expect(displayNodeType("Episode")).toBe("Episode")
    expect(displayNodeType("WebPage")).toBe("WebPage")
    expect(displayNodeType("Unknown")).toBe("Unknown")
  })
})
