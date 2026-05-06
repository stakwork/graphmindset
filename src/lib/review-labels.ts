// Extend these maps when adding new review types or actions.

export const REVIEW_TYPE_LABELS: Record<string, { label: string; accent: string }> = {
  dedup: { label: "Dedupe", accent: "primary" },
  supersede: { label: "Supersede", accent: "amber" },
}

export const REVIEW_ACTION_LABELS: Record<string, { verb: string }> = {
  merge_nodes: { verb: "Merge" },
  supersede: { verb: "Supersede" },
}

export function humanizeEnum(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}
