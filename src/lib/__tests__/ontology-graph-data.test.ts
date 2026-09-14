import { describe, it, expect } from "vitest"
import { ontologyGraphData, type OntologyGraphData } from "@/lib/ontology-graph-data"
import type { SchemaEdge, SchemaNode } from "@/lib/schema-types"

const schema = (ref_id: string, type: string, parent = "", rank: Partial<SchemaNode> = {}): SchemaNode => ({
  ref_id,
  type,
  parent,
  color: "#000000",
  node_key: "name",
  attributes: [{ key: "name", type: "string", required: true }],
  ...rank,
})

const edge = (source: string, target: string, edge_type: string): SchemaEdge => ({
  ref_id: `${source}-${edge_type}-${target}`,
  source,
  target,
  edge_type,
})

// Thing ─┬─ Person
//        ├─ Organization
//        └─ Content ── Tweet
const SCHEMAS = [
  schema("thing", "Thing"),
  schema("person", "Person", "Thing"),
  schema("org", "Organization", "Thing"),
  schema("content", "Content", "Thing"),
  schema("tweet", "Tweet", "Content"),
]

const EDGES = [
  edge("person", "thing", "CHILD_OF"),
  edge("org", "thing", "CHILD_OF"),
  edge("content", "thing", "CHILD_OF"),
  edge("tweet", "content", "CHILD_OF"),
  edge("person", "org", "WORKS_AT"),
  edge("tweet", "person", "AUTHORED_BY"),
]

const refs = (data: OntologyGraphData) => data.nodes.map((n) => n.ref_id).sort()
const edgeTypes = (data: OntologyGraphData) => data.edges.map((e) => e.edge_type).sort()

describe("ontologyGraphData", () => {
  it("draws every type, leaving out the CHILD_OF spokes into the root", () => {
    const data = ontologyGraphData(SCHEMAS, EDGES, null, null)
    expect(refs(data)).toEqual(["content", "org", "person", "thing", "tweet"])
    expect(data.edges.map((e) => `${e.source}>${e.target}`)).toEqual([
      "tweet>content",
      "person>org",
      "tweet>person",
    ])
    expect(data.rootRefId).toBeUndefined()
  })

  it("captions a node with its type name and summarizes it for the hover card", () => {
    const person = ontologyGraphData(SCHEMAS, EDGES, null, null).nodes.find((n) => n.ref_id === "person")!
    expect(person.node_type).toBe("Person")
    expect(person.properties).toMatchObject({
      name: "Person",
      description: "extends Thing · 1 attribute · 2 relationships",
    })
  })

  it("orders nodes by height, then centrality, then name", () => {
    const ranked = [
      schema("tweet", "Tweet", "Content", { height: 2, centrality: 1 }),
      schema("org", "Organization", "Thing", { height: 1, centrality: 1 }),
      schema("content", "Content", "Thing", { height: 1, centrality: 1 }),
      schema("person", "Person", "Thing", { height: 1, centrality: 2 }),
      schema("thing", "Thing", "", { height: 0, centrality: 3 }),
    ]
    expect(ontologyGraphData(ranked, EDGES, null, null).nodes.map((n) => n.node_type)).toEqual([
      "Thing",
      "Person",
      "Content",
      "Organization",
      "Tweet",
    ])
  })

  it("colours types by their top-level branch; roots and loose top-level types stay neutral", () => {
    const { groups } = ontologyGraphData(SCHEMAS, EDGES, null, null)
    expect(Object.fromEntries(groups)).toEqual({
      thing: null,
      person: null,
      org: null,
      content: "Content",
      tweet: "Content",
    })
  })

  it("focuses a selected type on itself and its direct neighbors, root spokes included", () => {
    const data = ontologyGraphData(SCHEMAS, EDGES, "org", null)
    expect(data.rootRefId).toBe("org")
    expect(refs(data)).toEqual(["org", "person", "thing"])
    expect(edgeTypes(data)).toEqual(["CHILD_OF", "CHILD_OF", "WORKS_AT"])
  })

  it("shows only the relationships of a selected edge type", () => {
    const data = ontologyGraphData(SCHEMAS, EDGES, null, "AUTHORED_BY")
    expect(refs(data)).toEqual(["person", "tweet"])
    expect(edgeTypes(data)).toEqual(["AUTHORED_BY"])
  })

  it("falls back to the full ontology when the edge type has no relationships", () => {
    expect(ontologyGraphData(SCHEMAS, EDGES, null, "MISSING").nodes).toHaveLength(5)
  })

  it("derives CHILD_OF from the parent field when the payload has none", () => {
    expect(ontologyGraphData(SCHEMAS, [], "content", null).edges).toEqual([
      { source: "content", target: "thing", edge_type: "CHILD_OF" },
      { source: "tweet", target: "content", edge_type: "CHILD_OF" },
    ])
    expect(ontologyGraphData(SCHEMAS, [], null, null).groups.get("tweet")).toBe("Content")
  })

  it("drops edges whose endpoints are not schema types", () => {
    const data = ontologyGraphData(SCHEMAS, [...EDGES, edge("person", "*", "LINKS")], null, null)
    expect(data.edges.some((e) => e.edge_type === "LINKS")).toBe(false)
  })

  it("changes the layout key only when the drawn graph changes", () => {
    const base = ontologyGraphData(SCHEMAS, EDGES, null, null).layoutKey
    expect(ontologyGraphData([...SCHEMAS], [...EDGES], null, null).layoutKey).toBe(base)
    const withoutAuthoredBy = EDGES.filter((e) => e.edge_type !== "AUTHORED_BY")
    expect(ontologyGraphData(SCHEMAS, withoutAuthoredBy, null, null).layoutKey).not.toBe(base)
    expect(ontologyGraphData(SCHEMAS, EDGES, "org", null).layoutKey).not.toBe(base)
  })
})
