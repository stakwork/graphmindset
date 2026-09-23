import { describe, it, expect } from "vitest"
import {
  buildOutlineModel,
  defaultExpandedRefs,
  allExpandableRefs,
  outlineAncestors,
  searchOutline,
  relationshipsForType,
} from "@/lib/ontology-outline"
import type { SchemaNode, SchemaEdge } from "@/lib/schema-types"

const node = (type: string, parent: string, domain?: string, nodeKey = `${type.toLowerCase()}_id`): SchemaNode => ({
  ref_id: `r-${type}`,
  type,
  parent,
  domain,
  color: "#000",
  node_key: nodeKey,
  attributes: [],
})

const edge = (source: string, edge_type: string, target: string): SchemaEdge => ({
  ref_id: `${source}-${edge_type}-${target}`,
  source: `r-${source}`,
  target: `r-${target}`,
  edge_type,
  source_type: source,
  target_type: target,
})

// Thing ─┬─ SysComponent (SystemMap) ─┬─ SysServiceComponent ─── SysBackendService ─── SysApiService
//        │                            └─ SysApplicationComponent
//        ├─ SysResource (SystemMap)
//        ├─ Person (Entity, no domain set)
//        └─ System (Infosec)
const schemas: SchemaNode[] = [
  node("Thing", "", "entity"),
  node("SysServiceComponent", "SysComponent", "SystemMap"),
  node("SysComponent", "Thing", "SystemMap"),
  node("SysApiService", "SysBackendService", "SystemMap"),
  node("SysBackendService", "SysServiceComponent", "SystemMap"),
  node("SysApplicationComponent", "SysComponent", "SystemMap"),
  node("SysResource", "Thing", "SystemMap"),
  node("Person", "Thing", undefined, "name"),
  node("System", "Thing", "Infosec"),
]
const edges: SchemaEdge[] = [
  edge("System", "CONTAINS", "SysComponent"),
  edge("SysComponent", "RUNS_ON", "SysResource"),
  edge("SysComponent", "CHILD_OF", "Thing"),
  edge("Person", "KNOWS", "Person"),
  edge("SysBackendService", "CALLS", "SysApiService"),
  edge("Person", "OWNS", "SysServiceComponent"),
]

describe("buildOutlineModel", () => {
  const model = buildOutlineModel(schemas)

  it("groups by domain, labelled and sorted like the domains page, with totals", () => {
    expect(model.domains.map((d) => [d.key, d.label, d.count])).toEqual([
      ["entity", "Entity", 1],
      ["infosec", "Infosec", 1],
      ["systemmap", "SystemMap", 6],
    ])
    expect(model.byRef.has("r-Thing")).toBe(false)
  })

  it("nests by parent with siblings sorted by name and direct/total counts", () => {
    const sys = model.domains.find((d) => d.key === "systemmap")!
    expect(sys.roots.map((r) => r.type)).toEqual(["SysComponent", "SysResource"])
    const comp = sys.roots[0]
    expect(comp.children.map((c) => c.type)).toEqual(["SysApplicationComponent", "SysServiceComponent"])
    expect(comp.directCount).toBe(2)
    expect(comp.totalCount).toBe(4)
    expect(comp.depth).toBe(0)
    const svc = comp.children[1]
    expect(svc.depth).toBe(1)
    expect(svc.children[0].children[0].type).toBe("SysApiService")
    expect(svc.children[0].children[0].depth).toBe(3)
    expect(model.byRef.get("r-SysResource")!.totalCount).toBe(0)
  })

  it("promotes a type whose parent was filtered out to a root", () => {
    const sub = buildOutlineModel(schemas.filter((s) => s.type !== "SysComponent"))
    const sys = sub.domains.find((d) => d.key === "systemmap")!
    expect(sys.roots.map((r) => r.type)).toEqual(["SysApplicationComponent", "SysResource", "SysServiceComponent"])
    expect(sys.count).toBe(5)
  })

  it("survives a parent cycle without dropping types", () => {
    const cyclic = [node("A", "B", "x"), node("B", "A", "x")]
    const m = buildOutlineModel(cyclic)
    expect(m.domains[0].count).toBe(2)
    expect(m.byRef.size).toBe(2)
  })

  it("walks ancestors nearest-first", () => {
    expect(outlineAncestors(model, "r-SysApiService")).toEqual([
      "r-SysBackendService",
      "r-SysServiceComponent",
      "r-SysComponent",
    ])
    expect(outlineAncestors(model, "r-Person")).toEqual([])
  })

  it("opens roots and their direct children by default, everything on expand-all", () => {
    expect(Array.from(defaultExpandedRefs(model)).sort()).toEqual(["r-SysComponent", "r-SysServiceComponent"])
    expect(Array.from(allExpandableRefs(model)).sort()).toEqual([
      "r-SysBackendService",
      "r-SysComponent",
      "r-SysServiceComponent",
    ])
  })
})

describe("searchOutline", () => {
  const model = buildOutlineModel(schemas)

  it("matches type name or node_key case-insensitively and reveals ancestors", () => {
    const s = searchOutline(model, "  API ")
    expect(s.query).toBe("api")
    expect(Array.from(s.matched)).toEqual(["r-SysApiService"])
    expect(Array.from(s.visible).sort()).toEqual([
      "r-SysApiService",
      "r-SysBackendService",
      "r-SysComponent",
      "r-SysServiceComponent",
    ])
    expect(Array.from(s.expanded).sort()).toEqual(["r-SysBackendService", "r-SysComponent", "r-SysServiceComponent"])
  })

  it("matches on node_key too", () => {
    const s = searchOutline(model, "name")
    expect(Array.from(s.matched)).toEqual(["r-Person"])
  })

  it("returns empty sets for an empty query", () => {
    const s = searchOutline(model, "   ")
    expect(s.query).toBe("")
    expect(s.matched.size).toBe(0)
    expect(s.visible.size).toBe(0)
  })
})

describe("relationshipsForType", () => {
  const model = buildOutlineModel(schemas)

  it("lists own and inherited edges, sorted by edge_type, CHILD_OF excluded", () => {
    const rels = relationshipsForType("SysApiService", model.byType, edges)
    // CALLS targets SysApiService itself, so it is its own even though the
    // source is an ancestor; the rest come from ancestors at various depths.
    expect(rels.map((r) => [r.edge.edge_type, r.inheritedFrom])).toEqual([
      ["CALLS", null],
      ["CONTAINS", "SysComponent"],
      ["OWNS", "SysServiceComponent"],
      ["RUNS_ON", "SysComponent"],
    ])
  })

  it("marks an edge as own when either endpoint is the type itself", () => {
    const rels = relationshipsForType("SysComponent", model.byType, edges)
    expect(rels.map((r) => [r.edge.edge_type, r.inheritedFrom])).toEqual([
      ["CONTAINS", null],
      ["RUNS_ON", null],
    ])
  })

  it("ignores unrelated types", () => {
    expect(relationshipsForType("System", model.byType, edges).map((r) => r.edge.edge_type)).toEqual(["CONTAINS"])
    expect(relationshipsForType("Nope", model.byType, edges)).toEqual([])
  })
})
