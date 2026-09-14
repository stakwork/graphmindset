import type { GraphEdge, GraphNode } from "@/lib/graph-api"
import { schemaTypeComparator } from "@/lib/node-schema-utils"
import type { SchemaEdge, SchemaNode } from "@/lib/schema-types"

// Turns the ontology (schema types + schema edges) into the node/edge shape the
// main graph's 2D canvas draws, so /admin/ontology can reuse Neo4jCanvas.

export const HIERARCHY_EDGE_TYPE = "CHILD_OF"

export interface OntologyGraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** The selected type, laid out at the center of its focus graph. */
  rootRefId?: string
  /**
   * Colour group per type ref_id: the top-level branch it belongs to (the type
   * directly under the root, e.g. "Legal"), or null. Roots and top-level types
   * without subtypes draw neutral, so only real branches get a colour.
   */
  groups: Map<string, string | null>
  /** Changes whenever the drawn graph does; the canvas rebuilds its layout on it. */
  layoutKey: string
}

interface Focus {
  members: Set<string>
  edges: GraphEdge[]
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

function toGraphNode(schema: SchemaNode, relationships: number): GraphNode {
  const summary = [
    schema.parent ? `extends ${schema.parent}` : "root type",
    plural(schema.attributes.length, "attribute"),
    plural(relationships, "relationship"),
  ].join(" · ")
  const titleKey = schema.title_key ?? schema.index
  return {
    ref_id: schema.ref_id,
    node_type: schema.type,
    // The canvas captions a node via its schema's title key (falling back to
    // `name`); the hover card shows `description` as the snippet.
    properties: { description: summary, name: schema.type, ...(titleKey ? { [titleKey]: schema.type } : {}) },
  }
}

// child ref_id → parent ref_id along CHILD_OF (first parent wins).
function parentMap(edges: GraphEdge[]): Map<string, string> {
  const parentOf = new Map<string, string>()
  for (const e of edges) {
    if (e.edge_type === HIERARCHY_EDGE_TYPE && e.source !== e.target && !parentOf.has(e.source)) {
      parentOf.set(e.source, e.target)
    }
  }
  return parentOf
}

// The ancestor directly under a root, or null for a root itself (or a cycle).
function branchHead(refId: string, parentOf: Map<string, string>, roots: Set<string>): string | null {
  const seen = new Set<string>()
  let cur = refId
  while (!roots.has(cur) && !seen.has(cur)) {
    seen.add(cur)
    const parent = parentOf.get(cur)
    if (parent === undefined) return null
    if (roots.has(parent)) return cur
    cur = parent
  }
  return null
}

function branchGroups(
  schemas: SchemaNode[],
  parentOf: Map<string, string>,
  roots: Set<string>
): Map<string, string | null> {
  const typeOf = new Map(schemas.map((s) => [s.ref_id, s.type]))
  const hasSubtypes = new Set(parentOf.values())
  const groups = new Map<string, string | null>()
  for (const s of schemas) {
    const head = branchHead(s.ref_id, parentOf, roots)
    groups.set(s.ref_id, head && hasSubtypes.has(head) ? typeOf.get(head) ?? null : null)
  }
  return groups
}

// The selected type plus its direct neighbors: parent, children, related types.
function focusOnType(edges: GraphEdge[], refId: string): Focus {
  const members = new Set([refId])
  for (const e of edges) {
    if (e.source === refId) members.add(e.target)
    if (e.target === refId) members.add(e.source)
  }
  return { members, edges: edges.filter((e) => members.has(e.source) && members.has(e.target)) }
}

// Only the relationships of one edge type and the types they connect.
function focusOnEdgeType(edges: GraphEdge[], edgeType: string): Focus | null {
  const ofType = edges.filter((e) => e.edge_type === edgeType)
  if (ofType.length === 0) return null
  return { members: new Set(ofType.flatMap((e) => [e.source, e.target])), edges: ofType }
}

/**
 * The whole ontology by default. A selected type narrows it to that type and
 * its direct neighbors, centered on it; a selected edge type narrows it to the
 * relationships of that type (falling back to everything when there are none).
 */
export function ontologyGraphData(
  schemas: SchemaNode[],
  schemaEdges: SchemaEdge[],
  selectedId: string | null,
  selectedEdgeType: string | null
): OntologyGraphData {
  const known = new Set(schemas.map((s) => s.ref_id))
  const edges: GraphEdge[] = schemaEdges
    .filter((e) => known.has(e.source) && known.has(e.target))
    .map((e) => ({ source: e.source, target: e.target, edge_type: e.edge_type, ref_id: e.ref_id }))

  // No CHILD_OF edges in the payload (older backends, some fixtures): derive
  // the hierarchy from each type's `parent` field instead.
  if (!edges.some((e) => e.edge_type === HIERARCHY_EDGE_TYPE)) {
    const byType = new Map(schemas.map((s) => [s.type, s]))
    for (const s of schemas) {
      const parent = byType.get(s.parent)
      if (parent && parent !== s) {
        edges.push({ source: s.ref_id, target: parent.ref_id, edge_type: HIERARCHY_EDGE_TYPE })
      }
    }
  }

  const relationships = new Map<string, number>()
  for (const e of edges) {
    if (e.edge_type === HIERARCHY_EDGE_TYPE) continue
    relationships.set(e.source, (relationships.get(e.source) ?? 0) + 1)
    if (e.target !== e.source) relationships.set(e.target, (relationships.get(e.target) ?? 0) + 1)
  }

  const parentOf = parentMap(edges)
  const roots = new Set(schemas.filter((s) => !parentOf.has(s.ref_id)).map((s) => s.ref_id))
  const groups = branchGroups(schemas, parentOf, roots)

  const rootRefId = selectedId && known.has(selectedId) ? selectedId : undefined
  const focus = rootRefId
    ? focusOnType(edges, rootRefId)
    : selectedEdgeType
      ? focusOnEdgeType(edges, selectedEdgeType)
      : null

  // Full view: every top-level type extends the root, so drawing (and
  // simulating) those spokes collapses the whole ontology onto it. The hover
  // card still says "extends Thing", and selecting the root shows them.
  const drawnEdges =
    focus?.edges ?? edges.filter((e) => !(e.edge_type === HIERARCHY_EDGE_TYPE && roots.has(e.target)))

  // Ranked order (height, then centrality, then name): the canvas seeds and
  // captions nodes in input order, so the most central types take the middle
  // and win caption collisions.
  const byRank = schemaTypeComparator(schemas)
  const nodes = schemas
    .filter((s) => !focus || focus.members.has(s.ref_id))
    .sort((a, b) => byRank(a.type, b.type))
    .map((s) => toGraphNode(s, relationships.get(s.ref_id) ?? 0))

  const layoutKey = [
    rootRefId ?? "",
    ...nodes.map((n) => `${n.ref_id}:${n.node_type}:${n.properties.description}`),
    ...drawnEdges.map((e) => `${e.source}>${e.target}:${e.edge_type}`),
  ].join("|")

  return { nodes, edges: drawnEdges, rootRefId, groups, layoutKey }
}
