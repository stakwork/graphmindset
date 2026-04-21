export const DISPLAY_KEY_FALLBACKS = ["name", "title", "label", "text", "content", "body"] as const

export function pickString(
  props: Record<string, unknown> | undefined,
  key: string | undefined
): string | undefined {
  if (!props || !key) return undefined
  const v = props[key]
  return typeof v === "string" && v.length > 0 ? v : undefined
}

export type StatusBadge = { label: string; className: string }

export function getStatusBadge(status: unknown): StatusBadge | null {
  if (typeof status !== "string") return null
  if (status === "processing" || status === "in_progress")
    return { label: "Processing", className: "bg-amber-500/15 text-amber-400" }
  if (status === "halted")
    return { label: "Paused", className: "bg-muted text-muted-foreground" }
  if (status === "error" || status === "failed")
    return { label: "Failed", className: "bg-destructive/15 text-destructive" }
  return null
}
