// Agent-facing text rendering of the ontology: the CHILD_OF tree and the
// relationship triples as a compact, deterministic plain-text digest. Meant to
// be pasted into an LLM prompt (or copied from the ontology page), so it
// optimises for tokens and unambiguity over structure. Generated from the live
// schema payload, never from a seed script or a doc, so it cannot drift.

import type { SchemaNode, SchemaEdge } from "./schema-types"
import { domainKeyOf, ROOT_TYPE } from "./schema-domains"

export interface OntologyDigestOptions {
  /** Lowercased domain keys to include. Omit for every domain. */
  domains?: readonly string[]
  /** Print each type's own attributes after its name (default true). */
  attributes?: boolean
}

function attrLine(s: SchemaNode): string {
  const own = (s.attributes ?? []).filter((a) => a.key)
  if (own.length === 0) return ""
  const parts = own.map((a) => (a.required ? a.key : `?${a.key}`))
  return `: ${parts.join(", ")}`
}

function edgeAttrs(e: SchemaEdge): string {
  const entries = Object.entries(e.attributes ?? {})
  if (entries.length === 0) return ""
  return ` {${entries.map(([k, t]) => `${k}: ${t}`).join(", ")}}`
}

/**
 * Render schemas + edges as text. Types are indented by CHILD_OF depth
 * (specific under broader, sorted by name at each level); a type whose parent
 * is outside the selected domains is printed as a root annotated with what it
 * extends. Relationships are listed once per (source, edge, target) triple and
 * apply to subtypes on both ends by inheritance, which the header states so the
 * reader does not expect one line per subtype.
 */
export function ontologyDigest(
  schemas: SchemaNode[],
  edges: SchemaEdge[],
  opts: OntologyDigestOptions = {}
): string {
  const wantDomain = opts.domains ? new Set(opts.domains.map((d) => d.toLowerCase())) : null
  const showAttrs = opts.attributes ?? true

  const included = schemas.filter(
    (s) => s.type && s.type !== ROOT_TYPE && (!wantDomain || wantDomain.has(domainKeyOf(s)))
  )
  const byType = new Map(included.map((s) => [s.type, s]))
  const children = new Map<string, SchemaNode[]>()
  const roots: SchemaNode[] = []
  for (const s of included) {
    if (s.parent && byType.has(s.parent)) {
      const list = children.get(s.parent) ?? []
      list.push(s)
      children.set(s.parent, list)
    } else {
      roots.push(s)
    }
  }
  const byName = (a: SchemaNode, b: SchemaNode) => a.type.localeCompare(b.type)
  roots.sort(byName)
  for (const list of children.values()) list.sort(byName)

  const lines: string[] = []
  const seen = new Set<string>()
  const walk = (s: SchemaNode, depth: number) => {
    if (seen.has(s.type)) return // defensive: a CHILD_OF cycle must not loop
    seen.add(s.type)
    const pad = "  ".repeat(depth)
    const ext = depth === 0 && s.parent && s.parent !== ROOT_TYPE ? ` (extends ${s.parent})` : ""
    const dom = depth === 0 ? ` [${domainKeyOf(s)}]` : ""
    lines.push(`${pad}${s.type}${dom}${ext}${showAttrs ? attrLine(s) : ""}`)
    for (const c of children.get(s.type) ?? []) walk(c, depth + 1)
  }

  const rels = edges
    .filter((e) => e.edge_type && e.edge_type !== "CHILD_OF")
    .filter((e) => {
      const src = e.source_type ?? ""
      const tgt = e.target_type ?? ""
      return byType.has(src) || byType.has(tgt)
    })
    .map((e) => `${e.source_type} ${e.edge_type} ${e.target_type}${edgeAttrs(e)}`)
  const relLines = Array.from(new Set(rels)).sort()

  const domainList = wantDomain
    ? Array.from(wantDomain).sort().join(", ")
    : Array.from(new Set(included.map(domainKeyOf))).sort().join(", ")

  const out: string[] = []
  out.push(
    `# Ontology digest: ${included.length} types, ${relLines.length} relationships (domains: ${domainList || "none"})`
  )
  out.push("")
  out.push(
    "## Types (indent = CHILD_OF, specific under broader; [domain] on roots; own attributes after ':', '?' = optional; inherited attributes are implied by the tree)"
  )
  for (const r of roots) walk(r, 0)
  out.push(...lines)
  out.push("")
  out.push("## Relationships (source EDGE target; each applies to subtypes of both ends by inheritance)")
  for (const l of relLines) out.push(l)
  return out.join("\n") + "\n"
}
