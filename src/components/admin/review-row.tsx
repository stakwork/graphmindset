"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, GitMerge } from "lucide-react"
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

// ── Priority badge ────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: number }) {
  if (priority <= 0) return null
  const tone =
    priority >= 4
      ? "bg-red-500/15 text-red-300 border-red-500/30"
      : priority >= 2
        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
        : "bg-muted/40 text-muted-foreground border-border"
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border px-1.5 font-mono text-[10px] font-bold",
        tone
      )}
    >
      P{priority}
    </span>
  )
}

// ── Action payload extraction ─────────────────────────────────────────────────

interface MergeDirection {
  fromIds: string[]
  toId: string
  fromLabel: string
  toLabel: string
}

function extractDirection(action_name: string, action_payload: unknown): MergeDirection | null {
  if (!action_payload || typeof action_payload !== "object") return null
  const p = action_payload as Record<string, unknown>

  if (action_name === "merge_nodes" && Array.isArray(p.from) && typeof p.to === "string") {
    // Jarvis sends `from` as the full participant list (including the survivor).
    // Exclude `to` so we only render the nodes actually being absorbed.
    const fromIds = p.from
      .filter((x): x is string => typeof x === "string")
      .filter((id) => id !== p.to)
    if (fromIds.length === 0) return null
    return {
      fromIds,
      toId: p.to,
      fromLabel: "Merging",
      toLabel: "Into canonical",
    }
  }

  if (action_name === "supersede" && typeof p.old === "string" && typeof p.new === "string") {
    return {
      fromIds: [p.old],
      toId: p.new,
      fromLabel: "Superseding",
      toLabel: "With",
    }
  }

  return null
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
        className="rounded border border-border bg-transparent px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-all hover:border-muted-foreground/40 hover:text-foreground"
      >
        Dismiss
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-popover p-2 shadow-md min-w-[220px]">
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
          onClick={() => {
            onConfirm(reason)
            setOpen(false)
          }}
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

// ── Subject row ───────────────────────────────────────────────────────────────

type SubjectNode = Review["subject_nodes"][number]

function SubjectListItem({
  refId,
  resolved,
  schemas,
  onClick,
}: {
  refId: string
  resolved: SubjectNode | undefined
  schemas: SchemaNode[]
  onClick: () => void
}) {
  if (!resolved || resolved.node_type === null) {
    return (
      <span className="block px-2 py-1 text-[10px] font-mono text-muted-foreground italic">
        Deleted: {refId}
      </span>
    )
  }
  return (
    <NodeRow
      node={{
        ref_id: refId,
        node_type: resolved.node_type,
        properties: resolved.properties ?? {},
      }}
      schemas={schemas}
      onClick={onClick}
      hideBoost
    />
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

  const direction = useMemo(
    () => extractDirection(review.action_name, review.action_payload),
    [review.action_name, review.action_payload]
  )

  const subjectMap = useMemo(() => {
    const map = new Map<string, SubjectNode>()
    for (const sn of review.subject_nodes) map.set(sn.ref_id, sn)
    return map
  }, [review.subject_nodes])

  async function handleApprove() {
    if (!isAdmin) return
    if (!approveConfirm) {
      setApproveConfirm(true)
      return
    }
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

  const typeLabel = REVIEW_TYPE_LABELS[review.type]?.label ?? humanizeEnum(review.type)
  const actionVerb = REVIEW_ACTION_LABELS[review.action_name]?.verb ?? humanizeEnum(review.action_name)

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card/40 transition-colors hover:border-border">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <GitMerge className="h-3.5 w-3.5 text-primary" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-primary">
            {typeLabel} · {actionVerb}
          </span>
          {review.run_ref_id && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                Run #{review.run_ref_id.slice(-5)}
              </span>
            </>
          )}
          <PriorityBadge priority={review.priority} />
          <span className="text-[11px] text-muted-foreground">{relativeTime}</span>
          <StatusBadge status={review.status} />
        </div>

        <div className="flex items-center gap-1.5">
          {review.status === "pending" && isAdmin && (
            <>
              {approveConfirm ? (
                <>
                  <button
                    type="button"
                    disabled={approving}
                    onClick={handleApprove}
                    className="rounded px-2.5 py-1 text-[11px] font-medium bg-emerald-600/80 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
                  >
                    {approving ? "Approving…" : "Confirm approve?"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setApproveConfirm(false)}
                    className="rounded px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleApprove}
                  className="rounded border border-emerald-500/40 bg-emerald-500/5 px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition-all hover:border-emerald-500/70 hover:bg-emerald-500/15"
                >
                  Approve
                </button>
              )}
              <DismissPopover onConfirm={handleDismiss} loading={dismissing} />
            </>
          )}
        </div>
      </div>

      {/* Body */}
      {direction ? (
        <div className="grid grid-cols-[1fr_auto_1fr]">
          <div>
            <div className="px-4 pb-1 pt-3">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {direction.fromLabel}{" "}
                <span className="text-foreground">{direction.fromIds.length}</span>{" "}
                source{direction.fromIds.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex flex-col gap-px px-2 pb-3">
              {direction.fromIds.map((id) => (
                <SubjectListItem
                  key={id}
                  refId={id}
                  resolved={subjectMap.get(id)}
                  schemas={schemas}
                  onClick={() => router.push(`/?ref=${id}`)}
                />
              ))}
            </div>
          </div>

          <div className="relative flex w-12 items-center justify-center">
            <div className="absolute inset-y-3 left-1/2 w-px -translate-x-1/2 bg-border" />
            <div className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background">
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            </div>
          </div>

          <div>
            <div className="px-4 pb-1 pt-3">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {direction.toLabel}
              </span>
            </div>
            <div className="px-2 pb-3">
              <SubjectListItem
                refId={direction.toId}
                resolved={subjectMap.get(direction.toId)}
                schemas={schemas}
                onClick={() => router.push(`/?ref=${direction.toId}`)}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="px-4 py-3">
          <div className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Subjects ({review.subject_nodes.length})
          </div>
          <div className="flex flex-col gap-px px-0">
            {review.subject_nodes.map((sn) => (
              <SubjectListItem
                key={sn.ref_id}
                refId={sn.ref_id}
                resolved={sn}
                schemas={schemas}
                onClick={() => router.push(`/?ref=${sn.ref_id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-border/60 bg-background/40 px-4 py-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <p className="text-[11px] leading-relaxed text-muted-foreground/80 line-clamp-2 cursor-default">
                {review.rationale}
              </p>
            }
          />
          <TooltipContent side="bottom" className="max-w-md text-xs">
            {review.rationale}
          </TooltipContent>
        </Tooltip>

        {review.status === "failed" && review.error_message && (
          <p className="mt-1.5 text-[11px] text-red-400 font-medium">
            ✕ {review.error_message}
          </p>
        )}
        {review.status === "dismissed" && review.dismissal_reason && (
          <p className="mt-1.5 text-[11px] text-muted-foreground italic">
            Reason: {review.dismissal_reason}
          </p>
        )}
        {inlineError && (
          <p className="mt-1.5 text-[11px] text-red-400 font-medium">
            ✕ {inlineError}
          </p>
        )}
      </div>
    </div>
  )
}
