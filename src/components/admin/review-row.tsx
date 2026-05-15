"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { ArrowRight, ArrowRightLeft, ChevronRight, GitMerge, Trash2, type LucideIcon } from "lucide-react"
import { formatDateRelative } from "@/lib/date-format"
import type { Review, ReviewStatus } from "@/lib/graph-api"
import { approveReview, dismissReview } from "@/lib/graph-api"
import { cn, displayNodeType } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { NodeRow } from "@/components/layout/node-row"
import { Checkbox } from "@/components/ui/checkbox"
import type { SchemaNode } from "@/app/ontology/page"
import { DISPLAY_KEY_FALLBACKS, pickString } from "@/lib/node-display"
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

// ── Node colour by type (cheap heuristic, schema-agnostic) ────────────────────

const TYPE_DOT: Record<string, string> = {
  Topic: "bg-cyan-400",
  Person: "bg-violet-400",
  Episode: "bg-amber-400",
  Clip: "bg-emerald-400",
  Show: "bg-pink-400",
  Document: "bg-orange-400",
}

// ── Action payload extraction ─────────────────────────────────────────────────

interface MergeDirection {
  fromIds: string[]
  toId: string
}

function extractDirection(action_name: string, action_payload: unknown): MergeDirection | null {
  if (!action_payload || typeof action_payload !== "object") return null
  const p = action_payload as Record<string, unknown>

  if (action_name === "merge_nodes" && Array.isArray(p.from) && typeof p.to === "string") {
    const fromIds = p.from
      .filter((x): x is string => typeof x === "string")
      .filter((id) => id !== p.to)
    if (fromIds.length === 0) return null
    return { fromIds, toId: p.to }
  }

  if (action_name === "supersede" && typeof p.old === "string" && typeof p.new === "string") {
    return { fromIds: [p.old], toId: p.new }
  }

  return null
}

// ── Display name helper (mirrors NodeRow logic) ───────────────────────────────

type SubjectNode = Review["subject_nodes"][number]

function getDisplayName(subject: SubjectNode | undefined, schemas: SchemaNode[]): string | null {
  if (!subject || subject.node_type === null) return null
  const props = subject.properties ?? {}
  const schema = schemas.find((s) => s.type === subject.node_type)
  let name = pickString(props, schema?.title_key) ?? pickString(props, schema?.index)
  if (!name) {
    for (const key of DISPLAY_KEY_FALLBACKS) {
      name = pickString(props, key)
      if (name) break
    }
  }
  return name ?? null
}

// ── Inline chips for the collapsed row ────────────────────────────────────────

function InlineChip({
  refId,
  subject,
  schemas,
  emphasis = false,
}: {
  refId: string
  subject: SubjectNode | undefined
  schemas: SchemaNode[]
  emphasis?: boolean
}) {
  if (!subject || subject.node_type === null) {
    return (
      <span className="inline-flex max-w-[220px] shrink-0 items-center gap-1.5 truncate rounded px-1.5 py-0.5 font-mono text-[11px] italic text-muted-foreground">
        Deleted: {refId}
      </span>
    )
  }
  const name = getDisplayName(subject, schemas) ?? refId
  return (
    <span
      className={cn(
        "inline-flex max-w-[220px] shrink-0 items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-[12px]",
        emphasis ? "font-semibold text-foreground" : "text-muted-foreground/90"
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TYPE_DOT[subject.node_type] ?? "bg-muted-foreground")} />
      <span className="truncate">{name}</span>
    </span>
  )
}

const MAX_INLINE_SOURCES = 3

function SourceChips({
  fromIds,
  subjectMap,
  schemas,
}: {
  fromIds: string[]
  subjectMap: Map<string, SubjectNode>
  schemas: SchemaNode[]
}) {
  const visible = fromIds.slice(0, MAX_INLINE_SOURCES)
  const overflow = fromIds.length - visible.length
  return (
    <>
      {visible.map((id) => (
        <InlineChip key={id} refId={id} subject={subjectMap.get(id)} schemas={schemas} />
      ))}
      {overflow > 0 && (
        <span className="inline-flex shrink-0 items-center rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          +{overflow} more
        </span>
      )}
    </>
  )
}

// ── Action labels (per action_name) ───────────────────────────────────────────
// soft_delete uses "Hide" (not "delete") because the node stays in the system.

interface SubjectSummary {
  count: number
  /** Title from the node's schema title_key when count === 1, else null. */
  displayName: string | null
  /** Type-based fallback: "Tweet", "3 Tweets", "3 items". */
  typeLabel: string
}

function summarizeSubjects(subjects: SubjectNode[], schemas: SchemaNode[]): SubjectSummary {
  const count = subjects.length
  const types = new Set<string>()
  for (const s of subjects) {
    if (s.node_type) types.add(s.node_type)
  }

  const displayName = count === 1 ? getDisplayName(subjects[0], schemas) : null

  if (types.size === 1) {
    const [type] = Array.from(types)
    const label = displayNodeType(type)
    return {
      count,
      displayName,
      typeLabel: count === 1 ? label : `${count} ${label}s`,
    }
  }
  return {
    count,
    displayName,
    typeLabel: count === 1 ? "item" : `${count} items`,
  }
}

