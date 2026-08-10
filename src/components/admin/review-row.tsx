"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { ArrowRight, ArrowRightLeft, CheckCircle2, ChevronRight, GitMerge, Layers, Loader2, Network, Pencil, PlusCircle, PlusSquare, Share2, Trash2, Users, type LucideIcon } from "lucide-react"
import { formatDateRelative } from "@/lib/date-format"
import type {
  PromotionSummary,
  Review,
  ReviewStatus,
  SchemaTypeOverride,
} from "@/lib/graph-api"
import { approveReview, dismissReview, triggerMergeWorkflow } from "@/lib/graph-api"
import { SchemaPromotionDialog } from "@/components/admin/schema-promotion-dialog"
import { useStakworkRunStatus } from "@/lib/hooks/use-stakwork-run-status"
import { cn, displayNodeType } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { NodeRow } from "@/components/layout/node-row"
import { Checkbox } from "@/components/ui/checkbox"
import type { SchemaNode } from "@/lib/schema-types"
import { DISPLAY_KEY_FALLBACKS, pickString } from "@/lib/node-display"
import { useUserStore } from "@/stores/user-store"

const IMAGE_FIELD_KEY = "image_url"

function ProposedChangeValue({ fieldKey, value }: { fieldKey: string; value: unknown }) {
  const [imgError, setImgError] = useState(false)
  const strValue = String(value)

  if (fieldKey === IMAGE_FIELD_KEY && typeof value === "string" && value.length > 0 && !imgError) {
    return (
      <div className="col-span-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={strValue}
          alt="image preview"
          className="max-h-40 w-full rounded-md border border-border/50 object-contain bg-muted/20"
          onError={() => setImgError(true)}
        />
      </div>
    )
  }

  return <span className="break-all text-foreground/90">{strValue}</span>
}
import { useGraphStore } from "@/stores/graph-store"

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

// ── Confidence indicator (dot + label, color-banded) ─────────────────────────
// Accepts a 0–1 score. Bands: High ≥0.85, Medium ≥0.6, Low below.

function ConfidenceIndicator({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(1, value))
  const pct = Math.round(clamped * 100)
  const band =
    clamped >= 0.85
      ? { dot: "bg-emerald-400", text: "text-emerald-300", label: "High confidence" }
      : clamped >= 0.6
        ? { dot: "bg-amber-400", text: "text-amber-300", label: "Medium confidence" }
        : { dot: "bg-rose-400", text: "text-rose-300", label: "Low confidence" }
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium", band.text)}
      title={`Model confidence: ${pct}%`}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", band.dot)} />
      {band.label}
      <span className="text-muted-foreground">·</span>
      <span className="tabular-nums">{pct}%</span>
    </span>
  )
}

