import type { SchemaNode, SchemaAttribute } from "@/app/ontology/page"

// Backend book-keeping attributes that are never user-facing.
// owner_reference_id is set from the LSAT, weight/is_muted are
// graph-internal moderation knobs, unique_source_id is for dedup of
// ingested content (Stakwork). date_added_to_graph is auto-set.
export const SYSTEM_ATTRIBUTES = new Set([
  "weight",
  "is_muted",
  "unique_source_id",
  "owner_reference_id",
  "date_added_to_graph",
])

// Merge own + inherited attributes into one form-field list, with own
// attributes first. Duplicate keys are deduped (own wins). System-level
// inherited attrs are filtered out — they're backend-managed, not user input.
export function fieldsForSchema(schema: SchemaNode): SchemaAttribute[] {
  const seen = new Set<string>()
  const out: SchemaAttribute[] = []
  for (const a of schema.attributes) {
    if (seen.has(a.key) || SYSTEM_ATTRIBUTES.has(a.key)) continue
    seen.add(a.key)
    out.push(a)
  }
  for (const a of schema.inherited_attributes ?? []) {
    if (seen.has(a.key) || SYSTEM_ATTRIBUTES.has(a.key)) continue
    seen.add(a.key)
    out.push(a)
  }
  return out
}
