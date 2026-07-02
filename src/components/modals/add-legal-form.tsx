"use client"

import { useRef, useState } from "react"
import { CheckCircle2, FileText, Link2, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useModalStore } from "@/stores/modal-store"
import { useAppStore } from "@/stores/app-store"
import { addLegalDocument, addLegalDocumentFile } from "@/lib/graph-api"

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

export function AddLegalForm() {
  const close = useModalStore((s) => s.close)

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

  const urlValid = isValidUrl(urlValue.trim())
  const canSubmit = !submitting && !success && (mode === "url" ? urlValid : !!file && !fileError)

  function handleModeChange(next: Mode) {
    setMode(next)
    setError("")
    setFileError("")
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null
    setFileError("")
    setError("")

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
  }

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

      {/* API error */}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {/* Footer */}
      <div className="-mx-4 -mb-4 mt-1 flex items-center gap-3 rounded-b-xl border-t border-border/50 bg-muted/30 px-4 py-3">
        <span className="text-xs text-muted-foreground">
          {mode === "url"
            ? urlValid
              ? "URL looks good — ready to submit"
              : "Enter a valid PDF URL to continue"
            : file
              ? "File ready — click Add Document"
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
