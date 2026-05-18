"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRightLeft, GitMerge, Trash2, X } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useUserStore } from "@/stores/user-store"
import { useReviewStore } from "@/stores/review-store"
import { useSchemaStore } from "@/stores/schema-store"
import { approveReview, dismissReview, listReviews } from "@/lib/graph-api"
import type { Review, ReviewStatus } from "@/lib/graph-api"
import { ReviewRow, getApproveVerb } from "@/components/admin/review-row"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { SelectCustom } from "@/components/ui/select-custom"
import { cn } from "@/lib/utils"

const STATUS_TABS: { label: string; value: ReviewStatus | "" }[] = [
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Dismissed", value: "dismissed" },
  { label: "Failed", value: "failed" },
  { label: "All", value: "" },
]

const ACTION_CHIPS: { label: string; value: string; icon?: LucideIcon }[] = [
  { label: "All", value: "" },
  { label: "Hide", value: "soft_delete", icon: Trash2 },
  { label: "Merge", value: "merge_nodes", icon: GitMerge },
  { label: "Replace", value: "supersede", icon: ArrowRightLeft },
]

const SORT_OPTIONS = [
  { label: "Newest first", value: "created_at" },
  { label: "Highest priority", value: "priority" },
]

const PAGE_SIZE = 20

