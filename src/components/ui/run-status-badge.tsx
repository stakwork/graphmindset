import { type StakworkRun } from "@/lib/graph-api"

const STATUS_COLOURS: Record<StakworkRun["status"], string> = {
  completed: "bg-green-500/15 text-green-400",
  error: "bg-destructive/15 text-destructive",
  in_progress: "bg-blue-500/15 text-blue-400",
  pending: "bg-yellow-500/15 text-yellow-400",
  halted: "bg-orange-500/15 text-orange-400",
  PENDING: "bg-yellow-500/15 text-yellow-400",
  RUNNING: "bg-blue-500/15 text-blue-400",
  COMPLETED: "bg-green-500/15 text-green-400",
  FAILED: "bg-destructive/15 text-destructive",
  ERROR: "bg-destructive/15 text-destructive",
  HALTED: "bg-orange-500/15 text-orange-400",
}

export function RunStatusBadge({ status }: { status: StakworkRun["status"] }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLOURS[status]}`}>
      {status}
    </span>
  )
}
