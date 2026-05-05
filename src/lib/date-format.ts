import { formatDistanceToNow } from "date-fns"

/**
 * Normalises any backend timestamp shape into a `Date`.
 *
 * Accepts:
 *   - `number` (int or float) — uses `n < 1e11` heuristic to distinguish
 *     epoch-seconds from epoch-milliseconds.
 *   - Numeric `string` (e.g. `"1730476800"` or `"1730476800.123"`)
 *   - ISO 8601 string
 *   - `Date` object
 *
 * Returns `null` for `null`, `undefined`, empty string, `NaN`, or any
 * value that cannot be parsed into a valid date.
 */
export function parseTimestamp(value: unknown): Date | null {
  if (value == null) return null

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    const d = new Date(value < 1e11 ? value * 1000 : value)
    return Number.isNaN(d.getTime()) ? null : d
  }

  if (typeof value === "string") {
    if (value.length === 0) return null
    // Numeric string (integer or float epoch)
    if (/^\d+(\.\d+)?$/.test(value)) {
      const n = parseFloat(value)
      const d = new Date(n < 1e11 ? n * 1000 : n)
      return Number.isNaN(d.getTime()) ? null : d
    }
    // ISO 8601 or any other date string
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }

  return null
}

/**
 * Returns an uppercase absolute date string like `"30 APR 2026"`,
 * or `null` if the value cannot be parsed.
 */
export function formatDateAbsolute(value: unknown): string | null {
  const d = parseTimestamp(value)
  if (!d) return null
  return d
    .toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
    .toUpperCase()
}

/**
 * Returns a relative time string like `"2 days ago"` (via `date-fns`
 * `formatDistanceToNow`), or `fallback` if the value cannot be parsed.
 */
export function formatDateRelative(value: unknown, fallback = ""): string {
  const d = parseTimestamp(value)
  if (!d) return fallback
  return formatDistanceToNow(d, { addSuffix: true })
}
