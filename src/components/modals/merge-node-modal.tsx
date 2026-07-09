"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowRight, CheckCircle, Combine, RefreshCw } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { NodeSearchInput } from "@/components/ui/node-search-input"
import { useModalStore } from "@/stores/modal-store"
import { useSchemaStore } from "@/stores/schema-store"
import { useUserStore } from "@/stores/user-store"
import { useGraphStore } from "@/stores/graph-store"
import { mergeNodes, type GraphNode } from "@/lib/graph-api"
import { resolveNodeTitle } from "@/lib/node-display"
import { displayNodeType } from "@/lib/utils"

type Status = "idle" | "submitting" | "success" | "error"

// Human-readable label for the backend's errorCode payload on a 400.
const MERGE_ERROR_MESSAGES: Record<string, string> = {
  "Invalid target": "Pick a node to merge into.",
  "Invalid source": "Nothing to merge.",
  "Unable to merge the same node": "A node can't be merged into itself.",
  "Nodes Already Merged": "These nodes are already merged.",
}

export function MergeNodeModal() {
  const activeModal = useModalStore((s) => s.activeModal)
  const mergeSourceNode = useModalStore((s) => s.mergeSourceNode)
  const close = useModalStore((s) => s.close)
  const isAdmin = useUserStore((s) => s.isAdmin)
  const schemas = useSchemaStore((s) => s.schemas)
  const mergeNodesInStore = useGraphStore((s) => s.mergeNodesInStore)

  const isOpen = activeModal === "mergeNode" && mergeSourceNode !== null && isAdmin

  // The node picked to pair with the anchor. Direction (which one survives) is
  // controlled separately by `keepPicked` so the user can swap without redoing
  // the search.
  const [picked, setPicked] = useState<GraphNode | null>(null)
  const [keepPicked, setKeepPicked] = useState(true)
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Reset transient form state each time the modal (re)opens for a node.
  useEffect(() => {
    if (!isOpen) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setPicked(null)
    setKeepPicked(true)
    setStatus("idle")
    setErrorMsg(null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isOpen, mergeSourceNode?.ref_id])

  const anchor = mergeSourceNode
  // survivor = the node that remains; absorbed = the node folded into it and hidden.
  const survivor = keepPicked ? picked : anchor
  const absorbed = keepPicked ? anchor : picked

  const anchorTitle = useMemo(
    () => (anchor ? resolveNodeTitle(anchor, schemas) : ""),
    [anchor, schemas]
  )
  const survivorTitle = useMemo(
    () => (survivor ? resolveNodeTitle(survivor, schemas) : ""),
    [survivor, schemas]
  )
  const absorbedTitle = useMemo(
    () => (absorbed ? resolveNodeTitle(absorbed, schemas) : ""),
    [absorbed, schemas]
  )

  const sameNode = !!picked && !!anchor && picked.ref_id === anchor.ref_id
  const canMerge = !!picked && !sameNode && status !== "submitting" && status !== "success"

  const busy = status === "submitting" || status === "success"

  async function handleMerge() {
    if (!anchor || !survivor || !absorbed) return
    if (survivor.ref_id === absorbed.ref_id) {
      setErrorMsg("Pick a different node to merge with.")
      return
    }
    setStatus("submitting")
    setErrorMsg(null)
    try {
      const from = [absorbed.ref_id]
      const to = survivor.ref_id
      const res = await mergeNodes(from, to)
      if (res.errorCode || res.status !== "success") {
        setStatus("error")
        setErrorMsg(
          (res.errorCode && MERGE_ERROR_MESSAGES[res.errorCode]) ||
            res.errorCode ||
            "Merge failed. Please try again."
        )
        return
      }
      // Reflect the merge in the live graph so edges re-point and the absorbed
      // node disappears without a refetch.
      mergeNodesInStore(from, to)
      setStatus("success")
      setTimeout(() => close(), 1200)
    } catch (err) {
      setStatus("error")
      if (err instanceof Response) {
        const body = (await err.json().catch(() => null)) as
          | { errorCode?: string; error?: string; message?: string }
          | null
        const code = body?.errorCode
        setErrorMsg(
          (code && MERGE_ERROR_MESSAGES[code]) ||
            code ||
            body?.error ||
            body?.message ||
            `Merge failed (HTTP ${err.status}).`
        )
      } else if (err instanceof Error) {
        setErrorMsg(err.message || "Merge failed. Please try again.")
      } else {
        setErrorMsg("Merge failed. Please try again.")
      }
    }
  }

  if (!isOpen || !anchor) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg tracking-wide flex items-center gap-2">
            <Combine className="h-4 w-4 text-primary" />
            Merge Nodes
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Fold one node into another. Edges move to the surviving node; the
            other is hidden and aliased to it. This can’t be undone here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Anchor node (the one the merge was started from) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
              This node
            </label>
            <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2">
              <p className="text-sm text-foreground truncate">{anchorTitle}</p>
              <p className="text-[10px] text-muted-foreground">
                {displayNodeType(anchor.node_type)}
              </p>
            </div>
          </div>

          {/* Target picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
              Merge with <span className="text-destructive">*</span>
            </label>
            <NodeSearchInput
              value={picked}
              onChange={(node) => {
                setPicked(node)
                setErrorMsg(null)
                if (status === "error") setStatus("idle")
              }}
              placeholder="Search for a node…"
              disabled={busy}
            />
            {sameNode && (
              <p className="text-[10px] text-destructive">
                Pick a different node — a node can’t merge into itself.
              </p>
            )}
          </div>

          {/* Direction summary + swap */}
          {picked && !sameNode && (
            <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-muted-foreground line-through">
                  {absorbedTitle}
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {survivorTitle}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">
                  <span className="font-medium text-foreground">{survivorTitle}</span>{" "}
                  survives · <span className="line-through">{absorbedTitle}</span> is
                  absorbed
                </p>
                <button
                  type="button"
                  onClick={() => setKeepPicked((v) => !v)}
                  disabled={busy}
                  className="flex items-center gap-1 text-[10px] text-primary hover:underline disabled:opacity-50"
                >
                  <RefreshCw className="h-3 w-3" />
                  Swap
                </button>
              </div>
            </div>
          )}

          {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}

          {status === "success" && (
            <div className="flex items-center gap-2 text-xs text-green-500">
              <CheckCircle className="h-4 w-4" />
              Nodes merged.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="-mx-4 -mb-4 flex items-center gap-3 rounded-b-xl border-t border-border/50 bg-muted/30 px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {picked && !sameNode ? "Ready to merge" : "Pick a node to merge with"}
          </span>
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            onClick={() => close()}
            className="text-xs"
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleMerge}
            disabled={!canMerge}
            className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {status === "submitting"
              ? "Merging…"
              : status === "success"
                ? "Merged!"
                : "Merge"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
