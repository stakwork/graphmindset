import { describe, it, expect } from "vitest"
import { getTransactionLabel } from "../sphinx/payment"

describe("getTransactionLabel", () => {
  it("returns 'Other' for empty string", () => {
    expect(getTransactionLabel("")).toBe("Other")
  })

  it("returns 'Other' for unknown endpoint", () => {
    expect(getTransactionLabel("unknown_endpoint")).toBe("Other")
  })

  // Purchase
  it("returns 'Purchase' for nodes/ path", () => {
    expect(getTransactionLabel("v2/nodes/abc-123")).toBe("Purchase")
  })

  it("returns 'Purchase' for v2/nodes/:ref_id literal", () => {
    expect(getTransactionLabel("v2/nodes/:ref_id")).toBe("Purchase")
  })

  // Search
  it("returns 'Search' for v2/nodes (exact)", () => {
    expect(getTransactionLabel("v2/nodes")).toBe("Search")
  })

  it("returns 'Search' for search", () => {
    expect(getTransactionLabel("search")).toBe("Search")
  })

  it("returns 'Search' for v2/search", () => {
    expect(getTransactionLabel("v2/search")).toBe("Search")
  })

  it("returns 'Search' for graph/search", () => {
    expect(getTransactionLabel("graph/search")).toBe("Search")
  })

  it("returns 'Search' for graph/search/latest", () => {
    expect(getTransactionLabel("graph/search/latest")).toBe("Search")
  })

  // Boost
  it("returns 'Boost' for boost", () => {
    expect(getTransactionLabel("boost")).toBe("Boost")
  })

  // Top Up
  it("returns 'Top Up' for top_up_confirm", () => {
    expect(getTransactionLabel("top_up_confirm")).toBe("Top Up")
  })

  it("returns 'Top Up' for buy_lsat", () => {
    expect(getTransactionLabel("buy_lsat")).toBe("Top Up")
  })

  // Add Content
  it("returns 'Add Content' for v2/content", () => {
    expect(getTransactionLabel("v2/content")).toBe("Add Content")
  })

  it("returns 'Add Content' for add_node", () => {
    expect(getTransactionLabel("add_node")).toBe("Add Content")
  })

  it("returns 'Add Content' for node", () => {
    expect(getTransactionLabel("node")).toBe("Add Content")
  })

  it("returns 'Add Content' for node/content", () => {
    expect(getTransactionLabel("node/content")).toBe("Add Content")
  })

  // Add Source
  it("returns 'Add Source' for radar", () => {
    expect(getTransactionLabel("radar")).toBe("Add Source")
  })

  // Case insensitivity
  it("is case-insensitive", () => {
    expect(getTransactionLabel("RADAR")).toBe("Add Source")
    expect(getTransactionLabel("V2/Nodes")).toBe("Search")
  })
})
