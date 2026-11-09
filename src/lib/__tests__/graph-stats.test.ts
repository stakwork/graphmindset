import { describe, it, expect } from "vitest"
import { getDisplayStats, formatStatNumber } from "../graph-stats"

describe("getDisplayStats", () => {
  it("returns nodes and CVEs when cve_count present", () => {
    expect(getDisplayStats({ node_count: 10, cve_count: 3 })).toEqual([
      { label: "Nodes", value: 10 },
      { label: "CVEs", value: 3 },
    ])
  })
  it("returns only nodes when cve_count absent or 0", () => {
    expect(getDisplayStats({ node_count: 10 })).toEqual([{ label: "Nodes", value: 10 }])
    expect(getDisplayStats({ node_count: 10, cve_count: 0 })).toEqual([{ label: "Nodes", value: 10 }])
  })
  it("uses node_count, not num_nodes", () => {
    expect(getDisplayStats({ node_count: 5, num_nodes: 0 })[0].value).toBe(5)
  })
  it("returns nothing without node_count", () => {
    expect(getDisplayStats({ num_nodes: 7 })).toEqual([])
    expect(getDisplayStats(null)).toEqual([])
  })
  it("formats with grouping", () => {
    expect(formatStatNumber(1776798)).toBe("1,776,798")
  })
})
