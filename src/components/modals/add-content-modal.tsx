"use client"

import { useCallback, useState } from "react"
import { Loader2, CheckCircle2, LinkIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useModalStore } from "@/stores/modal-store"
import { api } from "@/lib/api"
import {
  detectSourceType,
  SOURCE_TYPE_LABELS,
  type SourceType,
} from "@/lib/source-detection"

export function AddContentModal() {
  const { activeModal, close } = useModalStore()
  const [sourceUrl, setSourceUrl] = useState("")
  const [detectedType, setDetectedType] = useState<SourceType | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")

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

  const handleSubmit = useCallback(async () => {
    const trimmed = sourceUrl.trim()
    if (!trimmed || !detectedType) return

    setSubmitting(true)
    setError("")
    try {
      await api.post("/radar", {
        source: trimmed,
        source_type: detectedType,
      })
      setSuccess(true)
      setTimeout(() => {
        setSourceUrl("")
        setDetectedType(null)
        setSuccess(false)
        close()
      }, 1200)
    } catch {
      setError("Failed to add content. Try again.")
    } finally {
      setSubmitting(false)
    }
  }, [sourceUrl, detectedType, close])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        close()
        setSourceUrl("")
        setDetectedType(null)
        setSuccess(false)
        setError("")
      }
    },
    [close]
  )

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
          <div className="space-y-2">
            <div className="relative">
              <LinkIcon className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={sourceUrl}
                onChange={(e) => handleDetect(e.target.value)}
                placeholder="Paste URL, Twitter handle, RSS feed..."
                className="h-10 w-full rounded-md border border-border/50 bg-muted/50 pl-9 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
              />
              {detecting && (
                <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>
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
