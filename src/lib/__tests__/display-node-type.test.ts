import { describe, it, expect } from "vitest"
import { displayNodeType } from "@/lib/utils"

describe("displayNodeType", () => {
  it('maps "Radar" to "Source"', () => {
    expect(displayNodeType("Radar")).toBe("Source")
  })

  it("passes through simple node types unchanged", () => {
    expect(displayNodeType("Tweet")).toBe("Tweet")
    expect(displayNodeType("Episode")).toBe("Episode")
    expect(displayNodeType("Unknown")).toBe("Unknown")
  })

  it("splits CamelCase node types into readable labels", () => {
    expect(displayNodeType("WebPage")).toBe("Web Page")
  })
})
