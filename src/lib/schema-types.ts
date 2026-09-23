// Shared schema/ontology types. These describe the nodes and edges of the
// graph's schema (the ontology), and are consumed across stores, components,
// and lib helpers — independent of any particular route.

export interface SchemaAttribute {
  key: string
  type: string
  required: boolean
}

export interface SchemaNode {
  ref_id: string
  type: string
  parent: string
  color: string
  node_key: string
  // The search domain this schema belongs to (lowercased). Domains are derived
  // backend-side from `DISTINCT toLower(s.domain)`; a root type only registers as
  // its own domain when this is set to its name. Omitted → backend defaults to
  // "entity". Set explicitly by the Domains editor; left unset by the ontology editor.
  domain?: string
  attributes: SchemaAttribute[]
  inherited_attributes?: SchemaAttribute[]
  title_key?: string
  index?: string
  description_key?: string
  icon?: string
  secondary_color?: string
  paid_properties?: string[]
  // Ordering signals computed backend-side from the ontology alone (never from
  // instance counts). `height` is the position in the CHILD_OF hierarchy: 0 for
  // a root, 1 + the highest parent otherwise. `centrality` is the number of
  // direct child types + distinct other types linked by a schema edge. Sort by
  // height ascending, then centrality descending. Absent on mock fixtures and
  // on backends that predate them.
  height?: number
  centrality?: number
}

export interface SchemaEdge {
  ref_id: string
  // `source`/`target` are the connected schema NODES' ref_ids (used to lay out
  // the ontology graph), NOT type names. Use `source_type`/`target_type` to
  // match against a node's node_type.
  source: string
  target: string
  edge_type: string
  source_type?: string
  target_type?: string
  // Attribute definitions for this edge type, e.g. { since: "?datetime",
  // role: "string" }. A leading "?" marks the attribute optional. Present on
  // the live /v2/schema payload; absent on some mock fixtures.
  attributes?: Record<string, string>
}
