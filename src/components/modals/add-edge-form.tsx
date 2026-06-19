"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SelectCustom } from "@/components/ui/select-custom"
import { NodeSearchInput } from "@/components/ui/node-search-input"
import { useModalStore } from "@/stores/modal-store"
import { useSchemaStore } from "@/stores/schema-store"
import { useUserStore } from "@/stores/user-store"
import { getPrice, payL402 } from "@/lib/sphinx"
import { createEdge, type GraphNode } from "@/lib/graph-api"
import { displayNodeType } from "@/lib/utils"

type Status = "idle" | "submitting" | "success" | "error"

interface EdgeField {
  key: string
  type: string
  required: boolean
}

// Schema-config keys that live alongside real attribute definitions on an edge
// schema but are NOT user-editable instance properties — skip them when
// building the property form.
const EDGE_META_KEYS = new Set([
  "display_name",
  "cardinality",
  "volatility",
  "decay_curve",
  "temporal",
  "half_life",
  "allow_hard_ttl",
])

// Turn an edge schema's `attributes` map ({ since: "?datetime", role: "string" })
// into renderable form fields. A leading "?" marks the attribute optional.
function parseEdgeFields(attrs: Record<string, string> | undefined): EdgeField[] {
  if (!attrs) return []
  return Object.entries(attrs)
    .filter(([k, v]) => !EDGE_META_KEYS.has(k) && typeof v === "string")
    .map(([key, v]) => ({
      key,
      type: v.startsWith("?") ? v.slice(1) : v,
      required: !v.startsWith("?"),
    }))
}

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
  // When on, the user types a brand-new relationship type instead of picking a
  // schema-defined one; the backend auto-creates the edge schema for it
  // (create_schema_if_missing). This is how edges are added without being tied
  // to the existing ontology.
  const [customMode, setCustomMode] = useState(false)
  // Property values keyed by attribute name (schema-driven fields).
  const [edgeData, setEdgeData] = useState<Record<string, string>>({})
  // Free-form key/value rows, used for custom types or schema edges that
  // define no attributes. Each row carries a stable id for React keys.
  const [customRows, setCustomRows] = useState<
    { id: string; key: string; value: string }[]
  >([])
  const rowIdRef = useRef(0)
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Derive unique edge types valid for the selected source/target node types.
  //
  // Edge schemas are directional (source_type -> target_type) and the backend
  // validates the chosen edge_type against the *specific* source/target node
  // types (get_schema_edge_by_edge_type). Offering every edge type regardless
  // of the picked nodes lets a user select e.g. FOUND_AT for a pair it isn't
  // defined for, which the backend then rejects with "Invalid edge type". So we
  // filter to the types whose schema endpoints match the selected nodes,
  // honouring the "*" wildcard. An unselected endpoint imposes no constraint.
  // (Match on source_type/target_type — `source`/`target` are schema ref_ids.)
  const srcType = selectedSource?.node_type
  const tgtType = selectedTarget?.node_type
  const matchesPair = useCallback(
    (e: { source_type?: string; target_type?: string }) => {
      const ok = (schemaType: string | undefined, selected: string | undefined) =>
        !selected || schemaType === "*" || schemaType === selected
      return ok(e.source_type, srcType) && ok(e.target_type, tgtType)
    },
    [srcType, tgtType]
  )
  const edgeTypeOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: { value: string; label: string }[] = []
    for (const e of schemaEdges) {
      if (!e.edge_type || e.edge_type === "CHILD_OF") continue
      if (!matchesPair(e)) continue
      if (seen.has(e.edge_type)) continue
      seen.add(e.edge_type)
      options.push({ value: e.edge_type, label: e.edge_type })
    }
    return options.sort((a, b) => a.label.localeCompare(b.label))
  }, [schemaEdges, matchesPair])

  // Attribute fields for the currently selected (schema) edge type, scoped to
  // the chosen source/target pair so we read the right schema definition.
  const edgeFields = useMemo(() => {
    if (customMode || !edgeType) return []
    const match = schemaEdges.find(
      (e) => e.edge_type === edgeType && matchesPair(e)
    )
    return parseEdgeFields(match?.attributes)
  }, [schemaEdges, edgeType, customMode, matchesPair])

  // Reset entered properties whenever the field set changes (edge type / nodes
  // changed, or toggled custom mode) so stale values don't leak across types.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setEdgeData({})
    setCustomRows([])
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [edgeType, customMode])

  // Whether to show the free-form key/value editor instead of schema fields:
  // custom (off-schema) types, or schema types that declare no attributes.
  const useFreeForm = !!edgeType && (customMode || edgeFields.length === 0)

  // Clear a previously chosen edge type once it's no longer valid for the
  // currently selected node types (e.g. the user changed a node afterwards).
  // Skipped in custom mode, where a free-typed value is intentionally off-schema.
  useEffect(() => {
    if (!customMode && edgeType && !edgeTypeOptions.some((o) => o.value === edgeType)) {
      // Pruning a now-invalid selection back to the resting empty state — a
      // sync with the derived options list, not a cascading render.
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setEdgeType("")
    }
  }, [edgeTypeOptions, edgeType, customMode])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      if (!selectedSource || !selectedTarget || !edgeType) {
        setErrorMsg("All three fields are required.")
        return
      }

      // Assemble optional edge properties from whichever editor is active.
      const edge_data: Record<string, string> = {}
      if (useFreeForm) {
        for (const row of customRows) {
          const k = row.key.trim()
          if (k) edge_data[k] = row.value
        }
      } else {
        const missing = edgeFields.filter(
          (f) => f.required && !(edgeData[f.key] ?? "").trim()
        )
        if (missing.length > 0) {
          setErrorMsg(
            `Missing required ${missing.length === 1 ? "property" : "properties"}: ${missing
              .map((m) => m.key)
              .join(", ")}`
          )
          return
        }
        for (const f of edgeFields) {
          const v = (edgeData[f.key] ?? "").trim()
          if (v) edge_data[f.key] = v
        }
      }

      const doCreate = async () => {
        await createEdge({
          source: selectedSource.ref_id,
          target: selectedTarget.ref_id,
          edge_type: edgeType,
          ...(Object.keys(edge_data).length > 0 ? { edge_data } : {}),
          // Opt in to schema-on-write only for free-typed types. Existing
          // schema types don't need it (the schema already exists).
          ...(customMode ? { create_schema_if_missing: true } : {}),
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
            // Couldn't settle the invoice (e.g. not enough sats). Surface the
            // top-up overlay and re-enable the form so the user can retry once
            // funded — leaving status as "submitting" would wedge the button on
            // "Creating…" with no way forward.
            setStatus("idle")
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
    [
      selectedSource,
      selectedTarget,
      edgeType,
      customMode,
      useFreeForm,
      edgeFields,
      edgeData,
      customRows,
      close,
      openModal,
      setBudget,
    ]
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
        <div className="flex items-center justify-between">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
            Edge type <span className="text-destructive">*</span>
          </label>
          <button
            type="button"
            onClick={() => { setCustomMode((m) => !m); setEdgeType(""); setErrorMsg(null) }}
            disabled={busy}
            className="text-[10px] text-primary hover:underline disabled:opacity-50"
          >
            {customMode ? "Choose from schema" : "+ Custom type"}
          </button>
        </div>
        {customMode ? (
          <>
            <input
              type="text"
              value={edgeType}
              onChange={(e) => {
                // Match the backend's normalization: upper-case, spaces -> _
                setEdgeType(e.target.value.toUpperCase().replace(/\s+/g, "_"))
                setErrorMsg(null)
              }}
              placeholder="e.g. FOUND_AT"
              disabled={busy}
              className="w-full rounded-md border border-border/50 bg-muted/50 h-10 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-[10px] text-muted-foreground">
              A new relationship type will be added to the schema for this node pair.
            </p>
          </>
        ) : edgeTypeOptions.length === 0 ? (
          <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {schemaEdges.length === 0
              ? "No edge types available. Load schemas first."
              : selectedSource && selectedTarget
                ? `No relationships defined from ${displayNodeType(selectedSource.node_type)} to ${displayNodeType(selectedTarget.node_type)}. Use “+ Custom type” to add one.`
                : "No relationship types match the selected node type."}
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

      {/* Edge properties */}
      {edgeType && !useFreeForm && edgeFields.length > 0 && (
        <div className="flex flex-col gap-2">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
            Properties
          </label>
          {edgeFields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground">
                {f.key}
                {f.required && <span className="text-destructive"> *</span>}
                <span className="ml-1 opacity-60">({f.type})</span>
              </span>
              <input
                type="text"
                value={edgeData[f.key] ?? ""}
                onChange={(e) => {
                  const v = e.target.value
                  setEdgeData((d) => ({ ...d, [f.key]: v }))
                  setErrorMsg(null)
                }}
                placeholder={f.type}
                disabled={busy}
                className="w-full rounded-md border border-border/50 bg-muted/50 h-9 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          ))}
        </div>
      )}

      {/* Free-form properties (custom types or schema types with no attributes) */}
      {edgeType && useFreeForm && (
        <div className="flex flex-col gap-2">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
            Properties <span className="opacity-60">(optional)</span>
          </label>
          {customRows.map((row, i) => (
            <div key={row.id} className="flex items-center gap-2">
              <input
                type="text"
                value={row.key}
                onChange={(e) => {
                  const v = e.target.value
                  setCustomRows((rows) =>
                    rows.map((r, j) => (j === i ? { ...r, key: v } : r))
                  )
                  setErrorMsg(null)
                }}
                placeholder="key"
                disabled={busy}
                className="w-1/3 rounded-md border border-border/50 bg-muted/50 h-9 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
              <input
                type="text"
                value={row.value}
                onChange={(e) => {
                  const v = e.target.value
                  setCustomRows((rows) =>
                    rows.map((r, j) => (j === i ? { ...r, value: v } : r))
                  )
                  setErrorMsg(null)
                }}
                placeholder="value"
                disabled={busy}
                className="flex-1 rounded-md border border-border/50 bg-muted/50 h-9 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setCustomRows((rows) => rows.filter((_, j) => j !== i))}
                disabled={busy}
                className="shrink-0 rounded p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
                aria-label="Remove property"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setCustomRows((rows) => [
                ...rows,
                { id: `r${rowIdRef.current++}`, key: "", value: "" },
              ])
            }
            disabled={busy}
            className="flex items-center gap-1 self-start text-[10px] text-primary hover:underline disabled:opacity-50"
          >
            <Plus className="h-3 w-3" /> Add property
          </button>
        </div>
      )}

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
          <span className="font-mono text-xs text-muted-foreground">{price} sats</span>
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
                ? `Add Edge · ${price} sats`
                : "Add Edge"}
        </Button>
      </div>
    </form>
  )
}