interface ActionLabels {
  approve: string
  rowLabel: (subjects: SubjectSummary) => string
  approvePrompt: (subjects: SubjectSummary) => string
}

export function getApproveVerb(actionName: string): string {
  return ACTION_LABELS[actionName]?.approve ?? "Approve"
}

const DEFAULT_ACTION_LABELS: ActionLabels = {
  approve: "Approve",
  rowLabel: (s) => `${s.count} subject${s.count === 1 ? "" : "s"}`,
  approvePrompt: () => "Approve this action?",
}

const ACTION_LABELS: Record<string, ActionLabels> = {
  soft_delete: {
    approve: "Hide",
    rowLabel: (s) => `Hide ${s.displayName ?? s.typeLabel}`,
    approvePrompt: (s) =>
      s.count === 1
        ? `Hide ${s.displayName ?? `this ${s.typeLabel}`} from the graph?`
        : `Hide ${s.typeLabel} from the graph?`,
  },
  merge_nodes: {
    approve: "Merge",
    rowLabel: (s) => `Merge ${s.displayName ?? s.typeLabel}`,
    approvePrompt: () => "Merge these nodes?",
  },
  supersede: {
    approve: "Replace",
    rowLabel: (s) => `Replace ${s.displayName ?? s.typeLabel}`,
    approvePrompt: () => "Replace the old node with the new one?",
  },
}

// ── Confirm action popover (used for both Approve and Dismiss) ────────────────

