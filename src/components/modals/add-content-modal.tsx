"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, CheckCircle2, LinkIcon, Zap } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { MAX_LENGTHS } from "@/lib/input-limits"
import { useModalStore } from "@/stores/modal-store"
import { useUserStore } from "@/stores/user-store"
import { api } from "@/lib/api"
import { getL402, payL402, getPrice } from "@/lib/sphinx"
import {
  detectSourceType,
  SOURCE_TYPE_LABELS,
  type SourceType,
} from "@/lib/source-detection"

export function AddContentModal() {
  const { activeModal, close } = useModalStore()
  const { budget, setBudget } = useUserStore()
  const [sourceUrl, setSourceUrl] = useState("")
  const [detectedType, setDetectedType] = useState<SourceType | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")
  const [price, setPrice] = useState<number | null>(null)

  // Fetch price when modal opens
  useEffect(() => {
    if (activeModal === "addContent") {
      getPrice("add_node").then(setPrice)
    }
  }, [activeModal])

  const handleDetect = useCallback(async (value: string) => {
    setSourceUrl(value)
    setDetectedType(null)
    setError("")
    setSuccess(false)

    const trimmed = value.trim()
    if (!trimmed || trimmed.length < 5) return

    setDetecting(true)
    try {
      const type = await detectSourceType(trimmed)
      setDetectedType(type)
    } catch {
      setDetectedType(null)
    } finally {
      setDetecting(false)
    }
  }, [])

  const submitWithAuth = useCallback(
    async (source: string, sourceType: SourceType) => {
      const l402 = await getL402()
      const headers: Record<string, string> = {}
      if (l402) headers["Authorization"] = l402

      await api.post(
        "/radar",
        { source, source_type: sourceType },
        headers
      )
    },
    []
  )

  const handleSubmit = useCallback(async () => {
    const trimmed = sourceUrl.trim()
    if (!trimmed || !detectedType) return

    setSubmitting(true)
    setError("")
    try {
      await submitWithAuth(trimmed, detectedType)
      setSuccess(true)
      setTimeout(() => {
        setSourceUrl("")
        setDetectedType(null)
        setSuccess(false)
        setPrice(null)
        close()
      }, 1200)
    } catch (err: unknown) {
      // Handle 402 — need payment
      if (err instanceof Response && err.status === 402) {
        try {
          await payL402(setBudget)

          // Retry after payment
          await submitWithAuth(trimmed, detectedType)
          setSuccess(true)
          setTimeout(() => {
            setSourceUrl("")
            setDetectedType(null)
            setSuccess(false)
            setPrice(null)
            close()
          }, 1200)
        } catch {
          setError("Payment failed or was cancelled.")
        }
      } else {
        setError("Failed to add content. Try again.")
      }
    } finally {
      setSubmitting(false)
    }
  }, [sourceUrl, detectedType, close, setBudget, submitWithAuth])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        close()
        setSourceUrl("")
        setDetectedType(null)
        setSuccess(false)
        setError("")
        setPrice(null)
      }
    },
    [close]
  )

  const formattedBudget = budget !== null ? budget.toLocaleString() : "--"

  return (
    <Dialog open={activeModal === "addContent"} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg tracking-wide">
            Add Content
          </DialogTitle>
          <DialogDescription>
            Paste a URL and we&apos;ll detect the source type automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="relative z-10 space-y-4 pt-2">
          {/* URL Input */}
          <div className="relative">
            <LinkIcon className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={sourceUrl}
              onChange={(e) => handleDetect(e.target.value)}
              placeholder="Paste URL, Twitter handle, RSS feed..."
              maxLength={MAX_LENGTHS.SOURCE_URL}
              className="h-10 w-full rounded-md border border-border/50 bg-muted/50 pl-9 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
            />
            {detecting && (
              <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Detected type badge */}
          {detectedType && !detecting && (
            <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 animate-fade-in-up">
              <div className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_4px_oklch(0.72_0.14_200/0.5)]" />
              <span className="text-xs text-primary font-medium">
                Detected: {SOURCE_TYPE_LABELS[detectedType] ?? detectedType}
              </span>
            </div>
          )}

          {/* Cost & Budget */}
          {detectedType && price !== null && price > 0 && (
            <>
              <Separator className="bg-border/30" />
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Zap className="h-3 w-3 text-amber" />
                  <span>Cost</span>
                </div>
                <span className="font-mono text-foreground">
                  {price} sats
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Budget</span>
                <span className="font-mono text-foreground">
                  {formattedBudget} sats
                </span>
              </div>
            </>
          )}

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !detectedType || !sourceUrl.trim()}
              className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {success ? (
                <>
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Added
                </>
              ) : submitting ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Adding...
                </>
              ) : price && price > 0 ? (
                <>
                  <Zap className="mr-1.5 h-3.5 w-3.5" />
                  Pay & Add
                </>
              ) : (
                "Add Source"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
