// Pure model for the ontology page's Outline view: the filtered schema list
// grouped by domain and arranged as a `parent` tree, plus the search and
// relationship helpers the view needs. Built once per filtered payload
// (useMemo in the component), never per row, so it stays cheap at 300+ types.

import type { SchemaNode, SchemaEdge } from "./schema-types"
import { domainKeyOf, listSchemaDomains, ROOT_TYPE } from "./schema-domains"

export interface OutlineNode {
  refId: string
  type: string
  nodeKey: string
  parent: string
  domainKey: string
  /** 0 for a root of its domain section. */
  depth: number
  children: OutlineNode[]
  /** Number of direct child types. */
  directCount: number
  /** Number of descendant types at any depth. */
  totalCount: number
}

export interface OutlineDomain {
  key: string
  label: string
  /** Number of types in the section (all depths). */
  count: number
  roots: OutlineNode[]
}

export interface OutlineModel {
  domains: OutlineDomain[]
  byRef: Map<string, OutlineNode>
  /** Type name → schema, for the filtered set (root type included). */
  byType: Map<string, SchemaNode>
  /** Child ref_id → parent ref_id, for every non-root outline node. */
  parentRef: Map<string, string>
}

const byName = (a: OutlineNode, b: OutlineNode) => a.type.localeCompare(b.type)

/**
 * Group `schemas` by domain and nest each domain's types by `parent`. A type
 * whose parent is the root type, missing, or outside `schemas` (filtered out)
 * becomes a root of its domain section. Siblings are sorted by name; the root
 * type itself is never listed. A parent in a different domain still nests its
 * children under it (the child is placed in the parent's section), so a
 * cross-domain subtype is not shown as a spurious root.
 */
export function buildOutlineModel(schemas: SchemaNode[]): OutlineModel {
  const byType = new Map<string, SchemaNode>()
  for (const s of schemas) if (s.type) byType.set(s.type, s)

  const byRef = new Map<string, OutlineNode>()
  for (const s of schemas) {
    if (!s.type || s.type === ROOT_TYPE) continue
    byRef.set(s.ref_id, {
      refId: s.ref_id,
      type: s.type,
      nodeKey: s.node_key ?? "",
      parent: s.parent ?? "",
      domainKey: domainKeyOf(s),
      depth: 0,
      children: [],
      directCount: 0,
      totalCount: 0,
    })
  }

  const parentRef = new Map<string, string>()
  const rootsByDomain = new Map<string, OutlineNode[]>()
  for (const node of byRef.values()) {
    const parentSchema = node.parent && node.parent !== ROOT_TYPE ? byType.get(node.parent) : undefined
    const parentNode = parentSchema ? byRef.get(parentSchema.ref_id) : undefined
    if (parentNode && parentNode !== node) {
      parentNode.children.push(node)
      parentRef.set(node.refId, parentNode.refId)
    } else {
      const list = rootsByDomain.get(node.domainKey) ?? []
      list.push(node)
      rootsByDomain.set(node.domainKey, list)
    }
  }

  // Depth-first pass from the roots: sort siblings, assign depth, count
  // descendants. A node reachable only through a `parent` cycle is never
  // visited here and is re-attached as a root below so nothing disappears.
  const visited = new Set<string>()
  const walk = (node: OutlineNode, depth: number): number => {
    visited.add(node.refId)
    node.depth = depth
    node.children = node.children.filter((c) => !visited.has(c.refId))
    node.children.sort(byName)
    node.directCount = node.children.length
    let total = 0
    for (const c of node.children) total += 1 + walk(c, depth + 1)
    node.totalCount = total
    return total
  }
  for (const list of rootsByDomain.values()) for (const r of list) walk(r, 0)
  for (const node of byRef.values()) {
    if (visited.has(node.refId)) continue
    parentRef.delete(node.refId)
    const list = rootsByDomain.get(node.domainKey) ?? []
    list.push(node)
    rootsByDomain.set(node.domainKey, list)
    walk(node, 0)
  }

  const labels = new Map(listSchemaDomains(schemas).map((d) => [d.key, d.label]))
  const domains: OutlineDomain[] = Array.from(rootsByDomain.entries())
    .map(([key, roots]) => {
      roots.sort(byName)
      const count = roots.reduce((n, r) => n + 1 + r.totalCount, 0)
      return { key, label: labels.get(key) ?? key, count, roots }
    })
    .sort((a, b) => a.label.localeCompare(b.label))

  return { domains, byRef, byType, parentRef }
}