function ConfirmActionPopover({
  tone,
  triggerLabel,
  prompt,
  withReason,
  reasonPlaceholder,
  loadingLabel,
  loading,
  onConfirm,
  minWidthClass,
}: {
  tone: "approve" | "dismiss"
  triggerLabel: string
  prompt: string
  withReason?: boolean
  reasonPlaceholder?: string
  loadingLabel: string
  loading: boolean
  onConfirm: (reason: string) => void
  minWidthClass?: string
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const isApprove = tone === "approve"

  // Position popover relative to trigger; portaled to body to escape clipping ancestors
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    function reposition() {
      const r = triggerRef.current!.getBoundingClientRect()
      setCoords({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
    reposition()
    window.addEventListener("resize", reposition)
    window.addEventListener("scroll", reposition, true)
    return () => {
      window.removeEventListener("resize", reposition)
      window.removeEventListener("scroll", reposition, true)
    }
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (popoverRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className={cn(
          "rounded border px-2 py-0.5 text-[11px] font-medium transition-all text-center",
          minWidthClass,
          isApprove
            ? open
              ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-200"
              : "border-emerald-500/40 bg-emerald-500/5 text-emerald-300 hover:border-emerald-500/70 hover:bg-emerald-500/15"
            : open
              ? "border-muted-foreground/60 bg-transparent text-foreground"
              : "border-border bg-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
        )}
      >
        {triggerLabel}
      </button>
      {open && coords && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: "fixed", top: coords.top, right: coords.right }}
            className="z-50 flex w-[240px] flex-col gap-2 rounded-md border border-border bg-popover p-2 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] text-muted-foreground">{prompt}</p>
            {withReason && (
              <textarea
                className="w-full resize-none rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder={reasonPlaceholder}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={loading}
                onClick={(e) => {
                  e.stopPropagation()
                  onConfirm(reason)
                  setOpen(false)
                  setReason("")
                }}
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50",
                  isApprove
                    ? "bg-emerald-600/80 text-white hover:bg-emerald-600"
                    : "bg-destructive/80 text-destructive-foreground hover:bg-destructive"
                )}
              >
                {loading ? loadingLabel : "Confirm"}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                }}
                className="rounded px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

// ── Subject list item (for expanded panel) ───────────────────────────────────

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

// ── Action icon map ───────────────────────────────────────────────────────────

const ICON_MAP: Record<string, LucideIcon> = {
  "git-merge": GitMerge,
  "trash-2": Trash2,
  "arrow-right-left": ArrowRightLeft,
}

// ── Main ReviewRow ────────────────────────────────────────────────────────────

export interface ReviewRowProps {
  review: Review
  schemas: SchemaNode[]
  onRefresh: () => void
  onCountRefresh?: () => void
  selected?: boolean
  onSelectChange?: (selected: boolean) => void
  selectable?: boolean
  /** When true, the checkbox is rendered but disabled (e.g., locked by same-action rule). */
  selectionLocked?: boolean
  selectionLockedReason?: string
}

export function ReviewRow({
  review,
  schemas,
  onRefresh,
  onCountRefresh,
  selected = false,
  onSelectChange,
  selectable = false,
  selectionLocked = false,
  selectionLockedReason,
}: ReviewRowProps) {
  const router = useRouter()
  const { isAdmin } = useUserStore()
  const [expanded, setExpanded] = useState(false)
  const [approving, setApproving] = useState(false)
  const [dismissing, setDismissing] = useState(false)
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

  const subjectSummary = useMemo(
    () => summarizeSubjects(review.subject_nodes, schemas),
    [review.subject_nodes, schemas]
  )
  const labels = ACTION_LABELS[review.action_name] ?? DEFAULT_ACTION_LABELS

  async function handleApprove() {
    if (!isAdmin) return
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

  const isPending = review.status === "pending"

  return (
    <div
      className={cn(
        "border-b border-border/30 last:border-b-0",
        selected && "bg-primary/5"
      )}
    >
      {/* Compact row */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
        className="grid w-full cursor-pointer grid-cols-[22px_20px_16px_1fr_auto_170px] items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/20"
      >
        {selectable && onSelectChange ? (
          <span title={selectionLocked && !selected ? selectionLockedReason : undefined}>
            <Checkbox
              checked={selected}
              onChange={onSelectChange}
              onClick={(e) => e.stopPropagation()}
              disabled={selectionLocked && !selected}
              ariaLabel={`Select review ${review.ref_id}`}
            />
          </span>
        ) : (
          <span aria-hidden />
        )}
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )}
        />
        {(() => { const ActionIcon = ICON_MAP[review.icon ?? ""] ?? GitMerge; return <ActionIcon className="h-3.5 w-3.5 text-primary/70" /> })()}

        {direction ? (
          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
            <SourceChips fromIds={direction.fromIds} subjectMap={subjectMap} schemas={schemas} />
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            <InlineChip
              refId={direction.toId}
              subject={subjectMap.get(direction.toId)}
              schemas={schemas}
              emphasis
            />
          </div>
        ) : (
          <span className="text-[12px] text-muted-foreground">
            {labels.rowLabel(subjectSummary)}
          </span>
        )}

        <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-muted-foreground">
          {review.run_ref_id && <span>Run #{review.run_ref_id.slice(-5)}</span>}
          {review.run_ref_id && <span>·</span>}
          <span>{relativeTime}</span>
        </div>

        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          {isPending && isAdmin ? (
            <div className="flex gap-1">
              <ConfirmActionPopover
                tone="approve"
                triggerLabel={labels.approve}
                prompt={labels.approvePrompt(subjectSummary)}
                loadingLabel={`${labels.approve}…`}
                loading={approving}
                onConfirm={() => handleApprove()}
                minWidthClass="min-w-[68px]"
              />
              <ConfirmActionPopover
                tone="dismiss"
                triggerLabel="Dismiss"
                prompt="Dismiss this suggestion?"
                withReason
                reasonPlaceholder="Optional reason…"
                loadingLabel="Dismissing…"
                loading={dismissing}
                onConfirm={(reason) => handleDismiss(reason)}
                minWidthClass="min-w-[68px]"
              />
            </div>
          ) : (
            <StatusBadge status={review.status} />
          )}
        </div>
      </div>

      {/* Inline error / dismissal context (visible without expanding) */}
      {review.status === "failed" && review.error_message && (
        <div className="px-3 pb-2 pl-[82px] text-[11px] font-medium text-red-400">
          ✕ {review.error_message}
        </div>
      )}
      {review.status === "dismissed" && review.dismissal_reason && (
        <div className="px-3 pb-2 pl-[82px] text-[11px] italic text-muted-foreground">
          Reason: {review.dismissal_reason}
        </div>
      )}
      {inlineError && (
        <div className="px-3 pb-2 pl-[82px] text-[11px] font-medium text-red-400">
          ✕ {inlineError}
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/40 bg-background/30 px-4 py-3">
          {direction ? (
            <div className="grid grid-cols-[1fr_auto_1fr] gap-2">
              <div>
                <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Merging {direction.fromIds.length} source{direction.fromIds.length === 1 ? "" : "s"}
                </div>
                <div className="flex flex-col gap-px">
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
              <div className="flex items-center justify-center px-2">
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60" />
              </div>
              <div>
                <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Into canonical
                </div>
                <SubjectListItem
                  refId={direction.toId}
                  resolved={subjectMap.get(direction.toId)}
                  schemas={schemas}
                  onClick={() => router.push(`/?ref=${direction.toId}`)}
                />
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Subjects ({review.subject_nodes.length})
              </div>
              <div className="flex flex-col gap-px">
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

          <div className="mt-3 border-t border-border/30 pt-2">
            <div className="mb-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Rationale
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <p className="text-[11px] leading-relaxed text-foreground/80 cursor-default">
                    {review.rationale}
                  </p>
                }
              />
              <TooltipContent side="bottom" className="max-w-md text-xs">
                {review.rationale}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  )
}
