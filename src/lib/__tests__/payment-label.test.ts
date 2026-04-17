import { describe, it, expect } from "vitest"
import { getActionDisplayLabel, getActionBadgeColor } from "../transaction-display"

describe("getActionDisplayLabel", () => {
  it("returns correct label for each action", () => {
    expect(getActionDisplayLabel("top_up")).toBe("Top Up")
    expect(getActionDisplayLabel("search")).toBe("Search")
    expect(getActionDisplayLabel("purchase")).toBe("Purchase")
    expect(getActionDisplayLabel("boost")).toBe("Boost")
    expect(getActionDisplayLabel("boost_refund")).toBe("Refund")
    expect(getActionDisplayLabel("refund")).toBe("Refund")
    expect(getActionDisplayLabel("add_content")).toBe("Add Content")
    expect(getActionDisplayLabel("add_source")).toBe("Add Source")
    expect(getActionDisplayLabel("other")).toBe("Other")
  })

  it("returns 'Other' for unknown actions", () => {
    expect(getActionDisplayLabel("unknown")).toBe("Other")
    expect(getActionDisplayLabel("")).toBe("Other")
  })
})

describe("getActionBadgeColor", () => {
  it("returns emerald for credits", () => {
    expect(getActionBadgeColor("top_up")).toContain("text-emerald-400")
    expect(getActionBadgeColor("add_content")).toContain("text-emerald-400")
    expect(getActionBadgeColor("refund")).toContain("text-emerald-400")
  })

  it("returns blue for search", () => {
    expect(getActionBadgeColor("search")).toContain("text-blue-400")
  })

  it("returns purple for purchase", () => {
    expect(getActionBadgeColor("purchase")).toContain("text-purple-400")
  })

  it("returns amber for boost actions", () => {
    expect(getActionBadgeColor("boost")).toContain("text-amber")
    expect(getActionBadgeColor("boost_refund")).toContain("text-amber")
  })

  it("returns teal for add_source", () => {
    expect(getActionBadgeColor("add_source")).toContain("text-teal-400")
  })

  it("returns muted for unknown actions", () => {
    expect(getActionBadgeColor("unknown")).toContain("text-muted-foreground")
  })
})
