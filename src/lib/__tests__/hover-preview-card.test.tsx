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
})
