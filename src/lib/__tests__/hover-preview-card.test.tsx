import { render } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { HoverPreviewCard } from "@/components/universe/hover-preview-card"
import type { GraphNode } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"

const baseSchema: SchemaNode = {
  type: "topic",
  label: "Topic",
  title_key: "name",
  index: "name",
  icon: "tag",
  properties: [],
}

const nodeWithoutSnippet: GraphNode = {
  ref_id: "1",
  node_type: "topic",
  properties: { name: "My Topic" },
  score: 1,
  match_type: "exact",
  weight: 1,
}

const nodeWithSnippet: GraphNode = {
  ref_id: "2",
  node_type: "topic",
  properties: { name: "My Topic", description: "Some interesting description" },
  score: 1,
  match_type: "exact",
  weight: 1,
}

const nodeSnippetEqualsTitle: GraphNode = {
  ref_id: "3",
  node_type: "topic",
  properties: { name: "My Topic", description: "My Topic" },
  score: 1,
  match_type: "exact",
  weight: 1,
}

const longText =
  "This is a very long section of text that goes on and on and contains many words describing the content of a document section in great detail beyond one hundred and twenty characters total"

const sectionSchema: SchemaNode = {
  type: "Section",
  label: "Section",
  title_key: "text",
  description_key: "text",
  index: "text",
  icon: "file-text",
  properties: [],
}

// Section node: title_key and description_key both point to "text" (same field)
const sectionNode: GraphNode = {
  ref_id: "section-1",
  node_type: "Section",
  properties: { text: longText },
  score: 1,
  match_type: "exact",
  weight: 1,
}

// Section node with a distinct snippet so the card would render
const sectionNodeWithDistinctSnippet: GraphNode = {
  ref_id: "section-2",
  node_type: "Section",
  properties: { text: longText, description: "A concise summary of the section." },
  score: 1,
  match_type: "exact",
  weight: 1,
}

describe("HoverPreviewCard", () => {
  it("returns null when node is null", () => {
    const { container } = render(
      <HoverPreviewCard node={null} schemas={[baseSchema]} x={100} y={100} />
    )
    expect(container.firstChild).toBeNull()
  })

  it("returns null when node has no snippet content", () => {
    const { container } = render(
      <HoverPreviewCard node={nodeWithoutSnippet} schemas={[baseSchema]} x={100} y={100} />
    )
    expect(container.firstChild).toBeNull()
  })

  it("returns null when snippet equals the title", () => {
    const { container } = render(
      <HoverPreviewCard node={nodeSnippetEqualsTitle} schemas={[baseSchema]} x={100} y={100} />
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders tooltip when node has a valid snippet distinct from title", () => {
    const { getByText } = render(
      <HoverPreviewCard node={nodeWithSnippet} schemas={[baseSchema]} x={100} y={100} />
    )
    expect(getByText("My Topic")).toBeTruthy()
    expect(getByText("Some interesting description")).toBeTruthy()
  })

  it("returns null for a Section node where title_key === description_key === text (no snippet)", () => {
    const { container } = render(
      <HoverPreviewCard node={sectionNode} schemas={[sectionSchema]} x={100} y={100} />
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders a truncated title (≤ 120 chars + …) when Section node has a distinct snippet", () => {
    const { container, getByText } = render(
      <HoverPreviewCard node={sectionNodeWithDistinctSnippet} schemas={[sectionSchema]} x={100} y={100} />
    )
    expect(container.firstChild).not.toBeNull()
    expect(getByText("A concise summary of the section.")).toBeTruthy()
    // Title element should be capped
    const titleEl = container.querySelector("p.text-sm")
    expect(titleEl).not.toBeNull()
    const titleText = titleEl!.textContent ?? ""
    expect(titleText.length).toBeLessThanOrEqual(121) // 120 chars + "…"
    expect(titleText.endsWith("…")).toBe(true)
  })
})
