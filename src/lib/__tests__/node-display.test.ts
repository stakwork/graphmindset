import { describe, it, expect } from "vitest"
import { capTitle, TITLE_MAX_LEN, resolveNodeTitle } from "@/lib/node-display"
import type { GraphNode } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"

describe("capTitle", () => {
  it("returns string unchanged when <= 120 chars", () => {
    const short = "Hello world"
    expect(capTitle(short)).toBe(short)

    const exactly120 = "a".repeat(120)
    expect(capTitle(exactly120)).toBe(exactly120)
  })

  it("trims at last word boundary and appends ellipsis when > 120 chars", () => {
    const str = "The quick brown fox jumps over the lazy dog and keeps running through the fields of green grass until it reaches the river"
    // str.length > 120
    const result = capTitle(str)
    expect(result.endsWith("…")).toBe(true)
    // The visible text before ellipsis should be <= 120 chars
    const withoutEllipsis = result.slice(0, -1) // remove "…"
    expect(withoutEllipsis.length).toBeLessThanOrEqual(120)
    // Should not end with a partial word
    expect(withoutEllipsis.trimEnd()).not.toMatch(/\S$\s/)
  })

  it("handles strings with no whitespace — mid-char cut", () => {
    const noSpace = "a".repeat(150)
    const result = capTitle(noSpace)
    expect(result.endsWith("…")).toBe(true)
    // slice(0,120) with no whitespace means replace does nothing, so result is 120 chars + "…"
    expect(result).toBe("a".repeat(120) + "…")
  })

  it("respects custom max parameter", () => {
    const str = "Hello world this is a test"
    const result = capTitle(str, 10)
    expect(result.endsWith("…")).toBe(true)
    const withoutEllipsis = result.slice(0, -1)
    expect(withoutEllipsis.length).toBeLessThanOrEqual(10)
  })
})

describe("resolveNodeTitle", () => {
  it("returns capped title for a Section-like node with a long text prop", () => {
    const longText = "This is a very long section of text that goes on and on and contains many words describing the content of a document section in great detail beyond one hundred and twenty characters total"

    const sectionNode: GraphNode = {
      ref_id: "section-1",
      node_type: "Section",
      properties: { text: longText },
      score: 1,
      match_type: "exact",
      weight: 1,
    }

    const sectionSchema: SchemaNode = {
      type: "Section",
      label: "Section",
      title_key: "text",
      description_key: "text",
      index: "text",
      icon: "file-text",
      properties: [],
    }

    const result = resolveNodeTitle(sectionNode, [sectionSchema])
    expect(result.endsWith("…")).toBe(true)
    const withoutEllipsis = result.slice(0, -1)
    expect(withoutEllipsis.length).toBeLessThanOrEqual(TITLE_MAX_LEN)
  })

  it("returns short title unchanged for a normal node", () => {
    const node: GraphNode = {
      ref_id: "topic-1",
      node_type: "Topic",
      properties: { name: "Artificial Intelligence" },
      score: 1,
      match_type: "exact",
      weight: 1,
    }

    const schema: SchemaNode = {
      type: "Topic",
      label: "Topic",
      title_key: "name",
      index: "name",
      icon: "tag",
      properties: [],
    }

    expect(resolveNodeTitle(node, [schema])).toBe("Artificial Intelligence")
  })

  it("falls back to ref_id (always short) without capping", () => {
    const node: GraphNode = {
      ref_id: "abc123",
      node_type: "Unknown",
      properties: {},
      score: 1,
      match_type: "exact",
      weight: 1,
    }

    expect(resolveNodeTitle(node, [])).toBe("abc123")
  })
})
