export type StatusBadge = { label: string; className: string }

const IN_PROGRESS_STATUSES = new Set(["processing", "in_progress", "running", "new", "enqueued"])
const HALTED_STATUSES = new Set(["halted", "paused", "stopped", "stopping"])
const ERROR_STATUSES = new Set(["error", "failed", "stuck"])
const COMPLETED_STATUSES = new Set(["completed", "success", "finished"])

export function isBlockedStatus(status: unknown): boolean {
  if (typeof status !== "string") return false
  return IN_PROGRESS_STATUSES.has(status) || HALTED_STATUSES.has(status) || ERROR_STATUSES.has(status)
}

export function isInProgress(status: unknown): boolean {
  return typeof status === "string" && IN_PROGRESS_STATUSES.has(status)
}

export function getStatusBadge(status: unknown): StatusBadge | null {
  if (typeof status !== "string") return null
  if (isInProgress(status)) return { label: "Processing", className: "bg-amber-500/15 text-amber-400" }
  if (HALTED_STATUSES.has(status)) return { label: "Paused", className: "bg-muted text-muted-foreground" }
  if (ERROR_STATUSES.has(status)) return { label: "Failed", className: "bg-destructive/15 text-destructive" }
  if (COMPLETED_STATUSES.has(status)) return null
  return null
}
