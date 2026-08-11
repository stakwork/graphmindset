"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { SelectNative } from "@/components/ui/select-native"
import {
  SCHEMA_ATTRIBUTE_TYPES,
  getSchemaProposal,
  type SchemaAttributeType,
  type SchemaProposal,
  type SchemaTypeOverride,
} from "@/lib/graph-api"
import { cn } from "@/lib/utils"

/**
 * A row in the editable property table.
 *
 * `origin` distinguishes properties inferred from the parked payloads from ones
 * the admin added by hand — an added property has no sample and no presence
 * count, and excluding an inferred one drops it from the replayed payload.
 */
interface PropertyRow {
  id: string
  name: string
  type: SchemaAttributeType
  required: boolean
  included: boolean
  origin: "inferred" | "added"
  presentIn?: number
  sample?: unknown
}

function formatSample(sample: unknown): string {
  if (sample === null || sample === undefined) return "—"
  if (typeof sample === "string") return sample
  return JSON.stringify(sample)
}

/** A short, stable label for a parked node: its payload name, else its ref_id. */
function entryLabel(name: string | null, refId: string): string {
  return name?.trim() || `${refId.slice(0, 8)}…`
}

/**
 * The subgraph this approval touches: which nodes, and how they are joined.
 *
 * Without this the dialog shows only aggregate property counts ("5 parked
 * entries"), so an admin cannot tell whether approving yields a connected graph
 * or a fragment. The one-ended edges are the point: their other side stays
 * parked, so they are NOT replayed now and the promoted nodes come out
 * disconnected from them until that side is approved too.
 */
