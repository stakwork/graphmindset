"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { SelectCustom } from "@/components/ui/select-custom"
import { useModalStore } from "@/stores/modal-store"
import { useSchemaStore } from "@/stores/schema-store"
import { createEdge } from "@/lib/graph-api"

type Status = "idle" | "submitting" | "success" | "error"

export function AddEdgeModal() {
  const activeModal = useModalStore((s) => s.activeModal)
  const sourceRefId = useModalStore((s) => s.sourceRefId)
  const close = useModalStore((s) => s.close)

  const schemaEdges = useSchemaStore((s) => s.edges)

  const [sourceVal, setSourceVal] = useState("")
  const [targetVal, setTargetVal] = useState("")
  const [edgeType, setEdgeType] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const isOpen = activeModal === "addEdge"

  // Sync sourceVal when modal opens with a pre-filled sourceRefId
  useEffect(() => {
    if (isOpen) {
      setSourceVal(sourceRefId ?? "")
      setTargetVal("")
      setEdgeType("")
      setStatus("idle")
      setErrorMsg(null)
    }
  }, [isOpen, sourceRefId])

  // Derive unique edge types excluding CHILD_OF, computed once when modal opens
  const edgeTypeOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: { value: string; label: string }[] = []
    for (const e of schemaEdges) {
      if (e.edge_type && e.edge_type !== "CHILD_OF" && !seen.has(e.edge_type)) {
        seen.add(e.edge_type)
        options.push({ value: e.edge_type, label: e.edge_type })
      }
    }
    return options.sort((a, b) => a.label.localeCompare(b.label))
  }, [schemaEdges])

  const handleClose = useCallback(() => {
    setSourceVal("")
    setTargetVal("")
    setEdgeType("")
    setStatus("idle")
    setErrorMsg(null)
    close()
  }, [close])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      if (!sourceVal.trim() || !targetVal.trim() || !edgeType) {
        setErrorMsg("All three fields are required.")
        return
      }

      setStatus("submitting")
      setErrorMsg(null)

      try {
        await createEdge({
          source: sourceVal.trim(),
          target: targetVal.trim(),
          edge_type: edgeType,
        })
        setStatus("success")
        setTimeout(() => handleClose(), 1500)
      } catch (err) {
        setStatus("error")
        if (err instanceof Response) {
          const body = await err.json().catch(() => null) as { message?: string; error?: string } | null
          setErrorMsg(body?.message || body?.error || `Request failed (HTTP ${err.status})`)
        } else if (err instanceof Error) {
          setErrorMsg(err.message || "Something went wrong. Please try again.")
        } else {
          setErrorMsg("Something went wrong. Please try again.")
        }
      }
    },
    [sourceVal, targetVal, edgeType, handleClose]
  )

  const busy = status === "submitting" || status === "success"

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg tracking-wide">
            Add Edge
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Create a relationship between two graph nodes.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="relative z-10 space-y-4 pt-2">
          {/* Source ref_id */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
              Source ref_id <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={sourceVal}
              onChange={(e) => { setSourceVal(e.target.value); setErrorMsg(null) }}
              placeholder="Source node ref_id"
              disabled={busy}
              className="h-10 w-full rounded-md border border-border/50 bg-muted/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none disabled:opacity-50"
            />
          </div>

          {/* Target ref_id */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
              Target ref_id <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={targetVal}
              onChange={(e) => { setTargetVal(e.target.value); setErrorMsg(null) }}
              placeholder="Target node ref_id"
              disabled={busy}
              className="h-10 w-full rounded-md border border-border/50 bg-muted/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none disabled:opacity-50"
            />
          </div>

          {/* Edge type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
              Edge type <span className="text-destructive">*</span>
            </label>
            {edgeTypeOptions.length === 0 ? (
              <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                No edge types available. Load schemas first.
              </div>
            ) : (
              <SelectCustom
                value={edgeType}
                onChange={(v) => { setEdgeType(v); setErrorMsg(null) }}
                options={edgeTypeOptions}
                placeholder="Choose an edge type..."
              />
            )}
          </div>

          {/* Error */}
          {errorMsg && (
            <p className="text-xs text-destructive">{errorMsg}</p>
          )}

          {/* Success */}
          {status === "success" && (
            <div className="flex items-center gap-2 text-xs text-green-500">
              <CheckCircle className="h-4 w-4" />
              Edge created!
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end pt-1">
            <Button
              type="submit"
              disabled={busy}
              className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {status === "submitting" ? "Creating..." : status === "success" ? "Created!" : "Add Edge"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
