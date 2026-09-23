import { describe, it, expect } from "vitest"
import { ontologyDigest } from "@/lib/ontology-digest"
import type { SchemaNode, SchemaEdge } from "@/lib/schema-types"

const node = (type: string, parent: string, domain: string, attrs: Array<[string, boolean]> = []): SchemaNode => ({
  ref_id: type,
  type,
  parent,
  domain,
  color: "#000",
  node_key: `${type.toLowerCase()}-id`,
  attributes: attrs.map(([key, required]) => ({ key, type: "string", required })),
})

const schemas: SchemaNode[] = [
  node("Thing", "", "entity"),
  node("SysComponent", "Thing", "SystemMap", [["id", true], ["description", false]]),
  node("SysServiceComponent", "SysComponent", "SystemMap"),
  node("SysBackendService", "SysServiceComponent", "SystemMap"),
  node("SysApplicationComponent", "SysComponent", "SystemMap"),
  node("SysResource", "Thing", "SystemMap"),
  node("System", "Thing", "Infosec", [["system_id", true]]),
  node("Person", "Thing", "Entity"),
]
const edges: SchemaEdge[] = [
  { ref_id: "e1", source: "System", target: "SysComponent", edge_type: "CONTAINS", source_type: "System", target_type: "SysComponent" },
  { ref_id: "e2", source: "SysComponent", target: "SysResource", edge_type: "RUNS_ON", source_type: "SysComponent", target_type: "SysResource" },
  { ref_id: "e3", source: "SysComponent", target: "Thing", edge_type: "CHILD_OF", source_type: "SysComponent", target_type: "Thing" },
  { ref_id: "e4", source: "Person", target: "Person", edge_type: "KNOWS", source_type: "Person", target_type: "Person" },
  { ref_id: "e5", source: "SysComponent", target: "SysResource", edge_type: "CONNECTS_TO", source_type: "SysComponent", target_type: "SysResource", attributes: { since: "?datetime" } },
]

describe("ontologyDigest", () => {
  it("indents by CHILD_OF depth, sorted by name, with own attributes", () => {
    const text = ontologyDigest(schemas, edges, { domains: ["systemmap"] })
    expect(text).toContain("SysComponent [systemmap]: id, ?description\n  SysApplicationComponent\n  SysServiceComponent\n    SysBackendService\n")
    expect(text).toContain("SysResource [systemmap]\n")
    expect(text).not.toContain("Person")
    expect(text).not.toContain("Thing [")
  })

  it("keeps relationships with one endpoint in the selection and drops CHILD_OF", () => {
    const text = ontologyDigest(schemas, edges, { domains: ["systemmap"] })
    expect(text).toContain("System CONTAINS SysComponent")
    expect(text).toContain("SysComponent CONNECTS_TO SysResource {since: ?datetime}")
    expect(text).not.toContain("CHILD_OF SysComponent")
    expect(text).not.toContain("KNOWS")
    expect(text).toContain("5 types, 3 relationships")
  })

  it("prints a type whose parent is outside the selection as an annotated root", () => {
    const text = ontologyDigest(schemas, edges, { domains: ["systemmap"], attributes: false })
    // Restrict to a subtree by excluding the root domain: nothing to annotate here,
    // so simulate by selecting a child alone.
    const sub = ontologyDigest(
      schemas.filter((s) => s.type !== "SysComponent"),
      edges,
      { domains: ["systemmap"], attributes: false }
    )
    expect(sub).toContain("SysServiceComponent [systemmap] (extends SysComponent)\n  SysBackendService")
    expect(text).not.toContain(": id")
  })

  it("covers every domain when none is given", () => {
    const text = ontologyDigest(schemas, edges)
    expect(text).toContain("(domains: entity, infosec, systemmap)")
    expect(text).toContain("Person [entity]")
    expect(text).toContain("Person KNOWS Person")
  })
})
