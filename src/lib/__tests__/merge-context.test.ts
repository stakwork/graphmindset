import { describe, it, expect } from "vitest"
import { deriveMentions, excerptFor, nameStems } from "@/lib/merge-context"
import type { SubgraphResponse } from "@/lib/graph-api"

describe("nameStems", () => {
  it("keeps significant words, stemmed, without stopwords", () => {
    expect(nameStems("Document search and extraction")).toEqual([
      "docu",
      "sear",
      "extrac",
    ])
  })

  it("is empty for null/short names", () => {
    expect(nameStems(null)).toEqual([])
    expect(nameStems("of")).toEqual([])
  })
})

describe("excerptFor", () => {
  it("keeps short texts whole when the window covers them", () => {
    const text =
      '"RT @OpenAI: ChatGPT Voice is now in the desktop app today for everyone"'
    expect(excerptFor(text, "ChatGPT Voice")).toBe(
      "RT @OpenAI: ChatGPT Voice is now in the desktop app today for everyone"
    )
  })

  it("windows around a mid-text occurrence with ellipses marking the cuts", () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`)
    words.splice(15, 0, "Docker", "Compose")
    const result = excerptFor(words.join(" "), "Docker Compose")
    expect(result).toBe(
      "… " +
        // 6 words before the match, the match, 10 words after
        [...words.slice(9, 15), "Docker", "Compose", ...words.slice(17, 27)].join(" ") +
        " …"
    )
  })

  it("matches inflected forms via stems — the name rarely appears verbatim", () => {
    const text =
      "With the official skill your agent acts here to manage files and versions in bulk, search and extract document data, and query your cloud file system for anything else you need today."
    const result = excerptFor(text, "Document search and extraction")
    expect(result).toContain("extract document")
    expect(result!.startsWith("… ")).toBe(true)
    expect(result!.endsWith(" …")).toBe(true)
  })

  it("decodes literal escape sequences from stored tweet text", () => {
    const text = '"two passes:\\n1\\ufe0f\\u20e3 A fast pass"'
    const result = excerptFor(text, null)
    expect(result).not.toContain("\\n")
    expect(result).not.toContain("\\u")
    expect(result).toContain("two passes:")
    expect(result).toContain("A fast pass")
  })

  it("falls back to the head of the text when the name never occurs", () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ")
    expect(excerptFor(words, "Zebra")).toBe(
      Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ") + " …"
    )
  })

  it("returns null for non-strings and empty strings", () => {
    expect(excerptFor(undefined, "x")).toBeNull()
    expect(excerptFor(42, "x")).toBeNull()
    expect(excerptFor('""', "x")).toBeNull()
    expect(excerptFor("   ", "x")).toBeNull()
  })
})

describe("deriveMentions", () => {
  const subject = "org-1"
  const subgraph: SubgraphResponse = {
    nodes: [
      { ref_id: subject, node_type: "Organization", properties: { name: "United States" } },
      {
        ref_id: "tweet-1",
        node_type: "Tweet",
        properties: { text: '"a sentence   mentioning United States"' },
      },
      {
        ref_id: "chapter-1",
        node_type: "Chapter",
        properties: {
          name: "AI race overview",
          description: "The panel frames United States policy against China's.",
        },
      },
      { ref_id: "chapter-2", node_type: "Chapter", properties: { name: "Closing thoughts" } },
      { ref_id: "no-text", node_type: "Image", properties: {} },
      { ref_id: "bystander", node_type: "Episode", properties: { episode_title: "Ep" } },
    ],
    edges: [
      { ref_id: 1, edge_type: "MENTIONS", source: "tweet-1", target: subject },
      { ref_id: 2, edge_type: "MENTIONS", source: "chapter-1", target: subject },
      { ref_id: 3, edge_type: "MENTIONS", source: "no-text", target: subject },
      { ref_id: 7, edge_type: "MENTIONS", source: "chapter-2", target: subject },
      // outgoing MENTIONS: the subject mentioning something is not a source
      { ref_id: 4, edge_type: "MENTIONS", source: subject, target: "bystander" },
      // non-MENTIONS incident edge: not a source either
      { ref_id: 5, edge_type: "IS_ALIAS", source: "bystander", target: subject },
      // edge between neighbors — apoc returns these; must be ignored
      { ref_id: 6, edge_type: "HAS", source: "bystander", target: "chapter-1" },
    ],
  }

  it("collects prose properties only — labels like a chapter's name are not sentences", () => {
    expect(deriveMentions(subject, subgraph, "United States")).toEqual([
      {
        refId: "tweet-1",
        nodeType: "Tweet",
        excerpt: "a sentence mentioning United States",
        matched: true,
      },
      // chapter descriptions are prose and count as source sentences
      {
        refId: "chapter-1",
        nodeType: "Chapter",
        excerpt: "The panel frames United States policy against China's.",
        matched: true,
      },
      // chapter-2 has only a name (topic label) → excluded
    ])
  })

  it("ranks sources containing the name above head-of-text fallbacks", () => {
    const graph: SubgraphResponse = {
      nodes: [
        // text property but the name never occurs → fallback excerpt
        { ref_id: "tweet-nomatch", node_type: "Tweet", properties: { text: "something entirely unrelated" } },
        // only a summary, but it contains the name → matched excerpt
        { ref_id: "ep-match", node_type: "Episode", properties: { summary: "a summary about United States policy" } },
      ],
      edges: [
        { ref_id: 1, edge_type: "MENTIONS", source: "tweet-nomatch", target: subject },
        { ref_id: 2, edge_type: "MENTIONS", source: "ep-match", target: subject },
      ],
    }
    const mentions = deriveMentions(subject, graph, "United States")
    expect(mentions.map((m) => [m.refId, m.matched])).toEqual([
      ["ep-match", true],
      ["tweet-nomatch", false],
    ])
  })

  it("ranks text sources above summary sources regardless of edge order", () => {
    const graph: SubgraphResponse = {
      nodes: [
        { ref_id: "ep-1", node_type: "Episode", properties: { summary: "An episode summary about it" } },
        { ref_id: "tweet-9", node_type: "Tweet", properties: { text: "the actual sentence" } },
      ],
      edges: [
        // summary-bearing source comes FIRST in edge order…
        { ref_id: 1, edge_type: "MENTIONS", source: "ep-1", target: subject },
        { ref_id: 2, edge_type: "MENTIONS", source: "tweet-9", target: subject },
      ],
    }
    const mentions = deriveMentions(subject, graph, null)
    // …but the text-bearing tweet still ranks first
    expect(mentions.map((m) => m.refId)).toEqual(["tweet-9", "ep-1"])
  })

  it("windows into an episode transcript when one is stored", () => {
    const transcript =
      '"Rene Haas: There\'s no computing problem left. ' +
      "filler ".repeat(50) +
      'Later on we discuss how United States policy shapes chip supply chains going forward for everyone involved."'
    const graph: SubgraphResponse = {
      nodes: [
        {
          ref_id: "ep-t",
          node_type: "Episode",
          properties: { transcript, summary: "unrelated summary" },
        },
      ],
      edges: [
        { ref_id: 1, edge_type: "MENTIONS", source: "ep-t", target: subject },
      ],
    }
    const mentions = deriveMentions(subject, graph, "United States")
    expect(mentions).toHaveLength(1)
    expect(mentions[0].matched).toBe(true)
    expect(mentions[0].excerpt).toContain("United States policy shapes")
    expect(mentions[0].excerpt.startsWith("… ")).toBe(true)
  })

  it("returns empty for an empty subgraph", () => {
    expect(deriveMentions(subject, { nodes: [], edges: [] }, null)).toEqual([])
  })
})