function SubgraphPreview({ proposal }: { proposal: SchemaProposal }) {
  const joined = proposal.edges.filter((e) => e.both_ends_in_review)
  const dangling = proposal.edges.filter((e) => !e.both_ends_in_review)

  return (
    <div className="flex flex-col gap-2">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Nodes being promoted ({proposal.entries.length})
      </div>
      <div className="flex flex-wrap gap-1.5">
        {proposal.entries.map((entry) => (
          <span
            key={entry.ref_id}
            title={entry.ref_id}
            className="rounded border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[11px]"
          >
            {entryLabel(entry.name, entry.ref_id)}
          </span>
        ))}
      </div>

      {proposal.edges.length > 0 && (
        <>
          <div className="mt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Relationships ({joined.length} promoted
            {dangling.length > 0 ? `, ${dangling.length} left parked` : ""})
          </div>
          <div className="flex flex-col gap-1">
            {joined.map((edge) => (
              <div
                key={edge.ref_id}
                className="flex flex-wrap items-center gap-1.5 text-[11px]"
              >
                <span className="font-mono">
                  {entryLabel(edge.source_name, edge.source_ref_id)}
                </span>
                <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-px font-mono text-[10px] text-emerald-400">
                  {edge.intended_type ?? "—"}
                </span>
                <span className="font-mono">
                  {entryLabel(edge.target_name, edge.target_ref_id)}
                </span>
              </div>
            ))}
            {dangling.map((edge) => (
              <div
                key={edge.ref_id}
                className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
                title="The other end is parked under a different type, so this edge stays in the scratchpad until that side is approved."
              >
                <span className="font-mono">
                  {entryLabel(edge.source_name, edge.source_ref_id)}
                </span>
                <span className="rounded border border-border/60 bg-muted/40 px-1.5 py-px font-mono text-[10px]">
                  {edge.intended_type ?? "—"}
                </span>
                <span className="font-mono">
                  {entryLabel(edge.target_name, edge.target_ref_id)}
                </span>
                <span className="text-[10px] italic">still parked</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function rowsFromProposal(proposal: SchemaProposal): PropertyRow[] {
  return proposal.properties.map((p) => ({
    id: p.name,
    name: p.name,
    type: p.inferred_type,
    required: p.suggested_required,
    included: true,
    origin: "inferred" as const,
    presentIn: p.present_in,
    sample: p.sample,
  }))
}

export interface SchemaPromotionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reviewRefId: string
  /** Called with the confirmed override; the caller performs the approve. */
  onConfirm: (override: SchemaTypeOverride) => Promise<void>
  submitting?: boolean
}

export function SchemaPromotionDialog({
  open,
  onOpenChange,
  reviewRefId,
  onConfirm,
  submitting = false,
}: SchemaPromotionDialogProps) {
  // One state object keyed by review so a stale response can never be mistaken
  // for the current one, and loading is derived rather than set synchronously
  // in the effect body (matches the fetch pattern used elsewhere in the app).
  const [fetched, setFetched] = useState<{
    refId: string
    proposal: SchemaProposal | null
    error: string | null
  } | null>(null)

  const [rows, setRows] = useState<PropertyRow[]>([])
  const [nodeKey, setNodeKey] = useState<string>("")
  const [parent, setParent] = useState<string>("Thing")

  // Fetch on open. Aborting on close stops a slow response from landing on top
  // of edits the admin has already started making after re-opening.
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    getSchemaProposal(reviewRefId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setFetched({ refId: reviewRefId, proposal: result, error: null })
        setRows(rowsFromProposal(result))
        setParent("Thing")
        setNodeKey(result.node_key_candidates[0] ?? "")
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setFetched({
          refId: reviewRefId,
          proposal: null,
          error:
            err instanceof Error ? err.message : "Could not load the proposal",
        })
      })
    return () => controller.abort()
  }, [open, reviewRefId])

  const current = fetched?.refId === reviewRefId ? fetched : null
  const proposal = current?.proposal ?? null
  const loadError = current?.error ?? null
  const loading = open && current === null

  const updateRow = useCallback((id: string, patch: Partial<PropertyRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    )
  }, [])

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      {
        id: `added-${prev.length}-${Date.now()}`,
        name: "",
        type: "string",
        required: false,
        included: true,
        origin: "added",
      },
    ])
  }, [])

  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const includedRows = useMemo(() => rows.filter((r) => r.included), [rows])

  // node_key components must be required attributes: an optional component
  // makes every future write of this type fail validation.
  const nodeKeyOptions = useMemo(
    () =>
      includedRows.filter((r) => r.required && r.type === "string" && r.name),
    [includedRows]
  )

  // Derived, not reset via an effect: when the row the selection points at is
  // excluded, renamed, or made optional it simply stops being a valid choice,
  // and submitting a stale value would fail validation server-side.
  const effectiveNodeKey =
    nodeKey && nodeKeyOptions.some((r) => r.name === nodeKey) ? nodeKey : ""

  const validationError = useMemo<string | null>(() => {
    if (!proposal) return null
    if (!proposal.intended_type) return "This review has no intended type"
    const names = includedRows.map((r) => r.name.trim())
    if (names.some((n) => !n)) return "Every included property needs a name"
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i)
    if (duplicates.length > 0) {
      return `Duplicate property name: ${duplicates[0]}`
    }
    const blocked = new Set(proposal.blocked_names.map((b) => b.name))
    const offending = names.find((n) => blocked.has(n))
    if (offending) {
      return `"${offending}" is reserved — rename it`
    }
    if (includedRows.length === 0) {
      return "Include at least one property"
    }
    return null
  }, [proposal, includedRows])

  const droppedNames = useMemo(
    () =>
      rows
        .filter((r) => r.origin === "inferred" && !r.included)
        .map((r) => r.name),
    [rows]
  )

  function handleConfirm() {
    if (!proposal?.intended_type || validationError) return
    const attributes: Record<string, string> = {}
    for (const row of includedRows) {
      attributes[row.name.trim()] = row.required ? row.type : `?${row.type}`
    }
    const override: SchemaTypeOverride = {
      type: proposal.intended_type,
      parent: parent.trim() || "Thing",
      attributes,
      entries: proposal.entry_ref_ids,
    }
    if (effectiveNodeKey) {
      override.node_key = `${proposal.intended_type.toLowerCase()}-${effectiveNodeKey}`
    }
    void onConfirm(override)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-3xl"
        data-testid="schema-promotion-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            Create type{" "}
            <span className="font-mono text-primary">
              {proposal?.intended_type ?? "…"}
            </span>
          </DialogTitle>
          <DialogDescription>
            {proposal
              ? `Confirm the properties this type needs. ${proposal.entry_count} parked ${
                  proposal.entry_count === 1 ? "entry" : "entries"
                } will be replayed as ${
                  proposal.entry_count === 1 ? "a node" : "nodes"
                } of this type.`
              : "Loading the proposed properties…"}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Inferring properties from the parked entries…
          </div>
        )}

        {loadError && (
          <div className="rounded border border-red-500/40 bg-red-500/5 px-3 py-2 text-[12px] text-red-400">
            ✕ {loadError}
          </div>
        )}

        {proposal && !loading && (
          <div className="space-y-3">
            {proposal.conflicts.length > 0 && (
              <div className="flex gap-2 rounded border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  {proposal.conflicts.map((c) => (
                    <div key={c.name}>
                      <span className="font-mono">{c.name}</span> appeared as{" "}
                      {c.types_seen.join(" and ")} — widened to{" "}
                      <span className="font-mono">{c.resolved_to}</span>.
                    </div>
                  ))}
                </div>
              </div>
            )}

            {proposal.blocked_names.length > 0 && (
              <div className="flex gap-2 rounded border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  {proposal.blocked_names.map((b) => (
                    <div key={b.name}>
                      <span className="font-mono">{b.name}</span> cannot be used:{" "}
                      {b.reason}.
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/40">
                    <th className="w-8 py-1.5 text-left font-medium">Use</th>
                    <th className="py-1.5 text-left font-medium">Property</th>
                    <th className="w-32 py-1.5 text-left font-medium">Type</th>
                    <th className="w-20 py-1.5 text-left font-medium">
                      Required
                    </th>
                    <th className="py-1.5 text-left font-medium">Sample</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className={cn(
                        "border-b border-border/20 last:border-b-0",
                        !row.included && "opacity-40"
                      )}
                    >
                      <td className="py-1.5">
                        <Checkbox
                          checked={row.included}
                          onChange={(next) =>
                            updateRow(row.id, { included: next })
                          }
                          ariaLabel={`Include ${row.name || "new property"}`}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        {row.origin === "added" ? (
                          <Input
                            value={row.name}
                            placeholder="property_name"
                            className="h-7 text-[12px]"
                            onChange={(e) =>
                              updateRow(row.id, { name: e.target.value })
                            }
                          />
                        ) : (
                          <span className="font-mono">{row.name}</span>
                        )}
                        {row.origin === "inferred" &&
                          row.presentIn !== undefined &&
                          row.presentIn < proposal.entry_count && (
                            <span className="ml-2 text-muted-foreground">
                              in {row.presentIn}/{proposal.entry_count}
                            </span>
                          )}
                      </td>
                      <td className="py-1.5 pr-2">
                        <SelectNative
                          value={row.type}
                          options={SCHEMA_ATTRIBUTE_TYPES.map((t) => ({
                            value: t,
                            label: t,
                          }))}
                          onChange={(e) =>
                            updateRow(row.id, {
                              type: e.target.value as SchemaAttributeType,
                            })
                          }
                          className="h-7 text-[12px]"
                        />
                      </td>
                      <td className="py-1.5">
                        <Checkbox
                          checked={row.required}
                          onChange={(next) =>
                            updateRow(row.id, { required: next })
                          }
                          ariaLabel={`${row.name || "New property"} required`}
                        />
                      </td>
                      <td className="max-w-[180px] truncate py-1.5 font-mono text-muted-foreground">
                        {row.origin === "added"
                          ? "—"
                          : formatSample(row.sample)}
                      </td>
                      <td className="py-1.5">
                        {row.origin === "added" && (
                          <button
                            type="button"
                            onClick={() => removeRow(row.id)}
                            className="text-muted-foreground transition-colors hover:text-red-400"
                            aria-label={`Remove ${row.name || "new property"}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1 text-[12px] text-primary transition-colors hover:text-primary/80"
            >
              <Plus className="h-3.5 w-3.5" />
              Add property
            </button>

            <div className="grid grid-cols-2 gap-3 border-t border-border/40 pt-3">
              <label className="space-y-1">
                <span className="text-[12px] text-muted-foreground">Parent</span>
                <Input
                  value={parent}
                  onChange={(e) => setParent(e.target.value)}
                  className="h-7 text-[12px]"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[12px] text-muted-foreground">
                  Identity property (node key)
                </span>
                <SelectNative
                  value={effectiveNodeKey}
                  placeholder="None"
                  options={nodeKeyOptions.map((r) => ({
                    value: r.name,
                    label: r.name,
                  }))}
                  onChange={(e) => setNodeKey(e.target.value)}
                  className="h-7 text-[12px]"
                />
              </label>
            </div>

            <div className="rounded border border-border/60 bg-muted/20 p-2.5">
              <SubgraphPreview proposal={proposal} />
            </div>

            {droppedNames.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Excluded from the type, and dropped when the parked entries are
                replayed: {droppedNames.join(", ")}
              </p>
            )}

            {proposal.unresolved_subject_ids.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {proposal.unresolved_subject_ids.length} of this review&apos;s
                subjects are no longer parked entries and will be skipped.
              </p>
            )}

            {validationError && (
              <div className="text-[12px] font-medium text-red-400">
                ✕ {validationError}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              !proposal || loading || validationError !== null || submitting
            }
            data-testid="schema-promotion-confirm"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                Creating…
              </>
            ) : (
              "Create & promote"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
