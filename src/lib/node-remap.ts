import type { SchemaAttribute } from "@/lib/schema-types"

// ---------------------------------------------------------------------------
// Jaro-Winkler string similarity — no external dependency
// Returns a value in [0, 1] where 1.0 = identical.
// ---------------------------------------------------------------------------
function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1.0
  if (a.length === 0 || b.length === 0) return 0.0

  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1

  const aMatches = new Array<boolean>(a.length).fill(false)
  const bMatches = new Array<boolean>(b.length).fill(false)

  let matches = 0
  let transpositions = 0

  // Find matching characters within match distance
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance)
    const end = Math.min(i + matchDistance + 1, b.length)
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue
      aMatches[i] = true
      bMatches[j] = true
      matches++
      break
    }
  }

  if (matches === 0) return 0.0

  // Count transpositions
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue
    while (!bMatches[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }

  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3

  // Winkler prefix boost (up to 4 common prefix chars, scale factor 0.1)
  let prefix = 0
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++
    else break
  }

  return jaro + prefix * 0.1 * (1 - jaro)
}

// Token-based overlap score for snake_case attribute names.
// Returns > 0 when the shorter key's tokens are a contiguous prefix or suffix
// of the longer key's tokens. This lets "title" match "episode_title" and
// "name" match "full_name" even when pure Jaro-Winkler undershoots because
// the matching characters appear far apart positionally.
function tokenOverlapScore(a: string, b: string): number {
  const aToks = a.split("_").filter(Boolean)
  const bToks = b.split("_").filter(Boolean)
  if (aToks.length === 0 || bToks.length === 0) return 0

  const [shorter, longer] =
    aToks.length <= bToks.length ? [aToks, bToks] : [bToks, aToks]
  const n = shorter.length

  // Check suffix match: shorter equals the last n tokens of longer
  const suffix = longer.slice(longer.length - n)
  if (shorter.every((t, i) => t === suffix[i])) {
    // Scale: single shared tail token in a 2-token name → 0.75
    return 0.5 + 0.5 * (n / longer.length)
  }

  // Check prefix match: shorter equals the first n tokens of longer
  const pfx = longer.slice(0, n)
  if (shorter.every((t, i) => t === pfx[i])) {
    return 0.5 + 0.5 * (n / longer.length)
  }

  return 0
}

// Combined similarity: max of Jaro-Winkler and token-overlap.
// This ensures both character-level similarity (Jaro-Winkler) and
// structural snake_case similarity (token-overlap) are captured.
export function fuzzyScore(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0.0
  if (a === b) return 1.0
  return Math.max(jaroWinkler(a, b), tokenOverlapScore(a, b))
}

// ---------------------------------------------------------------------------
// Mapping result types
// ---------------------------------------------------------------------------
export interface ExactMapping {
  oldKey: string
  newKey: string
  value: unknown
}

export interface FuzzyMapping {
  oldKey: string
  newKey: string
  score: number
  value: unknown
}

export interface UnmappedField {
  oldKey: string
  value: unknown
}

export interface ComputedMappings {
  exact: ExactMapping[]
  fuzzy: FuzzyMapping[]
  unmapped: UnmappedField[]
}

// ---------------------------------------------------------------------------
// computeMappings
//
// Assigns each old field to exactly one bucket:
//   exact   — oldKey === newKey (auto-confirmed)
//   fuzzy   — best newKey match score >= 0.6 (surfaced for admin confirmation)
//   unmapped — all scores < 0.6 (admin manually assigns or drops)
//
// A new-type field can only appear in one bucket — greedy by score (highest
// score wins across all competing old fields).
// ---------------------------------------------------------------------------
export function computeMappings(
  oldFields: SchemaAttribute[],
  newFields: SchemaAttribute[],
  currentValues: Record<string, unknown>
): ComputedMappings {
  // Build a set of new-field keys for O(1) lookup
  const newKeySet = new Set(newFields.map((f) => f.key))

  // Step 1: Pull out exact matches first — they always win
  const claimedNewKeys = new Set<string>()
  const exact: ExactMapping[] = []
  const remainingOld: SchemaAttribute[] = []

  for (const oldField of oldFields) {
    if (newKeySet.has(oldField.key)) {
      exact.push({ oldKey: oldField.key, newKey: oldField.key, value: currentValues[oldField.key] })
      claimedNewKeys.add(oldField.key)
    } else {
      remainingOld.push(oldField)
    }
  }

  // Step 2: For remaining old fields, compute best fuzzy match among unclaimed new fields
  // Collect all (oldKey, newKey, score) candidates and sort by score desc
  // so that greedy assignment gives highest-scoring pairs priority.
  type Candidate = { oldKey: string; newKey: string; score: number; value: unknown }
  const candidates: Candidate[] = []

  for (const oldField of remainingOld) {
    for (const newField of newFields) {
      if (claimedNewKeys.has(newField.key)) continue
      const score = fuzzyScore(oldField.key, newField.key)
      if (score >= 0.6) {
        candidates.push({ oldKey: oldField.key, newKey: newField.key, score, value: currentValues[oldField.key] })
      }
    }
  }

  // Sort descending by score so greedy assignment starts with best matches
  candidates.sort((a, b) => b.score - a.score)

  const fuzzy: FuzzyMapping[] = []
  const assignedOldKeys = new Set<string>()

  for (const c of candidates) {
    // Skip if either side already assigned
    if (assignedOldKeys.has(c.oldKey) || claimedNewKeys.has(c.newKey)) continue
    fuzzy.push({ oldKey: c.oldKey, newKey: c.newKey, score: c.score, value: c.value })
    assignedOldKeys.add(c.oldKey)
    claimedNewKeys.add(c.newKey)
  }

  // Step 3: Everything else is unmapped
  const unmapped: UnmappedField[] = remainingOld
    .filter((f) => !assignedOldKeys.has(f.key))
    .map((f) => ({ oldKey: f.key, value: currentValues[f.key] }))

  return { exact, fuzzy, unmapped }
}
