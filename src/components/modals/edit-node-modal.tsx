"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { X, Check, HelpCircle, AlertCircle } from "lucide-react"
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
import { useGraphStore } from "@/stores/graph-store"
import { useUserStore } from "@/stores/user-store"
import { adminUpdateNode } from "@/lib/graph-api"
import { isMocksEnabled } from "@/lib/mock-data"
import { SYSTEM_ATTRIBUTES, fieldsForSchema } from "@/lib/node-schema-utils"
import {
  computeMappings,
  type ExactMapping,
  type FuzzyMapping,
  type UnmappedField,
} from "@/lib/node-remap"
import type { SchemaNode, SchemaAttribute } from "@/app/ontology/page"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseFieldValue(type: string, raw: string): unknown {
  const t = raw.trim()
  if (t === "") return undefined
  if (type === "int" || type === "integer") {
    const n = Number(t)
    return Number.isFinite(n) ? Math.trunc(n) : t
  }
  if (type === "float" || type === "number") {
    const n = Number(t)
    return Number.isFinite(n) ? n : t
  }
  if (type === "bool" || type === "boolean") {
    return t.toLowerCase() === "true" || t === "1"
  }
  return t
}

function inputTypeFor(attrType: string): string {
  if (attrType === "int" || attrType === "integer" || attrType === "float" || attrType === "number") {
    return "number"
  }
  if (attrType === "datetime") return "datetime-local"
  if (attrType === "date") return "date"
  return "text"
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

// ---------------------------------------------------------------------------
// Sub-component: field input row
// ---------------------------------------------------------------------------
function FieldRow({
  field,
  value,
  onChange,
}: {
  field: SchemaAttribute
  value: string
  onChange: (key: string, val: string) => void
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground font-mono">
        {field.key}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      <input
        type={inputTypeFor(field.type)}
        value={value}
        onChange={(e) => onChange(field.key, e.target.value)}
        placeholder={field.required ? "Required" : "Optional"}
        className={cn(
          "w-full rounded-md border bg-background px-3 py-1.5 text-sm text-foreground",
          "border-border/60 focus:outline-none focus:ring-1 focus:ring-primary/60",
          "placeholder:text-muted-foreground/50"
        )}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function EditNodeModal() {
  const activeModal = useModalStore((s) => s.activeModal)
  const editingNode = useModalStore((s) => s.editingNode)
  const close = useModalStore((s) => s.close)
  const schemas = useSchemaStore((s) => s.schemas)
  const clearSelection = useGraphStore((s) => s.clearSelection)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const isAdmin = useUserStore((s) => s.isAdmin)

  const isOpen = activeModal === "editNode" && editingNode !== null && isAdmin

  // ----- selected type -----
  const [selectedType, setSelectedType] = useState<string>("")
  const originalType = editingNode?.node_type ?? ""

  // ----- Phase A: field values -----
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})

  // ----- Phase B: remap state -----
  // For fuzzy rows: null = pending, true = accepted, false = rejected
  const [fuzzyDecisions, setFuzzyDecisions] = useState<Record<string, boolean | null>>({})
  // For unmapped rows: "" = drop, or new-type field key
  const [unmappedAssignments, setUnmappedAssignments] = useState<Record<string, string>>({})

  // ----- Save state -----
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ----- Schema lookups -----
  const originalSchema = useMemo(
    () => schemas.find((s) => s.type === originalType) ?? null,
    [schemas, originalType]
  )
  const selectedSchema = useMemo(
    () => schemas.find((s) => s.type === selectedType) ?? null,
    [schemas, selectedType]
  )

  // ----- Fields for each schema -----
  const originalFields = useMemo(
    () => (originalSchema ? fieldsForSchema(originalSchema) : []),
    [originalSchema]
  )
  const selectedFields = useMemo(
    () => (selectedSchema ? fieldsForSchema(selectedSchema) : []),
    [selectedSchema]
  )

  // ----- On modal open: initialise state -----
  useEffect(() => {
    if (!isOpen || !editingNode) return

    const type = editingNode.node_type ?? ""
    setSelectedType(type)
    setSaveError(null)

    // Pre-fill field values from node properties
    const schema = schemas.find((s) => s.type === type)
    const initValues: Record<string, string> = {}
    if (schema) {
      for (const field of fieldsForSchema(schema)) {
        initValues[field.key] = stringifyValue(editingNode.properties?.[field.key])
      }
    }
    setFieldValues(initValues)
    setFuzzyDecisions({})
    setUnmappedAssignments({})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // ----- Compute mappings when type changes -----
  const typeChanged = selectedType !== originalType && selectedType !== ""

  const rawMappings = useMemo(() => {
    if (!typeChanged) return null
    const currentValues: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fieldValues)) {
      currentValues[k] = v
    }
    return computeMappings(originalFields, selectedFields, currentValues)
  }, [typeChanged, originalFields, selectedFields, fieldValues])

  // When type changes, reset remap decisions and pre-fill Phase A with new schema fields
  const handleTypeChange = useCallback(
    (newType: string) => {
      setSelectedType(newType)
      setSaveError(null)
      setFuzzyDecisions({})
      setUnmappedAssignments({})

      // Keep existing field values; add empty slots for new schema fields not yet present
      const newSchema = schemas.find((s) => s.type === newType)
      if (!newSchema) return
      setFieldValues((prev) => {
        const next = { ...prev }
        for (const field of fieldsForSchema(newSchema)) {
          if (!(field.key in next)) {
            next[field.key] = ""
          }
        }
        return next
      })
    },
    [schemas]
  )

  // ----- Fuzzy + unmapped state helpers -----
  const acceptedFuzzy = useMemo(
    () => (rawMappings?.fuzzy ?? []).filter((m) => fuzzyDecisions[m.oldKey] === true),
    [rawMappings, fuzzyDecisions]
  )
  const rejectedFuzzy = useMemo(
    () => (rawMappings?.fuzzy ?? []).filter((m) => fuzzyDecisions[m.oldKey] === false),
    [rawMappings, fuzzyDecisions]
  )
  // After rejection, these move to "unmapped" for manual assignment
  const effectiveUnmapped: UnmappedField[] = useMemo(
    () => [
      ...(rawMappings?.unmapped ?? []),
      ...rejectedFuzzy.map((m) => ({ oldKey: m.oldKey, value: m.value })),
    ],
    [rawMappings, rejectedFuzzy]
  )

  // New-type fields claimed by exact or accepted-fuzzy (not available for manual selection)
  const claimedNewKeys = useMemo(() => {
    const s = new Set<string>()
    for (const m of rawMappings?.exact ?? []) s.add(m.newKey)
    for (const m of acceptedFuzzy) s.add(m.newKey)
    return s
  }, [rawMappings, acceptedFuzzy])

  const availableNewFieldsForManual = useMemo(
    () => selectedFields.filter((f) => !claimedNewKeys.has(f.key)),
    [selectedFields, claimedNewKeys]
  )

  // ----- Required-field guard -----
  const requiredNewFields = useMemo(
    () => selectedFields.filter((f) => f.required),
    [selectedFields]
  )

  const isSaveDisabled = useMemo(() => {
    if (saving) return true
    for (const req of requiredNewFields) {
      // Check Phase A field values
      const phaseAVal = (fieldValues[req.key] ?? "").trim()
      if (phaseAVal) continue

      if (typeChanged && rawMappings) {
        // Exact mapping satisfies it
        if (rawMappings.exact.some((m) => m.newKey === req.key)) continue
        // Accepted fuzzy satisfies it
        if (acceptedFuzzy.some((m) => m.newKey === req.key)) continue
        // Manual assignment satisfies it
        const manualKey = Object.entries(unmappedAssignments).find(([, v]) => v === req.key)?.[0]
        if (manualKey) continue
      }

      // Required field has no value
      return true
    }
    return false
  }, [saving, requiredNewFields, fieldValues, typeChanged, rawMappings, acceptedFuzzy, unmappedAssignments])

  // ----- Save -----
  async function handleSave() {
    if (!editingNode || isSaveDisabled || !isAdmin) return
    setSaving(true)
    setSaveError(null)

    try {
      // Build node_data
      const node_data: Record<string, unknown> = {}
      const properties_to_be_deleted: string[] = []

      if (typeChanged && rawMappings) {
        // Exact mappings
        for (const m of rawMappings.exact) {
          const v = parseFieldValue(
            selectedFields.find((f) => f.key === m.newKey)?.type ?? "string",
            stringifyValue(m.value)
          )
          if (v !== undefined) node_data[m.newKey] = v
        }
        // Accepted fuzzy
        for (const m of acceptedFuzzy) {
          const v = parseFieldValue(
            selectedFields.find((f) => f.key === m.newKey)?.type ?? "string",
            stringifyValue(m.value)
          )
          if (v !== undefined) node_data[m.newKey] = v
        }
        // Manual assignments
        for (const [oldKey, newKey] of Object.entries(unmappedAssignments)) {
          if (!newKey) {
            // Explicitly dropped — add to deletion list
            properties_to_be_deleted.push(oldKey)
            continue
          }
          const rawVal = rawMappings.unmapped.find((u) => u.oldKey === oldKey)?.value
            ?? rejectedFuzzy.find((u) => u.oldKey === oldKey)?.value
          const v = parseFieldValue(
            selectedFields.find((f) => f.key === newKey)?.type ?? "string",
            stringifyValue(rawVal)
          )
          if (v !== undefined) node_data[newKey] = v
        }
        // Unassigned unmapped fields (no assignment chosen yet = drop)
        for (const u of effectiveUnmapped) {
          if (!(u.oldKey in unmappedAssignments)) {
            properties_to_be_deleted.push(u.oldKey)
          }
        }
      }

      // Phase A field values (always applied, overrides mapped values if same key)
      for (const field of selectedFields) {
        const raw = fieldValues[field.key] ?? ""
        const v = parseFieldValue(field.type, raw)
        if (v !== undefined) node_data[field.key] = v
      }

      if (isMocksEnabled()) {
        console.log("[EditNodeModal] mock save", { node_data, properties_to_be_deleted })
        close()
        clearSelection()
        setSelectedNode(editingNode)
        return
      }

      await adminUpdateNode({
        ref_id: editingNode.ref_id,
        node_type: selectedType,
        node_data,
        ...(typeChanged ? { type_to_be_deleted: [originalType] } : {}),
        ...(properties_to_be_deleted.length > 0 ? { properties_to_be_deleted } : {}),
      })

      close()
      clearSelection()
      setSelectedNode(editingNode)
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "An unexpected error occurred. Please try again."
      setSaveError(msg)
    } finally {
      setSaving(false)
    }
  }

  // ----- Required-field highlight helper -----
  function isRequiredUnmet(fieldKey: string): boolean {
    if (!typeChanged || !rawMappings) {
      return (
        (selectedFields.find((f) => f.key === fieldKey)?.required ?? false) &&
        !(fieldValues[fieldKey] ?? "").trim()
      )
    }
    const req = requiredNewFields.find((f) => f.key === fieldKey)
    if (!req) return false
    if ((fieldValues[fieldKey] ?? "").trim()) return false
    if (rawMappings.exact.some((m) => m.newKey === fieldKey)) return false
    if (acceptedFuzzy.some((m) => m.newKey === fieldKey)) return false
    if (Object.entries(unmappedAssignments).some(([, v]) => v === fieldKey)) return false
    return true
  }

  // ----- Schema options for type selector -----
  const schemaOptions = useMemo(
    () => schemas.map((s) => ({ value: s.type, label: s.type })),
    [schemas]
  )

  // ----- Render -----
  if (!isOpen || !editingNode) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="font-heading text-lg tracking-wide">Edit Node</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Update properties for <span className="font-mono text-foreground/80">{editingNode.ref_id}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 min-h-0 space-y-5 pr-1">
          {/* Type selector */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-mono">node_type</label>
            <SelectCustom
              value={selectedType}
              onChange={handleTypeChange}
              options={schemaOptions}
              placeholder="Select type…"
            />
          </div>

          {/* Phase A: schema-driven fields */}
          {selectedFields.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Properties
              </p>
              {selectedFields.map((field) => (
                <div key={field.key}>
                  <FieldRow
                    field={field}
                    value={fieldValues[field.key] ?? ""}
                    onChange={(key, val) =>
                      setFieldValues((prev) => ({ ...prev, [key]: val }))
                    }
                  />
                  {isRequiredUnmet(field.key) && (
                    <p className="text-[11px] text-destructive mt-0.5 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Required
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Phase B: remap section — only when type changed */}
          {typeChanged && rawMappings && (
            <div className="space-y-4 border-t border-border/40 pt-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Property Remapping
              </p>

              {/* Exact matches */}
              {rawMappings.exact.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">Auto-matched</p>
                  {rawMappings.exact.map((m: ExactMapping) => (
                    <div
                      key={m.oldKey}
                      className="flex items-center gap-2 rounded-md bg-muted/30 px-3 py-1.5 text-xs"
                    >
                      <Check className="h-3 w-3 shrink-0 text-green-500" />
                      <span className="font-mono text-foreground/70">{m.oldKey}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-mono text-foreground/70">{m.newKey}</span>
                      <span className="ml-auto text-muted-foreground truncate max-w-[120px]">
                        {stringifyValue(m.value) || <em>empty</em>}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Fuzzy suggestions */}
              {rawMappings.fuzzy.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">Suggestions — accept or reject</p>
                  {rawMappings.fuzzy.map((m: FuzzyMapping) => {
                    const decision = fuzzyDecisions[m.oldKey] ?? null
                    return (
                      <div
                        key={m.oldKey}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs border",
                          decision === true && "bg-green-500/10 border-green-500/30",
                          decision === false && "bg-muted/20 border-border/30 opacity-60",
                          decision === null && "bg-muted/30 border-border/30"
                        )}
                      >
                        <HelpCircle className="h-3 w-3 shrink-0 text-amber-400" />
                        <span className="font-mono text-foreground/70">{m.oldKey}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-mono text-foreground/70">{m.newKey}</span>
                        <span className="text-muted-foreground/60 text-[10px]">
                          ({Math.round(m.score * 100)}%)
                        </span>
                        <div className="ml-auto flex items-center gap-1">
                          <button
                            onClick={() =>
                              setFuzzyDecisions((prev) => ({ ...prev, [m.oldKey]: true }))
                            }
                            className={cn(
                              "px-2 py-0.5 rounded text-[11px] border transition-colors",
                              decision === true
                                ? "bg-green-600 text-white border-green-600"
                                : "border-border/50 text-muted-foreground hover:border-green-500/60 hover:text-green-400"
                            )}
                          >
                            Accept
                          </button>
                          <button
                            onClick={() =>
                              setFuzzyDecisions((prev) => ({ ...prev, [m.oldKey]: false }))
                            }
                            className={cn(
                              "px-2 py-0.5 rounded text-[11px] border transition-colors",
                              decision === false
                                ? "bg-muted text-muted-foreground border-border/60"
                                : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                            )}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Unmapped old properties */}
              {effectiveUnmapped.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">
                    Unmatched — map to a new field or drop
                  </p>
                  {effectiveUnmapped.map((u: UnmappedField) => (
                    <div
                      key={u.oldKey}
                      className="flex items-center gap-2 rounded-md bg-muted/20 border border-border/30 px-3 py-1.5 text-xs"
                    >
                      <span className="font-mono text-foreground/70 shrink-0">{u.oldKey}</span>
                      <span className="text-muted-foreground">→</span>
                      <select
                        value={unmappedAssignments[u.oldKey] ?? ""}
                        onChange={(e) =>
                          setUnmappedAssignments((prev) => ({
                            ...prev,
                            [u.oldKey]: e.target.value,
                          }))
                        }
                        className="ml-auto flex-1 min-w-0 max-w-[200px] rounded border border-border/50 bg-background px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60"
                        aria-label={`Map ${u.oldKey}`}
                      >
                        <option value="">— Drop —</option>
                        {availableNewFieldsForManual
                          .filter((f) => !(unmappedAssignments[u.oldKey] !== f.key && Object.values(unmappedAssignments).includes(f.key)))
                          .map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.key}{f.required ? " *" : ""}
                            </option>
                          ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 pt-3 space-y-2 border-t border-border/30">
          {saveError && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {saveError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaveDisabled}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