// Pulls an inline "(confidence: 0.77)" out of a rationale string. Returns the
// score normalized to 0–1 and the rationale with that fragment removed, so the
// number can be shown as a badge instead of being buried in the sentence.
function extractConfidence(
  rationale: string | null | undefined
): { value: number; cleaned: string } | null {
  if (!rationale) return null
  const m = rationale.match(/\(\s*confidence:\s*([0-9]*\.?[0-9]+)\s*\)/i)
  if (!m) return null
  const raw = parseFloat(m[1])
  if (Number.isNaN(raw)) return null
  const value = raw > 1 ? raw / 100 : raw
  const cleaned = rationale.replace(m[0], "").replace(/\s{2,}/g, " ").trim()
  return { value, cleaned }
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
        "inline-flex min-w-0 max-w-[220px] items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-[12px]",
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
// rowLabel carries no verb — the row icon and the approve button already state
// the action. Approve verbs still differ per action ("Hide", not "Delete", for
// soft_delete, because the node stays in the system).

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
    rowLabel: (s) => s.displayName ?? s.typeLabel,
    approvePrompt: (s) =>
      s.count === 1
        ? `Hide ${s.displayName ?? `this ${s.typeLabel}`} from the graph?`
        : `Hide ${s.typeLabel} from the graph?`,
  },
  merge_nodes: {
    approve: "Merge",
    rowLabel: (s) => s.displayName ?? s.typeLabel,
    approvePrompt: () => "Merge these nodes?",
  },
  supersede: {
    approve: "Replace",
    rowLabel: (s) => s.displayName ?? s.typeLabel,
    approvePrompt: () => "Replace the old node with the new one?",
  },
  add_source: {
    approve: "Add",
    rowLabel: () => "New source",
    approvePrompt: () => "Add this source to the radar?",
  },
  add_social_handle: {
    approve: "Add Handle",
    rowLabel: () => "Social handle",
    approvePrompt: () => "Write this social handle to the Person node?",
  },
  add_node: {
    approve: "Add",
    rowLabel: (s) => s.displayName ?? s.typeLabel,
    approvePrompt: (s) => `Add this ${s.typeLabel} to the graph?`,
  },
  add_edge: {
    approve: "Connect",
    rowLabel: () => "New edge",
    approvePrompt: () => "Create this edge between the two nodes?",
  },
  edit_node: {
    approve: "Apply",
    rowLabel: (s) => s.displayName ?? s.typeLabel,
    approvePrompt: (s) => `Apply proposed changes to ${s.displayName ?? `this ${s.typeLabel}`}?`,
  },
  add_schema_node_type: {
    approve: "Create",
    rowLabel: () => "New schema type",
    approvePrompt: () => "Create this node type in the ontology?",
  },
  add_schema_edge_type: {
    approve: "Register",
    rowLabel: () => "Schema edge type",
    approvePrompt: () => "Register this edge type in the schema?",
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
  disabled,
  disabledReason,
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
  disabled?: boolean
  disabledReason?: string
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
        disabled={disabled || loading}
        title={disabled ? disabledReason : undefined}
        onClick={(e) => {
          e.stopPropagation()
          if (!disabled) setOpen((v) => !v)
        }}
        className={cn(
          "shrink-0 whitespace-nowrap rounded border px-2 py-0.5 text-[11px] font-medium transition-all text-center",
          minWidthClass,
          disabled
            ? "cursor-not-allowed border-border/60 bg-transparent text-muted-foreground/70"
            : isApprove
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
  "plus-circle": PlusCircle,
  "share-2": Share2,
  "plus-square": PlusSquare,
  "pencil": Pencil,
  "layers": Layers,
  "network": Network,
}

// ── Main ReviewRow ────────────────────────────────────────────────────────────

export interface ReviewRowProps {
  review: Review
  schemas: SchemaNode[]
  onRefresh: () => void
  onCountRefresh?: () => void
  selected?: boolean
  onSelectChange?: (selected: boolean, shiftKey: boolean) => void
  selectable?: boolean
  /** When true, the checkbox is rendered but disabled (e.g., locked by same-action rule). */
  selectionLocked?: boolean
  selectionLockedReason?: string
  /**
   * Bumped by the list page after a bulk "Human Review" dispatch that included
   * this row, so the row adopts the run it never fired itself. Any increase is
   * treated as one dispatch; 0 means this row was not part of one.
   */
  humanReviewDispatchToken?: number
  /** Reports whether this row's human review has been sent, so the page can exclude it from a bulk dispatch. */
  onHumanReviewStateChange?: (refId: string, sent: boolean) => void
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
  humanReviewDispatchToken = 0,
  onHumanReviewStateChange,
}: ReviewRowProps) {
  const router = useRouter()
  const setReturnTo = useGraphStore((s) => s.setReturnTo)
  const { isAdmin } = useUserStore()
  const [expanded, setExpanded] = useState(false)
  const [approving, setApproving] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)

  // ── Human Review dispatch (merge_nodes + pending only) ───────────────────────
  const isMergeReviewEligible = review.action_name === "merge_nodes" && review.status === "pending"
  const {
    status: humanReviewStatus,
    isInFlight: humanReviewInFlight,
    trigger: triggerHumanReview,
    triggering: humanReviewTriggering,
    markTriggered: markHumanReviewTriggered,
  } = useStakworkRunStatus(
    isMergeReviewEligible ? review.ref_id : null,
    "node_merge_review",
    {
      // The workflow reports back through the ingest webhook, which turns its
      // recommendations into new Reviews. Without this refresh they sit unseen
      // until the operator reloads the page.
      onCompleted: () => {
        onRefresh()
        onCountRefresh?.()
      },
      onTriggerError: setInlineError,
    }
  )

  // A human review takes as long as it takes — showing its run as "Sending…"
  // for that whole time reads as though the dispatch is still going. Once the
  // run exists, the only fact the operator needs is that it was sent, so an
  // in-flight run and a completed one look the same here. Polling continues
  // regardless: onCompleted is what surfaces the workflow's results.
  const humanReviewSent =
    humanReviewStatus === "COMPLETED" || humanReviewInFlight

  // Adopt a run the list page dispatched on this row's behalf. Guarded by a ref
  // so a re-render (or StrictMode's double effect) never re-adopts the same one.
  const adoptedDispatchRef = useRef(0)
  useEffect(() => {
    if (!isMergeReviewEligible) return
    if (humanReviewDispatchToken <= adoptedDispatchRef.current) return
    adoptedDispatchRef.current = humanReviewDispatchToken
    markHumanReviewTriggered()
  }, [humanReviewDispatchToken, isMergeReviewEligible, markHumanReviewTriggered])

  // Let the page know this row is already sent so a bulk dispatch skips it.
  useEffect(() => {
    if (!isMergeReviewEligible) return
    onHumanReviewStateChange?.(review.ref_id, humanReviewSent)
  }, [isMergeReviewEligible, humanReviewSent, review.ref_id, onHumanReviewStateChange])

  // ── Merge-specific interactive state ────────────────────────────────────────
  const [checkedSources, setCheckedSources] = useState<Set<string>>(new Set())
  const [canonicalId, setCanonicalId] = useState<string>("")

  const relativeTime = formatDateRelative(review.created_at, review.created_at ?? "")

  const direction = useMemo(
    () => extractDirection(review.action_name, review.action_payload),
    [review.action_name, review.action_payload]
  )

  // Reset merge state whenever the direction changes (e.g. review prop update)
  useEffect(() => {
    if (direction && review.action_name === "merge_nodes") {
      setCheckedSources(new Set(direction.fromIds))
      setCanonicalId(direction.toId)
    }
  }, [direction, review.action_name])

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

  // ── Merge derived values ─────────────────────────────────────────────────────
  const effectiveFrom = useMemo(() => [...checkedSources], [checkedSources])

  const mergeError = useMemo<string | null>(() => {
    if (review.action_name !== "merge_nodes") return null
    if (checkedSources.size === 0) return "Select at least one source node to merge"
    return null
  }, [review.action_name, checkedSources])

  const isModified = useMemo(() => {
    if (review.action_name !== "merge_nodes" || !direction) return false
    if (canonicalId !== direction.toId) return true
    const originalSet = new Set(direction.fromIds)
    if (checkedSources.size !== originalSet.size) return true
    for (const id of checkedSources) {
      if (!originalSet.has(id)) return true
    }
    return false
  }, [review.action_name, direction, canonicalId, checkedSources])

  // ── Scratchpad promotion (add_schema_node_type on a scratchpad_entry) ───────
  // The type has to be created WITH the attributes the parked payloads need —
  // a bare type can't hold their data, so the entries would fail to replay.
  // Approving therefore goes through a confirmation dialog rather than straight
  // to the API, and its result comes back as the approve override_payload.
  const isSchemaPromotion =
    review.action_name === "add_schema_node_type" &&
    review.type === "scratchpad_entry"
  const [promotionOpen, setPromotionOpen] = useState(false)
  const [promotionSummary, setPromotionSummary] =
    useState<PromotionSummary | null>(null)

  async function submitApproval(override?: SchemaTypeOverride | { from: string[]; to: string }) {
    setApproving(true)
    setInlineError(null)
    try {
      const res = await approveReview(review.ref_id, override)
      if (res.error_message || res.status === "failed") {
        setInlineError(res.error_message ?? "Approval failed")
        onCountRefresh?.()
        return
      }
      // Surface partial promotion outcomes before the row is refetched away —
      // "approved" alone doesn't say whether the entries actually landed.
      if (res.promotion_summary && res.promotion_summary.failed.length > 0) {
        setPromotionSummary(res.promotion_summary)
        onCountRefresh?.()
        return
      }
      setPromotionOpen(false)
      onRefresh()
      onCountRefresh?.()
    } catch {
      setInlineError("Approval request failed")
    } finally {
      setApproving(false)
    }
  }

  async function handleApprove() {
    if (!isAdmin) return
    if (mergeError) return
    if (isSchemaPromotion) {
      setPromotionOpen(true)
      return
    }
    setApproving(true)
    setInlineError(null)
    try {
      const override =
        review.action_name === "merge_nodes" && isModified
          ? { from: effectiveFrom, to: canonicalId }
          : undefined
      const res = await approveReview(review.ref_id, override)
      if (res.error_message || res.status === "failed") {
        // Keep the row and its error visible instead of silently refetching it
        // out of the pending list (it is now 'failed', not pending) — otherwise
        // a failed merge just vanishes and looks like it succeeded. Still refresh
        // the pending badge so the count reflects that it left the queue.
        setInlineError(res.error_message ?? "Approval failed")
        onCountRefresh?.()
        return
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
          const tag = (e.target as HTMLElement).tagName
          if (tag === "TEXTAREA" || tag === "INPUT") return
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
        className="grid w-full cursor-pointer grid-cols-[22px_20px_16px_minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/20"
      >
        {selectable && onSelectChange ? (
          <span title={selectionLocked && !selected ? selectionLockedReason : undefined}>
            <Checkbox
              checked={selected}
              onChange={(next, e) =>
                onSelectChange(
                  next,
                  "shiftKey" in e.nativeEvent &&
                    (e.nativeEvent as MouseEvent).shiftKey === true
                )
              }
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
            {(!direction && review.subject_nodes.length === 0 && review.display_label)
              ? review.display_label
              : labels.rowLabel(subjectSummary)}
          </span>
        )}

        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-[10px] text-muted-foreground">
          {review.run_ref_id && <span>Run #{review.run_ref_id.slice(-5)}</span>}
          {review.run_ref_id && <span>·</span>}
          <span>{relativeTime}</span>
        </div>

        <div className="flex shrink-0 justify-end" onClick={(e) => e.stopPropagation()}>
          {isPending && isAdmin ? (
            <div className="flex shrink-0 items-center gap-1">
              {/* A schema promotion needs the property table filled in before
                  anything is created, so it opens the dialog directly — a
                  confirm popover in front of it would be a second prompt for
                  the same decision. */}
              {isSchemaPromotion ? (
                <button
                  type="button"
                  data-testid="open-schema-promotion-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPromotionOpen(true)
                  }}
                  className="inline-flex min-w-[68px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 text-[11px] font-medium text-emerald-400 transition-all hover:border-emerald-500/60 hover:bg-emerald-500/10"
                >
                  {labels.approve}
                </button>
              ) : (
                <ConfirmActionPopover
                  tone="approve"
                  triggerLabel={labels.approve}
                  prompt={labels.approvePrompt(subjectSummary)}
                  loadingLabel={`${labels.approve}…`}
                  loading={approving}
                  onConfirm={() => handleApprove()}
                  minWidthClass="min-w-[68px]"
                  disabled={mergeError !== null}
                  disabledReason={mergeError ?? undefined}
                />
              )}
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
              {/* Send for Human Review — merge_nodes + pending only */}
              {isMergeReviewEligible && (
                <button
                  type="button"
                  data-testid="send-for-human-review-btn"
                  disabled={humanReviewSent || humanReviewTriggering}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (humanReviewSent) return
                    triggerHumanReview(() => triggerMergeWorkflow(review.ref_id))
                  }}
                  title={
                    humanReviewSent
                      ? "Sent for human review"
                      : humanReviewStatus === "FAILED"
                        ? "Review failed — click to retry"
                        : "Send for human review"
                  }
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 py-0.5 text-[11px] font-medium transition-all",
                    humanReviewTriggering
                      ? "cursor-not-allowed border-sky-500/40 bg-sky-500/10 text-sky-300"
                      : humanReviewSent
                        ? "cursor-default border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : humanReviewStatus === "FAILED"
                          ? "border-red-500/40 bg-red-500/5 text-red-400 hover:border-red-500/70 hover:bg-red-500/15"
                          : "border-sky-500/30 bg-sky-500/5 text-sky-400 hover:border-sky-500/60 hover:bg-sky-500/10"
                  )}
                >
                  {humanReviewTriggering ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Sending…
                    </>
                  ) : humanReviewSent ? (
                    <>
                      <CheckCircle2 className="h-3 w-3" />
                      Sent
                    </>
                  ) : humanReviewStatus === "FAILED" ? (
                    <>
                      <Users className="h-3 w-3" />
                      Retry Review
                    </>
                  ) : (
                    <>
                      <Users className="h-3 w-3" />
                      Human Review
                    </>
                  )}
                </button>
              )}
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

      {/* Partial promotion: the type was created but some entries did not
          replay. Reported here because the row's status ("approved") can't
          express it. */}
      {promotionSummary && promotionSummary.failed.length > 0 && (
        <div className="px-3 pb-2 pl-[82px] text-[11px] text-amber-400">
          Type created. {promotionSummary.promoted.length} of{" "}
          {promotionSummary.attempted} entries promoted;{" "}
          {promotionSummary.failed.length} failed:
          <ul className="mt-0.5 list-disc pl-4 text-muted-foreground">
            {promotionSummary.failed.map((f) => (
              <li key={f.entry_ref_id}>
                <span className="font-mono">{f.entry_ref_id.slice(0, 8)}</span>{" "}
                — {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isSchemaPromotion && (
        <SchemaPromotionDialog
          open={promotionOpen}
          onOpenChange={(next) => {
            setPromotionOpen(next)
            if (!next) setInlineError(null)
          }}
          reviewRefId={review.ref_id}
          submitting={approving}
          onConfirm={submitApproval}
        />
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/40 bg-background/30 px-4 py-3">
          {direction && review.action_name === "merge_nodes" ? (
            (() => {
              // All nodes in the review (original fromIds + original toId), excluding current canonical
              const allNodeIds = [...direction.fromIds, direction.toId]
              const uniqueNodeIds = Array.from(new Set(allNodeIds))
              const sourceSlots = uniqueNodeIds.filter((id) => id !== canonicalId)

              return (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-2">
                    {/* Sources column */}
                    <div>
                      <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Sources ({sourceSlots.length})
                      </div>
                      <div className="flex flex-col gap-1">
                        {sourceSlots.map((id) => {
                          const isChecked = checkedSources.has(id)
                          return (
                            <div key={id} className="flex items-center gap-1.5">
                              <Checkbox
                                checked={isChecked}
                                onChange={(checked) => {
                                  setCheckedSources((prev) => {
                                    const next = new Set(prev)
                                    if (checked) next.add(id)
                                    else next.delete(id)
                                    return next
                                  })
                                }}
                                ariaLabel={`Include ${id} in merge`}
                              />
                              <div className="min-w-0 flex-1">
                                <SubjectListItem
                                  refId={id}
                                  resolved={subjectMap.get(id)}
                                  schemas={schemas}
                                  onClick={() => { setReturnTo('/admin/reviews'); router.push(`/?id=${id}`) }}
                                />
                              </div>
                              <button
                                type="button"
                                title="Set as canonical"
                                aria-label={`Set ${id} as canonical`}
                                onClick={() => {
                                  const prevCanonical = canonicalId
                                  setCanonicalId(id)
                                  setCheckedSources((prev) => {
                                    const next = new Set(prev)
                                    // The promoted source leaves sources; old canonical joins sources (checked)
                                    next.delete(id)
                                    next.add(prevCanonical)
                                    return next
                                  })
                                }}
                                className="shrink-0 flex h-4 w-4 items-center justify-center rounded-full border border-border/60 bg-background text-muted-foreground hover:border-primary/60 hover:text-primary transition-colors"
                              >
                                <span className="h-2 w-2 rounded-full" />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Arrow */}
                    <div className="flex items-center justify-center px-2">
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                    </div>

                    {/* Canonical column */}
                    <div>
                      <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Canonical (survives)
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="min-w-0 flex-1">
                          <SubjectListItem
                            refId={canonicalId}
                            resolved={subjectMap.get(canonicalId)}
                            schemas={schemas}
                            onClick={() => { setReturnTo('/admin/reviews'); router.push(`/?id=${canonicalId}`) }}
                          />
                        </div>
                        {/* Locked "canonical" radio indicator */}
                        <div
                          title="Current canonical node"
                          aria-label="Canonical node (locked)"
                          className="shrink-0 flex h-4 w-4 items-center justify-center rounded-full border border-primary/60 bg-primary/10 text-primary"
                        >
                          <span className="h-2 w-2 rounded-full bg-primary" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Merge error */}
                  {mergeError && (
                    <p className="text-[11px] text-amber-400">{mergeError}</p>
                  )}
                </div>
              )
            })()
          ) : direction ? (
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
                      onClick={() => { setReturnTo('/admin/reviews'); router.push(`/?id=${id}`) }}
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
                  onClick={() => { setReturnTo('/admin/reviews'); router.push(`/?id=${direction.toId}`) }}
                />
              </div>
            </div>
          ) : review.action_name === "add_source" && review.action_payload && typeof review.action_payload === "object" ? (
            <div>
              <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Suggested Source
              </div>
              <div className="flex flex-col gap-1 text-[12px]">
                <div>
                  <span className="text-muted-foreground">Type: </span>
                  <span>{String((review.action_payload as Record<string, unknown>).source_type ?? "—")}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Source: </span>
                  <span className="break-all">{String((review.action_payload as Record<string, unknown>).source ?? "—")}</span>
                </div>
              </div>
            </div>
          ) : review.action_name === "add_social_handle" && review.action_payload ? (
            (() => {
              const p = review.action_payload as {
                platform: string
                handle: string
                source_url?: string
                confidence?: number
              }
              return (
                <div>
                  <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Social Handle
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium capitalize">
                      {p.platform}
                    </span>
                    <span className="font-mono text-foreground">{p.handle}</span>
                    {p.source_url && (
                      <a
                        href={p.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-primary underline-offset-2 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {p.source_url}
                      </a>
                    )}
                    {p.confidence !== undefined && (
                      <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                        {Math.round(p.confidence * 100)}% confidence
                      </span>
                    )}
                  </div>
                </div>
              )
            })()
          ) : review.action_name === "add_node" && review.action_payload ? (
            (() => {
              const p = review.action_payload as { node_type?: string; properties?: Record<string, unknown> }
              const SYSTEM_KEYS = new Set(["ref_id", "namespace", "date_added_to_graph"])
              const props = p.properties ?? {}
              const entries = Object.entries(props).filter(([k]) => !SYSTEM_KEYS.has(k))
              return (
                <div>
                  <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Proposed Node
                  </div>
                  {p.node_type && (
                    <span className="mb-2 inline-flex items-center rounded border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium">
                      {p.node_type}
                    </span>
                  )}
                  {entries.length > 0 && (
                    <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                      {entries.map(([k, v]) => (
                        <>
                          <span key={`k-${k}`} className="text-muted-foreground">{k}</span>
                          <span key={`v-${k}`} className="break-all text-foreground/90">{String(v)}</span>
                        </>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()
          ) : review.action_name === "add_edge" && review.action_payload ? (
            (() => {
              const p = review.action_payload as { source_ref_id?: string; target_ref_id?: string; edge_type?: string }
              const sourceNode = p.source_ref_id ? subjectMap.get(p.source_ref_id) : undefined
              const targetNode = p.target_ref_id ? subjectMap.get(p.target_ref_id) : undefined
              return (
                <div>
                  <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Proposed Edge
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {p.source_ref_id && (
                      <InlineChip refId={p.source_ref_id} subject={sourceNode} schemas={schemas} />
                    )}
                    {p.edge_type && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <ArrowRight className="h-3 w-3 shrink-0" />
                        <span className="font-mono font-semibold text-foreground/80">{p.edge_type}</span>
                        <ArrowRight className="h-3 w-3 shrink-0" />
                      </span>
                    )}
                    {p.target_ref_id && (
                      <InlineChip refId={p.target_ref_id} subject={targetNode} schemas={schemas} emphasis />
                    )}
                  </div>
                </div>
              )
            })()
          ) : review.action_name === "edit_node" && review.action_payload ? (
            (() => {
              const p = review.action_payload as {
                ref_id?: string
                node_type?: string
                properties?: Record<string, unknown>
                delete_properties?: string[]
              }
              const subject = review.subject_nodes[0]
              const currentType = subject?.node_type
              const typeChanged = p.node_type && currentType && p.node_type !== currentType
              const changedEntries = p.properties ? Object.entries(p.properties) : []
              const deletedProps = p.delete_properties ?? []
              return (
                <div className="flex flex-col gap-3">
                  {subject && (
                    <div>
                      <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Node Being Edited
                      </div>
                      <SubjectListItem
                        refId={subject.ref_id}
                        resolved={subject}
                        schemas={schemas}
                        onClick={() => { setReturnTo('/admin/reviews'); router.push(`/?id=${subject.ref_id}`) }}
                      />
                    </div>
                  )}
                  {typeChanged && (
                    <div>
                      <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Type Change
                      </div>
                      <div className="flex items-center gap-2 text-[12px]">
                        <span className="rounded border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px]">{currentType}</span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                        <span className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{p.node_type}</span>
                      </div>
                    </div>
                  )}
                  {changedEntries.length > 0 && (
                    <div>
                      <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Proposed Changes
                      </div>
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                        {changedEntries.map(([k, v]) => (
                          <>
                            <span key={`k-${k}`} className="text-muted-foreground">{k}</span>
                            <ProposedChangeValue key={`v-${k}`} fieldKey={k} value={v} />
                          </>
                        ))}
                      </div>
                    </div>
                  )}
                  {deletedProps.length > 0 && (
                    <div>
                      <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Remove Properties
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {deletedProps.map((k) => (
                          <span key={k} className="inline-flex items-center rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-mono text-red-400">
                            {k}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()
          ) : review.action_name === "add_schema_node_type" && review.action_payload ? (
            (() => {
              const p = review.action_payload as {
                type?: string
                parent?: string
                color?: string
                icon?: string
                attributes?: { key: string; type: string; required?: boolean }[]
              }
              return (
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Proposed Schema Type
                    </div>
                    <div className="flex items-center gap-2">
                      {p.color && (
                        <span
                          className="inline-block h-3 w-3 shrink-0 rounded-full border border-border/60"
                          style={{ backgroundColor: p.color }}
                        />
                      )}
                      <span className="font-semibold text-[13px]">{p.type}</span>
                    </div>
                  </div>
                  {p.parent && (
                    <div>
                      <div className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Parent Hierarchy
                      </div>
                      <div className="flex items-center gap-2 text-[12px]">
                        <span className="rounded border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px]">{p.parent}</span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                        <span className="rounded border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px]">{p.type}</span>
                      </div>
                    </div>
                  )}
                  {p.attributes && p.attributes.length > 0 && (
                    <div>
                      <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Attributes
                      </div>
                      <div className="flex flex-col gap-1">
                        {p.attributes.map((attr) => (
                          <div key={attr.key} className="flex items-center gap-2 text-[12px]">
                            <span className="font-mono text-foreground/90">{attr.key}</span>
                            <span className="text-muted-foreground">({attr.type})</span>
                            {attr.required && (
                              <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-400">required</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()
          ) : review.action_name === "add_schema_edge_type" && review.action_payload ? (
            (() => {
              const p = review.action_payload as { edge_type?: string; source?: string; target?: string }
              function EdgeTypeNode({ value }: { value?: string }) {
                if (!value) return <span className="text-muted-foreground">—</span>
                if (value === "*") {
                  return (
                    <span className="inline-flex items-center rounded border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] font-medium italic text-muted-foreground">
                      Any type
                    </span>
                  )
                }
                return (
                  <span className="inline-flex items-center rounded border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium">
                    {value}
                  </span>
                )
              }
              return (
                <div>
                  <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Proposed Schema Edge
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-[12px]">
                    <EdgeTypeNode value={p.source} />
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <ArrowRight className="h-3 w-3 shrink-0" />
                      <span className="font-mono font-semibold text-foreground/80">{p.edge_type ?? "—"}</span>
                      <ArrowRight className="h-3 w-3 shrink-0" />
                    </span>
                    <EdgeTypeNode value={p.target} />
                  </div>
                </div>
              )
            })()
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
                    onClick={() => { setReturnTo('/admin/reviews'); router.push(`/?id=${sn.ref_id}`) }}
                  />
                ))}
              </div>
            </div>
          )}

          {(() => {
            const conf = extractConfidence(review.rationale)
            const text = conf?.cleaned ?? review.rationale
            return (
              <div className="mt-3 border-t border-border/30 pt-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Rationale
                  </span>
                  {conf && <ConfidenceIndicator value={conf.value} />}
                </div>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <p className="text-[11px] leading-relaxed text-foreground/80 cursor-default">
                        {text}
                      </p>
                    }
                  />
                  <TooltipContent side="bottom" className="max-w-md text-xs">
                    {text}
                  </TooltipContent>
                </Tooltip>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