/** Ref_ids of a node's ancestors within the outline, nearest first. */
export function outlineAncestors(model: OutlineModel, refId: string): string[] {
  const out: string[] = []
  let cur = model.parentRef.get(refId)
  while (cur && !out.includes(cur)) {
    out.push(cur)
    cur = model.parentRef.get(cur)
  }
  return out
}

/**
 * The default expansion: roots and their direct children open, deeper levels
 * collapsed. Only nodes with children are listed (a leaf has nothing to open).
 */
export function defaultExpandedRefs(model: OutlineModel): Set<string> {
  const out = new Set<string>()
  for (const d of model.domains) {
    for (const r of d.roots) {
      if (r.directCount === 0) continue
      out.add(r.refId)
      for (const c of r.children) if (c.directCount > 0) out.add(c.refId)
    }
  }
  return out
}

/** Every ref_id that has children (for "Expand all"). */
export function allExpandableRefs(model: OutlineModel): Set<string> {
  const out = new Set<string>()
  for (const n of model.byRef.values()) if (n.directCount > 0) out.add(n.refId)
  return out
}

export interface OutlineSearch {
  /** Lowercased, trimmed query; empty when nothing is being searched. */
  query: string
  /** Nodes whose type name or node_key contains the query. */
  matched: Set<string>
  /** Matches plus every ancestor of a match (what the tree should show). */
  visible: Set<string>
  /** Ancestors of matches: the nodes that must be open to reveal them. */
  expanded: Set<string>
}

/**
 * Case-insensitive substring search over type name and node_key. Ancestors of
 * a match are kept visible and marked for auto-expansion so the match is on
 * screen. An empty query yields empty sets (callers treat that as "show all").
 */
export function searchOutline(model: OutlineModel, rawQuery: string): OutlineSearch {
  const query = rawQuery.trim().toLowerCase()
  const matched = new Set<string>()
  const visible = new Set<string>()
  const expanded = new Set<string>()
  if (!query) return { query, matched, visible, expanded }
  for (const n of model.byRef.values()) {
    if (n.type.toLowerCase().includes(query) || n.nodeKey.toLowerCase().includes(query)) {
      matched.add(n.refId)
      visible.add(n.refId)
      for (const a of outlineAncestors(model, n.refId)) {
        visible.add(a)
        expanded.add(a)
      }
    }
  }
  return { query, matched, visible, expanded }
}

export interface TypeRelationship {
  edge: SchemaEdge
  /** The ancestor type the edge is declared on, or null when declared on the type itself. */
  inheritedFrom: string | null
}

/**
 * Relationship schemas that apply to `typeName`, including inherited ones:
 * every non-CHILD_OF edge whose source or target type is the type or one of
 * its `parent` ancestors (walked over the same filtered schema set the
 * outline shows). Sorted by edge_type, then own before inherited, then by
 * the endpoints so the order is stable.
 */
export function relationshipsForType(
  typeName: string,
  byType: ReadonlyMap<string, SchemaNode>,
  edges: SchemaEdge[]
): TypeRelationship[] {
  // Ancestor chain, nearest first; guards against a `parent` cycle.
  const chain: string[] = []
  let cur: string | undefined = typeName
  while (cur && !chain.includes(cur)) {
    chain.push(cur)
    cur = byType.get(cur)?.parent || undefined
  }
  const rank = new Map(chain.map((t, i) => [t, i]))

  const out: TypeRelationship[] = []
  for (const e of edges) {
    if (!e.edge_type || e.edge_type === "CHILD_OF") continue
    const src = e.source_type ?? ""
    const tgt = e.target_type ?? ""
    const srcRank = rank.get(src)
    const tgtRank = rank.get(tgt)
    if (srcRank === undefined && tgtRank === undefined) continue
    // Declared on the type itself if either end is the type; otherwise on the
    // nearest ancestor that appears on the edge.
    const nearest = Math.min(srcRank ?? Infinity, tgtRank ?? Infinity)
    out.push({ edge: e, inheritedFrom: nearest === 0 ? null : chain[nearest] })
  }
  out.sort(
    (a, b) =>
      a.edge.edge_type.localeCompare(b.edge.edge_type) ||
      Number(a.inheritedFrom !== null) - Number(b.inheritedFrom !== null) ||
      (a.edge.source_type ?? "").localeCompare(b.edge.source_type ?? "") ||
      (a.edge.target_type ?? "").localeCompare(b.edge.target_type ?? "")
  )
  return out
}
