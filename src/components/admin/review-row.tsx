"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { formatDateRelative } from "@/lib/date-format"
import type { Review, ReviewStatus } from "@/lib/graph-api"
import { approveReview, dismissReview } from "@/lib/graph-api"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { NodeRow } from "@/components/layout/node-row"
import type { SchemaNode } from "@/app/ontology/page"
import { REVIEW_TYPE_LABELS, REVIEW_ACTION_LABELS, humanizeEnum } from "@/lib/review-labels"
import { useUserStore } from "@/stores/user-store"

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<ReviewStatus, string> = {
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  dismissed: "bg-muted/60 text-muted-foreground border-border",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        STATUS_STYLES[status]
      )}
    >
      {status}
    </span>
  )
}

// ── Dismiss popover ───────────────────────────────────────────────────────────

function DismissPopover({
  onConfirm,
  loading,
}: {
  onConfirm: (reason: string) => void
  loading: boolean
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 text-xs font-medium text-muted-foreground border border-border hover:bg-muted/50 transition-colors"
      >
        Dismiss
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-popover p-2 shadow-md min-w-[200px]">
      <textarea
        className="w-full rounded border border-input bg-background px-2 py-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder="Optional reason…"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={loading}
          onClick={() => { onConfirm(reason); setOpen(false) }}
          className="rounded px-2 py-0.5 text-xs font-medium bg-destructive/80 text-destructive-foreground hover:bg-destructive transition-colors disabled:opacity-50"
        >
          {loading ? "Dismissing…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Main ReviewRow ────────────────────────────────────────────────────────────

export interface ReviewRowProps {
  review: Review
  schemas: SchemaNode[]
  onRefresh: () => void
  onCountRefresh?: () => void
}

export function ReviewRow({ review, schemas, onRefresh, onCountRefresh }: ReviewRowProps) {
  const router = useRouter()
  const { isAdmin } = useUserStore()
  const [approving, setApproving] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [approveConfirm, setApproveConfirm] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)

  const relativeTime = formatDateRelative(review.created_at, review.created_at ?? "")

  async function handleApprove() {
    if (!isAdmin) return
    if (!approveConfirm) { setApproveConfirm(true); return }
    setApproving(true)
    setInlineError(null)
    try {
      const res = await approveReview(review.ref_id)
      if (res.error_message || res.status === "failed") {
        setInlineError(res.error_message ?? "Approval failed")
      }
      onRefresh()
      onCountRefresh?.()
    } catch {
      setInlineError("Approval request failed")
    } finally {
      setApproving(false)
      setApproveConfirm(false)
    }
  }

  async function handleDismiss(reason: string) {
    if (!isAdmin) return
    setDismissing(true)
    setInlineError(null)
    try {
      await dismissReview(review.ref_id, reason || undefined)
      onRefresh()
      onCountRefresh?.()
    } catch {
      setInlineError("Dismiss request failed")
    } finally {
      setDismissing(false)
    }
  }

  return (
    <tr className="border-b border-border/50 hover:bg-muted/20 transition-colors align-top">
      {/* Type */}
      <td className="py-3 px-3 whitespace-nowrap">
        <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[11px] font-semibold text-primary uppercase tracking-wide">
          {REVIEW_TYPE_LABELS[review.type]?.label ?? humanizeEnum(review.type)}
        </span>
        {review.run_ref_id && (
          <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            Run #{review.run_ref_id.slice(-5)}
          </span>
        )}
      </td>

      {/* Rationale */}
      <td className="py-3 px-3 max-w-[280px]">
        <Tooltip>
          <TooltipTrigger
            render={
              <p className="text-xs text-foreground line-clamp-2 cursor-default">
                {review.rationale}
              </p>
            }
          />
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            {review.rationale}
          </TooltipContent>
        </Tooltip>
        {review.status === "failed" && review.error_message && (
          <p className="mt-1 text-[11px] text-red-400 font-medium">
            ✕ {review.error_message}
          </p>
        )}
        {review.status === "dismissed" && review.dismissal_reason && (
          <p className="mt-1 text-[11px] text-muted-foreground italic">
            Reason: {review.dismissal_reason}
          </p>
        )}
        {inlineError && (
          <p className="mt-1 text-[11px] text-red-400 font-medium">
            ✕ {inlineError}
          </p>
        )}
      </td>

      {/* Subjects */}
      <td className="py-3 px-3">
        <div className="flex flex-col gap-1.5">
          {review.subject_nodes.map((sn) =>
            sn.node_type === null ? (
              <span key={sn.ref_id} className="text-[10px] font-mono text-muted-foreground italic">
                Deleted: {sn.ref_id}
              </span>
            ) : (
              <NodeRow
                key={sn.ref_id}
                node={{ ref_id: sn.ref_id, node_type: sn.node_type, properties: sn.properties ?? {} }}
                schemas={schemas}
                onClick={() => router.push(`/?ref=${sn.ref_id}`)}
                hideBoost
              />
            )
          )}
        </div>
      </td>

      {/* Action */}
      <td className="py-3 px-3 whitespace-nowrap">
        <span className="rounded bg-muted/50 border border-border px-1.5 py-0.5 text-[11px] font-mono text-foreground">
          {REVIEW_ACTION_LABELS[review.action_name]?.verb ?? humanizeEnum(review.action_name)}
        </span>
      </td>

      {/* Priority */}
      <td className="py-3 px-3 text-center text-xs text-muted-foreground">
        {review.priority > 0 ? (
          <span className={cn("font-bold", review.priority >= 4 ? "text-red-400" : review.priority >= 2 ? "text-amber-400" : "text-foreground")}>
            {review.priority}
          </span>
        ) : "—"}
      </td>

      {/* Created */}
      <td className="py-3 px-3 whitespace-nowrap text-xs text-muted-foreground">
        {relativeTime}
      </td>

      {/* Status */}
      <td className="py-3 px-3 whitespace-nowrap">
        <StatusBadge status={review.status} />
      </td>

      {/* Actions */}
      <td className="py-3 px-3 whitespace-nowrap">
        {review.status === "pending" && (
          <div className="flex flex-wrap items-start gap-2">
            {approveConfirm ? (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={approving}
                  onClick={handleApprove}
                  className="rounded px-2 py-0.5 text-xs font-medium bg-emerald-600/80 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
                >
                  {approving ? "Approving…" : "Confirm approve?"}
                </button>
                <button
                  type="button"
                  onClick={() => setApproveConfirm(false)}
                  className="rounded px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleApprove}
                className="rounded px-2 py-1 text-xs font-medium text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/10 transition-colors"
              >
                Approve
              </button>
            )}
            <DismissPopover onConfirm={handleDismiss} loading={dismissing} />
          </div>
        )}
      </td>
    </tr>
  )
}
