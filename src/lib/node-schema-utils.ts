import type { SchemaNode, SchemaAttribute } from "@/lib/schema-types"

// Backend book-keeping attributes that are never user-facing.
// owner_reference_id is set from the LSAT, weight/is_muted are
// graph-internal moderation knobs, unique_source_id is for dedup of
// ingested content (Stakwork). date_added_to_graph is auto-set.
// project_id is the graph association and pub_key/pubkey are provenance —
// both set by the backend, not typed by hand.
export const SYSTEM_ATTRIBUTES = new Set([
  "weight",
  "is_muted",
  "unique_source_id",
  "owner_reference_id",
  "date_added_to_graph",
  "project_id",
  "pub_key",
  "pubkey",
])

// A field is hidden from every node form when it's a system/book-keeping
// attribute OR a computed "Signals & scoring" value (boost, sentiment_score,
// confidence, reliability, …). None of these are hand-entered — they're
// backend-managed, so we never render or submit them.
function isHiddenAttribute(a: SchemaAttribute): boolean {
  return SYSTEM_ATTRIBUTES.has(a.key) || categorizeField(a.key, a.type) === "signal"
}

// Merge own + inherited attributes into one form-field list, with own
// attributes first. Duplicate keys are deduped (own wins). System-level and
// computed-signal attrs are filtered out — they're backend-managed, not input.
export function fieldsForSchema(schema: SchemaNode): SchemaAttribute[] {
  const seen = new Set<string>()
  const out: SchemaAttribute[] = []
  for (const a of schema.attributes) {
    if (seen.has(a.key) || isHiddenAttribute(a)) continue
    seen.add(a.key)
    out.push(a)
  }
  for (const a of schema.inherited_attributes ?? []) {
    if (seen.has(a.key) || isHiddenAttribute(a)) continue
    seen.add(a.key)
    out.push(a)
  }
  return out
}

// Optional attributes are bucketed into these groups so the node form can
// collapse them into labelled sections (Content / Metadata / Signals) instead
// of a flat dump. Required ("core") fields are rendered separately, up front.
export type FieldGroup = "content" | "meta" | "signal"

export const OPTIONAL_GROUP_ORDER: FieldGroup[] = ["content", "meta", "signal"]

export const OPTIONAL_GROUP_LABELS: Record<FieldGroup, string> = {
  content: "Content",
  meta: "Metadata",
  signal: "Signals & scoring",
}

// Mono type hint shown on the right of each field label.
export function fieldTypeHint(type: string): string {
  const t = type.toLowerCase()
  if (t === "integer") return "int"
  if (t === "number") return "float"
  if (t === "datetime" || t === "date") return "datetime"
  if (t === "boolean") return "bool"
  return t || "string"
}

// Scoring / signal attributes — numeric weights and model outputs.
const SIGNAL_TOKENS = [
  "boost", "sentiment", "confidence", "reliab", "influence",
  "significan", "prevalence", "score", "rating", "weight", "rank",
]
// Bookkeeping / provenance attributes.
const META_TOKENS = [
  "language", "lang", "country", "region", "date", "time", "year",
  "created", "updated", "first_seen", "duration", "follower", "likes",
  "repost", "alias", "keyword", "pub_key", "pubkey", "count", "_id",
]

// Bucket an optional attribute into a display group from its key (and type as a
// tiebreaker). Heuristic — the backend schema has no group metadata, so we
// infer it; anything unclassified falls into Content (the default catch-all).
export function categorizeField(key: string, type?: string): FieldGroup {
  const k = key.toLowerCase()
  if (SIGNAL_TOKENS.some((t) => k.includes(t))) return "signal"
  if (META_TOKENS.some((t) => k.includes(t))) return "meta"
  // Untagged numeric values read as signals more often than content.
  const t = (type ?? "").toLowerCase()
  if (t === "float" || t === "number") return "signal"
  return "content"
}

// Turn a raw attribute key into a human-readable label for form display.
// Splits on underscores and camelCase boundaries, then Title-cases:
//   "source_link"  → "Source link"
//   "dateAddedToGraph" → "Date added to graph"
// The raw key is still shown alongside as a muted hint, so this only has to
// be readable, not reversible.
export function humanizeFieldKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\s]+/)
    .filter(Boolean)
  if (words.length === 0) return key
  const [first, ...rest] = words
  return [
    first.charAt(0).toUpperCase() + first.slice(1).toLowerCase(),
    ...rest.map((w) => w.toLowerCase()),
  ].join(" ")
}
