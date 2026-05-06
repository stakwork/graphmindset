"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { useUserStore } from "@/stores/user-store"
import { useReviewStore } from "@/stores/review-store"
import { useSchemaStore } from "@/stores/schema-store"
import { listReviews } from "@/lib/graph-api"
import type { Review, ReviewStatus } from "@/lib/graph-api"
import { ReviewRow } from "@/components/admin/review-row"
import { Button } from "@/components/ui/button"

const STATUS_OPTIONS: { label: string; value: ReviewStatus | "" }[] = [
  { label: "Pending", value: "pending" },
  { label: "All", value: "" },
  { label: "Approved", value: "approved" },
  { label: "Dismissed", value: "dismissed" },
  { label: "Failed", value: "failed" },
]

const SORT_OPTIONS = [
  { label: "Newest first", value: "created_at" },
  { label: "Priority", value: "priority" },
]

const PAGE_SIZE = 20

function SkeletonRows() {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[20px_16px_1fr_auto_170px] items-center gap-3 border-b border-border/30 px-3 py-2 last:border-b-0"
        >
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
  const [skip, setSkip] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<ReviewStatus | "">( "pending")
  const [typeFilter, setTypeFilter] = useState("")
  const [sort, setSort] = useState("created_at")

  const abortRef = useRef<AbortController | null>(null)

  // Redirect non-admins
  useEffect(() => {
    if (!isAdmin) router.replace("/")
  }, [isAdmin, router])

  const fetchReviews = useCallback(
    async (currentSkip = 0) => {
      if (abortRef.current) abortRef.current.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl

      setLoading(true)
      setError(null)
      try {
        const res = await listReviews(
          {
            status: statusFilter || undefined,
            type: typeFilter || undefined,
            sort,
            skip: currentSkip,
            limit: PAGE_SIZE,
          },
          ctrl.signal
        )
        setReviews(res.reviews)
        setTotal(res.total)
        setSkip(currentSkip)
      } catch (err: unknown) {
        if ((err as { name?: string })?.name !== "AbortError") {
          setError("Failed to load reviews")
        }
      } finally {
        setLoading(false)
      }
    },
    [statusFilter, typeFilter, sort]
  )

  // Re-fetch when filters change, reset to page 0
  useEffect(() => {
    fetchReviews(0)
  }, [fetchReviews])

  // Re-fetch count for badge after any action
  const refreshBadgeCount = useCallback(async () => {
    try {
      const res = await listReviews({ status: "pending", limit: 1 })
      setPendingCount(res.total)
    } catch {}
  }, [setPendingCount])

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const currentPage = Math.floor(skip / PAGE_SIZE) + 1

  if (!isAdmin) return null

  return (
    <div className="flex h-full flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => router.push("/")}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-heading font-semibold tracking-wide uppercase flex-1">
          Reviews
        </h1>
        {total > 0 && (
          <span className="text-xs text-muted-foreground">
            {total} result{total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        {/* Status filter */}
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Status</label>
          <div className="flex rounded-md border border-border overflow-hidden">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatusFilter(opt.value as ReviewStatus | "")}
                className={`px-2.5 py-1 text-xs font-medium transition-colors border-r border-border last:border-r-0 ${
                  statusFilter === opt.value
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted/40"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Type</label>
          <input
            type="text"
            placeholder="e.g. dedup"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary w-28"
          />
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1.5 ml-auto">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Sort</label>
          <div className="flex rounded-md border border-border overflow-hidden">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSort(opt.value)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors border-r border-border last:border-r-0 ${
                  sort === opt.value
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted/40"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

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
              {reviews.map((review) => (
                <ReviewRow
                  key={review.ref_id}
                  review={review}
                  schemas={schemas}
                  onRefresh={() => fetchReviews(skip)}
                  onCountRefresh={refreshBadgeCount}
                />
              ))}
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