function SkeletonRows() {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[22px_20px_16px_1fr_auto_170px] items-center gap-3 border-b border-border/30 px-3 py-2 last:border-b-0"
        >
          <div className="h-3 w-3 rounded bg-muted/30 animate-pulse" />
          <div className="h-3 w-3 rounded bg-muted/30 animate-pulse" />
          <div className="h-3 w-3 rounded bg-muted/30 animate-pulse" />
          <div className="h-4 rounded bg-muted/30 animate-pulse" style={{ width: `${50 + (i * 7) % 30}%` }} />
          <div className="h-3 w-24 rounded bg-muted/30 animate-pulse" />
          <div className="h-5 w-32 justify-self-end rounded bg-muted/30 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

export default function ReviewsPage() {
  const router = useRouter()
  const { isAdmin } = useUserStore()
  const { setPendingCount } = useReviewStore()
  const schemas = useSchemaStore((s) => s.schemas)

  const [reviews, setReviews] = useState<Review[]>([])
  const [total, setTotal] = useState(0)
  const [pendingTotal, setPendingTotal] = useState<number | null>(null)
  const [skip, setSkip] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<ReviewStatus | "">("pending")
  const [actionFilter, setActionFilter] = useState("")
  const [sort, setSort] = useState("created_at")

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkRunning, setBulkRunning] = useState<null | "approve" | "dismiss">(null)
  const [bulkError, setBulkError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  // Redirect non-admins
  useEffect(() => {
    if (!isAdmin) router.replace("/")
  }, [isAdmin, router])

  const fetchReviews = useCallback(
    async (currentSkip = 0, options?: { silent?: boolean }) => {
      if (abortRef.current) abortRef.current.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl

      if (!options?.silent) setLoading(true)
      setError(null)
      try {
        const res = await listReviews(
          {
            status: statusFilter || undefined,
            action_name: actionFilter || undefined,
            sort,
            skip: currentSkip,
            limit: PAGE_SIZE,
          },
          ctrl.signal
        )
        setReviews(res.reviews)
        setTotal(res.total)
        setSkip(currentSkip)
        if (!options?.silent) setSelectedIds(new Set())
      } catch (err: unknown) {
        if ((err as { name?: string })?.name !== "AbortError") {
          setError("Failed to load reviews")
        }
      } finally {
        if (!options?.silent) setLoading(false)
      }
    },
    [statusFilter, actionFilter, sort]
  )

  useEffect(() => {
    fetchReviews(0)
  }, [fetchReviews])

  // Pending count for the tab badge — refreshed independently of the active query
  const refreshPendingCount = useCallback(async () => {
    try {
      const res = await listReviews({
        status: "pending",
        action_name: actionFilter || undefined,
        limit: 1,
      })
      setPendingTotal(res.total)
      setPendingCount(res.total)
    } catch {}
  }, [actionFilter, setPendingCount])

  useEffect(() => {
    refreshPendingCount()
  }, [refreshPendingCount])

  // ── Selection helpers ──────────────────────────────────────────────────────

  const selectableReviews = useMemo(
    () => reviews.filter((r) => r.status === "pending"),
    [reviews]
  )

  const someSelected = selectedIds.size > 0

  const selectedReviews = useMemo(
    () => reviews.filter((r) => selectedIds.has(r.ref_id)),
    [reviews, selectedIds]
  )

  // Once a row is selected, only same-action rows can be added to the selection.
  const lockedActionName: string | null =
    selectedReviews.length > 0 ? selectedReviews[0].action_name : null

  // Rows eligible for select-all: pending + (matches locked action OR no lock yet)
  const eligibleForSelectAll = useMemo(
    () =>
      selectableReviews.filter(
        (r) => lockedActionName === null || r.action_name === lockedActionName
      ),
    [selectableReviews, lockedActionName]
  )

  const allEligibleSelected =
    eligibleForSelectAll.length > 0 &&
    eligibleForSelectAll.every((r) => selectedIds.has(r.ref_id))

  function toggleRow(refId: string, selected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (selected) next.add(refId)
      else next.delete(refId)
      return next
    })
  }

  function toggleSelectAll() {
    if (allEligibleSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(eligibleForSelectAll.map((r) => r.ref_id)))
    }
  }

  // ── Bulk handlers ──────────────────────────────────────────────────────────

  async function runBulk(kind: "approve" | "dismiss") {
    if (selectedReviews.length === 0) return
    setBulkRunning(kind)
    setBulkError(null)
    const fn = kind === "approve" ? approveReview : (id: string) => dismissReview(id)
    const results = await Promise.allSettled(
      selectedReviews.map((r) => fn(r.ref_id))
    )
    const failures = results.filter((r) => r.status === "rejected").length
    setBulkRunning(null)
    if (failures > 0) {
      setBulkError(
        `${failures} of ${selectedReviews.length} ${kind === "approve" ? "approvals" : "dismissals"} failed`
      )
    }
    await fetchReviews(skip, { silent: true })
    refreshPendingCount()
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const currentPage = Math.floor(skip / PAGE_SIZE) + 1

  if (!isAdmin) return null

  return (
    <div className="flex h-full flex-col bg-background text-foreground overflow-hidden">
      {/* Title row */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => router.push("/")}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-heading font-semibold tracking-wide uppercase">
          Reviews
        </h1>
      </div>

      {/* Status tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 pt-2">
        {STATUS_TABS.map((tab) => {
          const active = statusFilter === tab.value
          const showPendingCount = tab.value === "pending" && pendingTotal !== null
          return (
            <button
              key={tab.value || "all"}
              type="button"
              onClick={() => setStatusFilter(tab.value)}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
              {showPendingCount && pendingTotal! > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[10px] font-semibold",
                    active
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {pendingTotal}
                </span>
              )}
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-t bg-primary" />
              )}
            </button>
          )
        })}
      </div>

      {/* Action chips + sort */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        <div className="flex items-center gap-1">
          {ACTION_CHIPS.map((chip) => {
            const active = actionFilter === chip.value
            const anySelected = actionFilter !== ""
            const Icon = chip.icon
            return (
              <button
                key={chip.value || "all"}
                type="button"
                onClick={() => setActionFilter(chip.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all",
                  active
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : anySelected
                      ? "border-border/40 bg-transparent text-muted-foreground/50 hover:border-muted-foreground/40 hover:text-foreground hover:opacity-100"
                      : "border-border bg-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
                )}
              >
                {Icon && <Icon className="h-3 w-3" />}
                {chip.label}
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {total} {total === 1 ? "result" : "results"}
          </span>
          <SelectCustom
            value={sort}
            onChange={setSort}
            options={SORT_OPTIONS}
            compact
            className="w-[160px]"
          />
        </div>
      </div>

      {/* Selection bar (only on Pending tab when there's something to select) */}
      {!loading && !error && statusFilter === "pending" && selectableReviews.length > 0 && (
        <div
          className={cn(
            "shrink-0 border-b border-border transition-colors",
            someSelected ? "bg-primary/5" : "bg-background"
          )}
        >
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
            <Checkbox
              checked={allEligibleSelected}
              indeterminate={someSelected && !allEligibleSelected}
              onChange={toggleSelectAll}
              ariaLabel="Select all pending"
            />
            {someSelected && lockedActionName ? (
              <>
                <span className="text-xs font-medium">
                  {selectedIds.size} selected
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {bulkError && (
                    <span className="text-[11px] text-red-400">{bulkError}</span>
                  )}
                  <Button
                    size="sm"
                    variant="default"
                    disabled={bulkRunning !== null}
                    onClick={() => runBulk("approve")}
                    className="h-7 px-3 text-xs"
                  >
                    {bulkRunning === "approve"
                      ? `${getApproveVerb(lockedActionName)}…`
                      : `${getApproveVerb(lockedActionName)} ${selectedIds.size}`}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulkRunning !== null}
                    onClick={() => runBulk("dismiss")}
                    className="h-7 px-3 text-xs"
                  >
                    {bulkRunning === "dismiss" ? "Dismissing…" : `Dismiss ${selectedIds.size}`}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    aria-label="Clear selection"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                Select all {selectableReviews.length}
              </span>
            )}
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-4 py-4">
          {error ? (
            <div className="flex h-full items-center justify-center py-16">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          ) : loading ? (
            <SkeletonRows />
          ) : reviews.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {statusFilter === "pending"
                ? "No pending reviews — the graph is clean ✓"
                : "No reviews match the selected filters."}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border/60">
              {reviews.map((review) => {
                const locked =
                  lockedActionName !== null &&
                  review.action_name !== lockedActionName
                return (
                  <ReviewRow
                    key={review.ref_id}
                    review={review}
                    schemas={schemas}
                    onRefresh={() => fetchReviews(skip, { silent: true })}
                    onCountRefresh={refreshPendingCount}
                    selectable={review.status === "pending"}
                    selected={selectedIds.has(review.ref_id)}
                    onSelectChange={(s) => toggleRow(review.ref_id, s)}
                    selectionLocked={locked}
                    selectionLockedReason={
                      locked
                        ? `Selection locked to "${getApproveVerb(lockedActionName!)}" actions — clear selection to switch.`
                        : undefined
                    }
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
      {!loading && !error && totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            Page {currentPage} of {totalPages} · {total} total
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchReviews(skip - PAGE_SIZE)}
              disabled={skip === 0}
              className="h-7 px-3 text-xs"
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchReviews(skip + PAGE_SIZE)}
              disabled={skip + PAGE_SIZE >= total}
              className="h-7 px-3 text-xs"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
