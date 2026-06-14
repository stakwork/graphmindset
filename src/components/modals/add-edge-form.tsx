"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SelectCustom } from "@/components/ui/select-custom"
import { NodeSearchInput } from "@/components/ui/node-search-input"
import { useModalStore } from "@/stores/modal-store"
import { useSchemaStore } from "@/stores/schema-store"
import { useUserStore } from "@/stores/user-store"
import { getPrice, payL402 } from "@/lib/sphinx"
import { createEdge, type GraphNode } from "@/lib/graph-api"

type Status = "idle" | "submitting" | "success" | "error"

export function AddEdgeForm() {
  const storeSourceNode = useModalStore((s) => s.sourceNode)
  const close = useModalStore((s) => s.close)
  const openModal = useModalStore((s) => s.open)
  const setBudget = useUserStore((s) => s.setBudget)

  const schemaEdges = useSchemaStore((s) => s.edges)

  const [price, setPrice] = useState<number | null>(null)

  // Fetch the edge-creation price on mount so we can show the cost up front.
  useEffect(() => {
    const controller = new AbortController()
    getPrice("v2/edges", "post", controller.signal)
      .then(setPrice)
      .catch(() => setPrice(null))
    return () => controller.abort()
  }, [])

  // Seed the source from a deep-link (e.g. "Add Edge" off a node). The form
  // mounts fresh each time the Edge tab opens, so a lazy initializer captures
  // the store's sourceNode without an effect.
  const [selectedSource, setSelectedSource] = useState<GraphNode | null>(
    () => storeSourceNode ?? null
  )
  const [selectedTarget, setSelectedTarget] = useState<GraphNode | null>(null)
  const [edgeType, setEdgeType] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Derive unique edge types excluding CHILD_OF
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

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      if (!selectedSource || !selectedTarget || !edgeType) {
        setErrorMsg("All three fields are required.")
        return
      }

      const doCreate = async () => {
        await createEdge({
          source: selectedSource.ref_id,
          target: selectedTarget.ref_id,
          edge_type: edgeType,
        })
        setStatus("success")
        setTimeout(() => close(), 1500)
      }

      setStatus("submitting")
      setErrorMsg(null)

      try {
        await doCreate()
      } catch (err) {
        // Paid action: on 402 settle the L402 invoice and retry. If payment
        // fails (e.g. not enough sats), surface the budget/top-up bar — same
        // flow as Add Content.
        if (err instanceof Response && err.status === 402) {
          try {
            await payL402(setBudget)
            await doCreate()
          } catch {
            openModal("budget")
          }
          return
        }
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
    [selectedSource, selectedTarget, edgeType, close, openModal, setBudget]
  )

  const busy = status === "submitting" || status === "success"
  const edgeReady = !!(selectedSource && selectedTarget && edgeType)

  return (
    <form onSubmit={handleSubmit} className="relative z-10 space-y-4 pt-1">
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
            searchable
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

      {/* Footer — contextual status hint + actions, bled to the modal edges */}
      <div className="-mx-4 -mb-4 mt-1 flex items-center gap-3 rounded-b-xl border-t border-border/50 bg-muted/30 px-4 py-3">
        <span className="text-xs text-muted-foreground">
          {edgeReady ? "Ready to create" : "Pick both nodes and a relationship"}
        </span>
        <span className="flex-1" />
        {price !== null && price > 0 && (
          <span className="font-mono text-xs text-muted-foreground">{price} bullets</span>
        )}
        <Button type="button" variant="ghost" onClick={() => close()} className="text-xs" disabled={busy}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={busy}
          className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {status === "submitting"
            ? "Creating..."
            : status === "success"
              ? "Created!"
              : price && price > 0
                ? `Add Edge · ${price} bullets`
                : "Add Edge"}
        </Button>
      </div>
    </form>
  )
}
