// Domain grouping for schema (ontology) types, shared by the Domains editor
// and the ontology page's domain filter.

import type { SchemaNode, SchemaEdge } from "./schema-types"

export const DEFAULT_DOMAIN = "entity"

/** The root of the CHILD_OF hierarchy; never filtered out by domain. */
export const ROOT_TYPE = "Thing"

/** The domain a schema type belongs to (lowercased; defaults to "entity"). */
export function domainKeyOf(s: SchemaNode): string {
  return (s.domain || DEFAULT_DOMAIN).toLowerCase()
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

export interface SchemaDomainOption {
  /** Canonical lowercased key. */
  key: string
  /** Display label: the first schema's verbatim `domain`, else the capitalized key. */
  label: string
  /** Number of (non-root) types in the domain. */
  count: number
}

/**
 * Domains to offer in a filter: the union of the authoritative
 * `/v2/schema/domains` list and the domains present on the loaded schemas, so
 * the list is complete in live mode and still sensible when only one side is
 * available (mock mode, API failure). The root type is not counted.
 */
export function listSchemaDomains(
  schemas: SchemaNode[],
  apiDomains: readonly string[] = []
): SchemaDomainOption[] {
  const countByKey = new Map<string, number>()
  const labelByKey = new Map<string, string>()

  for (const s of schemas) {
    if (!s.type || s.type === ROOT_TYPE) continue
    const key = domainKeyOf(s)
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1)
    if (!labelByKey.has(key) && s.domain) labelByKey.set(key, s.domain)
  }

  const keys = new Set<string>(countByKey.keys())
  for (const d of apiDomains) {
    const key = d.trim().toLowerCase()
    if (key) keys.add(key)
  }

  return Array.from(keys)
    .map((key) => ({
      key,
      label: labelByKey.get(key) ?? capitalize(key),
      count: countByKey.get(key) ?? 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Pure filter: drop every type whose domain is disabled (the root type always
 * stays) and every edge with an endpoint in a dropped type — matched both by
 * ref_id (`source`/`target`) and by type name (`source_type`/`target_type`).
 * Returns the input arrays untouched when nothing is disabled so memoized
 * consumers don't re-render.
 */
export function filterSchemasByDomain(
  schemas: SchemaNode[],
  edges: SchemaEdge[],
  disabledDomains: ReadonlySet<string>
): { schemas: SchemaNode[]; edges: SchemaEdge[] } {
  if (disabledDomains.size === 0) return { schemas, edges }

  const removedRefs = new Set<string>()
  const removedTypes = new Set<string>()
  const kept: SchemaNode[] = []
  for (const s of schemas) {
    if (s.type !== ROOT_TYPE && disabledDomains.has(domainKeyOf(s))) {
      removedRefs.add(s.ref_id)
      removedTypes.add(s.type)
    } else {
      kept.push(s)
    }
  }
  if (removedRefs.size === 0) return { schemas, edges }

  const keptEdges = edges.filter(
    (e) =>
      !removedRefs.has(e.source) &&
      !removedRefs.has(e.target) &&
      !(e.source_type && removedTypes.has(e.source_type)) &&
      !(e.target_type && removedTypes.has(e.target_type))
  )
  return { schemas: kept, edges: keptEdges }
}
