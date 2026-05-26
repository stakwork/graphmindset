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
import { NodeSearchInput } from "@/components/ui/node-search-input"
import { useModalStore } from "@/stores/modal-store"
import { useSchemaStore } from "@/stores/schema-store"
import { createEdge, type GraphNode } from "@/lib/graph-api"

type Status = "idle" | "submitting" | "success" | "error"

export function AddEdgeModal() {
  const activeModal = useModalStore((s) => s.activeModal)
  const storeSourceNode = useModalStore((s) => s.sourceNode)
  const close = useModalStore((s) => s.close)

  const schemaEdges = useSchemaStore((s) => s.edges)

  const [selectedSource, setSelectedSource] = useState<GraphNode | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<GraphNode | null>(null)
  const [edgeType, setEdgeType] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const isOpen = activeModal === "addEdge"

  // Sync selectedSource when modal opens with a pre-filled sourceNode
  useEffect(() => {
    if (isOpen) {
      setSelectedSource(storeSourceNode ?? null)
      setSelectedTarget(null)
      setEdgeType("")
      setStatus("idle")
      setErrorMsg(null)
    }
  }, [isOpen, storeSourceNode])

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
    setSelectedSource(null)
    setSelectedTarget(null)
    setEdgeType("")
    setStatus("idle")
    setErrorMsg(null)
    close()
  }, [close])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      if (!selectedSource || !selectedTarget || !edgeType) {
        setErrorMsg("All three fields are required.")
        return
      }

      setStatus("submitting")
      setErrorMsg(null)

      try {
        await createEdge({
          source: selectedSource.ref_id,
          target: selectedTarget.ref_id,
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
    [selectedSource, selectedTarget, edgeType, handleClose]
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
          {/* Source node */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
              Source node <span className="text-destructive">*</span>
            </label>
            <NodeSearchInput
              value={selectedSource}
              onChange={(node) => { setSelectedSource(node); setErrorMsg(null) }}
              placeholder="Search source node…"
              disabled={busy}
            />
          </div>

          {/* Target node */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
              Target node <span className="text-destructive">*</span>
            </label>
            <NodeSearchInput
              value={selectedTarget}
              onChange={(node) => { setSelectedTarget(node); setErrorMsg(null) }}
              placeholder="Search target node…"
              disabled={busy}
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
