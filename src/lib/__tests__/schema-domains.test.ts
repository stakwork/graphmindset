import { describe, it, expect } from "vitest"
import { domainKeyOf, filterSchemasByDomain, listSchemaDomains } from "@/lib/schema-domains"
import type { SchemaEdge, SchemaNode } from "@/lib/schema-types"

const schema = (ref_id: string, type: string, parent: string, domain?: string): SchemaNode => ({
  ref_id,
  type,
  parent,
  domain,
  color: "#000000",
  node_key: "name",
  attributes: [{ key: "name", type: "string", required: true }],
})

const edge = (
  source: string,
  target: string,
  edge_type: string,
  types?: { source_type: string; target_type: string }
): SchemaEdge => ({
  ref_id: `${source}-${edge_type}-${target}`,
  source,
  target,
  edge_type,
  ...types,
})

// Thing ─┬─ Person (Entity)
//        ├─ Repository (CodeGraph)
//        └─ Tweet (Content)
const SCHEMAS = [
  schema("thing", "Thing", ""),
  schema("person", "Person", "Thing"),
  schema("repo", "Repository", "Thing", "CodeGraph"),
  schema("tweet", "Tweet", "Thing", "Content"),
]

const EDGES = [
  edge("person", "thing", "CHILD_OF"),
  edge("repo", "thing", "CHILD_OF"),
  edge("tweet", "thing", "CHILD_OF"),
  edge("tweet", "person", "AUTHORED_BY"),
  edge("person", "repo", "CONTRIBUTES_TO"),
]

describe("domainKeyOf", () => {
  it("lowercases the domain and defaults to entity", () => {
    expect(domainKeyOf(schema("a", "A", "Thing", "CodeGraph"))).toBe("codegraph")
    expect(domainKeyOf(schema("a", "A", "Thing"))).toBe("entity")
    expect(domainKeyOf(schema("a", "A", "Thing", ""))).toBe("entity")
  })
})

describe("listSchemaDomains", () => {
  it("unions the API list with the schemas' domains, counting types per domain", () => {
    const options = listSchemaDomains(SCHEMAS, ["content", "workflow"])
    expect(options).toEqual([
      { key: "codegraph", label: "CodeGraph", count: 1 },
      { key: "content", label: "Content", count: 1 },
      { key: "entity", label: "Entity", count: 1 },
      { key: "workflow", label: "Workflow", count: 0 },
    ])
  })

  it("never counts the root type", () => {
    expect(listSchemaDomains([schema("thing", "Thing", "")])).toEqual([])
  })

  it("works without an API list (mock mode)", () => {
    expect(listSchemaDomains(SCHEMAS).map((d) => d.key)).toEqual(["codegraph", "content", "entity"])
  })
})

describe("filterSchemasByDomain", () => {
  it("returns the same arrays when nothing is disabled", () => {
    const out = filterSchemasByDomain(SCHEMAS, EDGES, new Set())
    expect(out.schemas).toBe(SCHEMAS)
    expect(out.edges).toBe(EDGES)
  })

  it("drops types in a disabled domain and every edge touching them by ref_id", () => {
    const out = filterSchemasByDomain(SCHEMAS, EDGES, new Set(["content"]))
    expect(out.schemas.map((s) => s.type)).toEqual(["Thing", "Person", "Repository"])
    expect(out.edges.map((e) => e.ref_id)).toEqual([
      "person-CHILD_OF-thing",
      "repo-CHILD_OF-thing",
      "person-CONTRIBUTES_TO-repo",
    ])
  })

  it("also matches edges by source_type / target_type", () => {
    const byName = [
      edge("x", "y", "MENTIONS", { source_type: "Tweet", target_type: "Person" }),
      edge("x", "z", "MENTIONS", { source_type: "Person", target_type: "Repository" }),
    ]
    const out = filterSchemasByDomain(SCHEMAS, byName, new Set(["content"]))
    expect(out.edges.map((e) => e.ref_id)).toEqual(["x-MENTIONS-z"])
  })

  it("keeps Thing even when every domain is disabled", () => {
    const out = filterSchemasByDomain(SCHEMAS, EDGES, new Set(["entity", "codegraph", "content"]))
    expect(out.schemas.map((s) => s.type)).toEqual(["Thing"])
    expect(out.edges).toEqual([])
  })

  it("does not mutate its inputs", () => {
    const schemasCopy = SCHEMAS.map((s) => ({ ...s }))
    const edgesCopy = EDGES.map((e) => ({ ...e }))
    filterSchemasByDomain(SCHEMAS, EDGES, new Set(["entity"]))
    expect(SCHEMAS).toEqual(schemasCopy)
    expect(EDGES).toEqual(edgesCopy)
  })
})
