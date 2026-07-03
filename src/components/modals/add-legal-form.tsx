"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, FileText, Link2, Loader2, Upload, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useModalStore } from "@/stores/modal-store"
import { useAppStore } from "@/stores/app-store"
import { useUserStore } from "@/stores/user-store"
import {
  addLegalDocument,
  addLegalDocumentFile,
  checkNodeExists,
  checkNodeExistsByHash,
  reprocessContent,
} from "@/lib/graph-api"
import { getPrice, payL402 } from "@/lib/sphinx"

type Mode = "url" | "file"

const MAX_PDF_BYTES = 20 * 1024 * 1024 // 20 MB

function isValidUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

async function computeHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export function AddLegalForm() {
  const close = useModalStore((s) => s.close)
  const openModal = useModalStore((s) => s.open)
  const { isAdmin } = useUserStore()
  const ownerReferenceId = useUserStore((s) => s.ownerReferenceId)
  const refreshBalance = useUserStore((s) => s.refreshBalance)

  const [mode, setMode] = useState<Mode>("url")

  // URL mode state
  const [urlValue, setUrlValue] = useState("")

  // File mode state
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Shared state
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")

  // Duplicate detection state
  const [existingNode, setExistingNode] = useState<{ ref_id: string; owner_reference_id: string | null } | null>(null)
  const [contentHash, setContentHash] = useState<string | null>(null)
  const [price, setPrice] = useState<number | null>(null)

  const urlValid = isValidUrl(urlValue.trim())
  const canSubmit = !submitting && !success && !existingNode && (mode === "url" ? urlValid : !!file && !fileError)

  // Fetch price for content submission
  useEffect(() => {
    getPrice("v2/content").then(setPrice)
  }, [])

  // URL mode — check for existing node when URL becomes valid
  useEffect(() => {
    if (!urlValid) {
      setExistingNode(null)
      return
    }
    const controller = new AbortController()
    checkNodeExists("LegalDocument", urlValue.trim(), controller.signal).then((check) => {
      setExistingNode(
        check.exists && check.ref_id
          ? { ref_id: check.ref_id, owner_reference_id: check.owner_reference_id }
          : null
      )
    })
    return () => controller.abort()
  }, [urlValue, urlValid])

  const currentUserOwns = useCallback(
    (nodeRef: string | null) => !!nodeRef && !!ownerReferenceId && nodeRef === ownerReferenceId,
    [ownerReferenceId]
  )

  function handleModeChange(next: Mode) {
    setMode(next)
    setError("")
    setFileError("")
    setExistingNode(null)
    setContentHash(null)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null
    setFileError("")
    setError("")
    setExistingNode(null)
    setContentHash(null)

    if (!selected) {
      setFile(null)
      return
    }

    if (selected.type !== "application/pdf") {
      setFile(null)
      setFileError("Only PDF files are accepted.")
      return
    }

    if (selected.size > MAX_PDF_BYTES) {
      setFile(null)
      setFileError("File exceeds the 20 MB limit.")
      return
    }

    setFile(selected)

    // Compute SHA-256 hash and check for existing node
    try {
      const hash = await computeHash(selected)
      setContentHash(hash)
      const check = await checkNodeExistsByHash("LegalDocument", hash)
      setExistingNode(
        check.exists && check.ref_id
          ? { ref_id: check.ref_id, owner_reference_id: check.owner_reference_id }
          : null
      )
    } catch {
      // Hash computation failed — allow submission to proceed without dedup
    }
  }

  const handleReprocess = useCallback(async () => {
    if (!existingNode) return
    if (!isAdmin && !currentUserOwns(existingNode.owner_reference_id)) return
    setSubmitting(true)
    setError("")
    try {
      const body: Record<string, unknown> =
        mode === "url"
          ? { source_link: urlValue.trim(), content_type: "legal_document" }
          : { content_hash: contentHash, content_type: "legal_document" }
      await reprocessContent(existingNode.ref_id, body)
      setSuccess(true)
      refreshBalance()
      setTimeout(() => {
        setExistingNode(null)
        setSuccess(false)
        close()
        useAppStore.getState().setMyContentOpen(true)
      }, 1200)
    } catch (err) {
      if (err instanceof Response && err.status === 402) {
        try {
          await payL402(useUserStore.getState().setBudget)
          const body: Record<string, unknown> =
            mode === "url"
              ? { source_link: urlValue.trim(), content_type: "legal_document" }
              : { content_hash: contentHash, content_type: "legal_document" }
          await reprocessContent(existingNode.ref_id, body)
          setSuccess(true)
          refreshBalance()
          setTimeout(() => {
            setExistingNode(null)
            setSuccess(false)
            close()
          }, 1200)
        } catch {
          openModal("budget")
        }
      } else {
        setError("Re-process failed. Try again.")
      }
    } finally {
      setSubmitting(false)
    }
  }, [existingNode, mode, urlValue, contentHash, refreshBalance, close, openModal])

  async function handleSubmit() {
    if (!canSubmit) return

    setSubmitting(true)
    setError("")

    try {
      if (mode === "url") {
        await addLegalDocument(urlValue.trim())
      } else {
        await addLegalDocumentFile(file!)
      }

      setSuccess(true)
      setTimeout(() => {
        close()
        useAppStore.getState().setMyContentOpen(true)
      }, 1200)
    } catch (err: unknown) {
      if (err instanceof Response) {
        try {
          const body = await err.json()
          setError(body?.message || "Failed to submit document. Try again.")
        } catch {
          setError("Failed to submit document. Try again.")
        }
      } else {
        setError("Failed to submit document. Try again.")
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative z-10 space-y-4 pt-1">
      {/* Mode segmented control */}
      <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-muted/30 p-1">
        {(["url", "file"] as Mode[]).map((m) => {
          const Icon = m === "url" ? Link2 : Upload
          const label = m === "url" ? "URL" : "File"
          return (
            <button
              key={m}
              type="button"
              onClick={() => handleModeChange(m)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-[13px] font-semibold transition-colors",
                mode === m
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          )
        })}
      </div>

      {/* URL mode */}
      {mode === "url" && (
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
            PDF URL
          </label>
          <div className="relative">
            <Link2 className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="url"
              value={urlValue}
              onChange={(e) => {
                setUrlValue(e.target.value)
                setError("")
              }}
              placeholder="https://example.com/document.pdf"
              className="h-10 w-full rounded-md border border-border/50 bg-muted/50 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* File mode */}
      {mode === "file" && (
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
            PDF File (max 20 MB)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex w-full items-center gap-3 rounded-md border border-dashed border-border/50 bg-muted/30 px-4 py-4 text-sm transition-colors hover:bg-muted/50",
              file ? "border-primary/40 text-foreground" : "text-muted-foreground"
            )}
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate text-left">
              {file ? file.name : "Click to select a PDF file"}
            </span>
            {file && (
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                {(file.size / (1024 * 1024)).toFixed(1)} MB
              </span>
            )}
          </button>
          {fileError && (
            <p className="text-xs text-destructive">{fileError}</p>
          )}
        </div>
      )}

      {/* Already-in-graph yellow callout */}
      {existingNode && !submitting && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 animate-fade-in-up">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <p className="text-xs text-amber-500 font-medium">⚠️ This content is already in the graph</p>
            {(isAdmin || currentUserOwns(existingNode.owner_reference_id)) ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleReprocess}
                disabled={submitting}
                className="h-7 text-[11px] border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
              >
                {submitting ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Zap className="mr-1 h-3 w-3" />
                )}
                {price && price > 0 ? "Pay & Re-process" : "Re-process"}
              </Button>
            ) : (
              <p className="text-[10px] text-muted-foreground">Contact an admin to re-process this content</p>
            )}
          </div>
        </div>
      )}

      {/* API error */}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {/* Footer */}
      <div className="-mx-4 -mb-4 mt-1 flex items-center gap-3 rounded-b-xl border-t border-border/50 bg-muted/30 px-4 py-3">
        <span className="text-xs text-muted-foreground">
          {mode === "url"
            ? urlValid
              ? existingNode
                ? "Already in graph — use Re-process above"
                : "URL looks good — ready to submit"
              : "Enter a valid PDF URL to continue"
            : file
              ? existingNode
                ? "Already in graph — use Re-process above"
                : "File ready — click Add Document"
              : "Select a PDF file to continue"}
        </span>
        <span className="flex-1" />
        <Button variant="ghost" onClick={() => close()} className="text-xs">
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
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
              Adding…
            </>
          ) : (
            "Add Document"
          )}
        </Button>
      </div>
    </div>
  )
}
