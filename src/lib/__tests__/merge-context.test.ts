import { describe, it, expect } from "vitest"
import {
  cleanExcerpt,
  deriveMergeContext,
  deriveSubjectContext,
} from "@/lib/merge-context"
import type { SubgraphResponse } from "@/lib/graph-api"

function graph(partial: Partial<SubgraphResponse>): SubgraphResponse {
  return { nodes: [], edges: [], ...partial }
}

describe("cleanExcerpt", () => {
  it("strips stored wrapper quotes and collapses whitespace", () => {
    expect(cleanExcerpt('"A US ban   was\n\nsupposed"')).toBe(
      "A US ban was supposed"
    )
  })

  it("returns null for non-strings and empty strings", () => {
    expect(cleanExcerpt(undefined)).toBeNull()
    expect(cleanExcerpt(42)).toBeNull()
    expect(cleanExcerpt('""')).toBeNull()
    expect(cleanExcerpt("   ")).toBeNull()
  })

  it("truncates long text on a word boundary with an ellipsis", () => {
    const result = cleanExcerpt("word ".repeat(100))
    expect(result!.length).toBeLessThanOrEqual(221)
    expect(result!.endsWith("…")).toBe(true)
    expect(result).not.toContain("wor…") // no mid-word cut
  })
})

describe("deriveSubjectContext", () => {
  const subject = "org-1"
  const subgraph = graph({
    nodes: [
      { ref_id: subject, node_type: "Organization", properties: { name: "United States" } },
      {
        ref_id: "tweet-1",
        node_type: "Tweet",
        properties: { text: '"a sentence   mentioning it"' },
      },
      { ref_id: "chapter-1", node_type: "Chapter", properties: { name: "AI race overview" } },
      { ref_id: "alias-1", node_type: "Organization", properties: { name: "USA" } },
      { ref_id: "bystander", node_type: "Episode", properties: { episode_title: "Ep" } },
    ],
    edges: [
      { ref_id: 1, edge_type: "MENTIONS", source: "tweet-1", target: subject },
      { ref_id: 2, edge_type: "MENTIONS", source: "chapter-1", target: subject },
      { ref_id: 3, edge_type: "IS_ALIAS", source: "alias-1", target: subject },
      // outgoing MENTIONS: counts as a connection but not a mention source
      { ref_id: 4, edge_type: "MENTIONS", source: subject, target: "bystander" },
      // edge between neighbors — apoc returns these; must not affect the subject
      { ref_id: 5, edge_type: "HAS", source: "bystander", target: "chapter-1" },
    ],
  })

  it("counts only incident edges and dedupes neighbors", () => {
    const ctx = deriveSubjectContext(subject, subgraph)
    expect(ctx.degree).toBe(4)
    expect(ctx.edgeCounts).toEqual({ MENTIONS: 3, IS_ALIAS: 1 })
  })

  it("collects cleaned excerpts only from incoming MENTIONS sources", () => {
    const ctx = deriveSubjectContext(subject, subgraph)
    expect(ctx.mentions).toEqual([
      { refId: "tweet-1", nodeType: "Tweet", excerpt: "a sentence mentioning it" },
      { refId: "chapter-1", nodeType: "Chapter", excerpt: "AI race overview" },
    ])
  })
})

describe("deriveMergeContext", () => {
  const a = "node-a"
  const b = "node-b"

  function graphFor(subject: string, neighbors: string[]): SubgraphResponse {
    return graph({
      nodes: neighbors.map((id) => ({
        ref_id: id,
        node_type: "Episode",
        properties: { name: `Name ${id}` },
      })),
      edges: neighbors.map((id, i) => ({
        ref_id: i,
        edge_type: "MENTIONS",
        source: id,
        target: subject,
      })),
    })
  }

  it("intersects neighborhoods, excluding the subjects themselves", () => {
    // a and b are each other's neighbors (IS_ALIAS-style) plus one real shared
    const ctx = deriveMergeContext(
      [a, b],
      [graphFor(a, ["shared-1", "only-a", b]), graphFor(b, ["shared-1", "only-b", a])]
    )
    expect(ctx.sharedCount).toBe(1)
    expect(ctx.sharedExamples).toEqual([
      { refId: "shared-1", name: "Name shared-1", nodeType: "Episode" },
    ])
  })

  it("reports zero overlap for disjoint neighborhoods", () => {
    const ctx = deriveMergeContext(
      [a, b],
      [graphFor(a, ["x1", "x2"]), graphFor(b, ["y1"])]
    )
    expect(ctx.sharedCount).toBe(0)
    expect(ctx.sharedExamples).toEqual([])
    expect(ctx.subjects[0].degree).toBe(2)
    expect(ctx.subjects[1].degree).toBe(1)
  })

  it("tolerates a missing subgraph for a subject", () => {
    const ctx = deriveMergeContext([a, b], [graphFor(a, ["x1"])])
    expect(ctx.subjects).toHaveLength(2)
    expect(ctx.subjects[1].degree).toBe(0)
    expect(ctx.sharedCount).toBe(0)
  })
})
