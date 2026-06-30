"use client"

import { useMemo, useState } from "react"
import { X, GitMerge, Plus, Trash2, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SelectCustom } from "@/components/ui/select-custom"
import { MAX_LENGTHS } from "@/lib/input-limits"
import type { SchemaAttribute, SchemaEdge, SchemaNode } from "@/lib/schema-types"

const ATTR_TYPES = ["string", "int", "float", "boolean", "date"]
const WILDCARD = "*"
// Edge-level keys that are infrastructure, not user-facing attributes.
const RESERVED_ATTR_KEYS = new Set(["ref_id", "edge_key", "display_name"])

interface Props {
  edgeType: string
  edges: SchemaEdge[]
  allSchemas: SchemaNode[]
  canEdit: boolean
  onClose: () => void
  onAddConnection: (sourceType: string, targetType: string) => void
  onDeleteConnection: (refId: string) => void
  onSaveAttributes: (attrs: SchemaAttribute[]) => void
  onDeleteType: () => void
  error?: string
  onClearError?: () => void
}

/** Collapse the per-connection attribute maps into one deduped attribute list. */
function dedupeAttributes(edges: SchemaEdge[]): SchemaAttribute[] {
  const map = new Map<string, SchemaAttribute>()
  for (const e of edges) {
    if (!e.attributes) continue
    for (const [key, raw] of Object.entries(e.attributes)) {
      if (typeof raw !== "string" || RESERVED_ATTR_KEYS.has(key)) continue
      if (!map.has(key)) {
        const optional = raw.startsWith("?")
        map.set(key, { key, type: raw.replace(/^\?/, ""), required: !optional })
      }
    }
  }
  return Array.from(map.values())
}

export function EdgeTypePanel({
  edgeType,
  edges,
  allSchemas,
  canEdit,
  onClose,
  onAddConnection,
  onDeleteConnection,
  onSaveAttributes,
  onDeleteType,
  error,
  onClearError,
}: Props) {
  const refIdToType = useMemo(
    () => Object.fromEntries(allSchemas.map((s) => [s.ref_id, s])),
    [allSchemas]
  )

  // Local working copy of the type's attributes (remounted per type via `key`).
  const [attributes, setAttributes] = useState<SchemaAttribute[]>(() => dedupeAttributes(edges))
  const initialAttrs = useMemo(() => dedupeAttributes(edges), [edges])
  const dirty = useMemo(
    () => JSON.stringify(attributes) !== JSON.stringify(initialAttrs),
    [attributes, initialAttrs]
  )

  const [addSource, setAddSource] = useState("")
  const [addTarget, setAddTarget] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)

  const sortedTypes = useMemo(
    () =>
      [...allSchemas]
        .map((s) => ({ value: s.type, label: s.type }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [allSchemas]
  )
  const typeOptions = [
    { value: "", label: "Select…" },
    { value: WILDCARD, label: "Any (*)" },
    ...sortedTypes,
  ]

  const addAttr = () =>
    setAttributes((a) => [...a, { key: "", type: "string", required: false }])
  const updateAttr = (i: number, partial: Partial<SchemaAttribute>) =>
    setAttributes((a) => a.map((x, idx) => (idx === i ? { ...x, ...partial } : x)))
  const removeAttr = (i: number) =>
    setAttributes((a) => a.filter((_, idx) => idx !== i))

  const handleAddConnection = () => {
    if (!addSource || !addTarget) return
    onClearError?.()
    onAddConnection(addSource, addTarget)
    setAddSource("")
    setAddTarget("")
  }

  return (
    <div className="w-[340px] shrink-0 border-l border-border flex flex-col bg-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground mb-1">
            Relationship Type
          </p>
          <div className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 shrink-0 text-muted-foreground" />
            <h2 className="font-mono font-semibold text-sm truncate">{edgeType}</h2>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!canEdit && (
          <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
            <Lock className="h-3 w-3 shrink-0 text-muted-foreground/70" />
            <span className="text-[10px] text-muted-foreground">
              Read-only — admin access required to edit.
            </span>
          </div>
        )}

        {/* Connections section */}
        <div className="space-y-2">
          <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
            Connections
          </Label>
          {edges.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/50">No connections found</p>
          ) : (
            <div className="space-y-1.5">
              {edges.map((e) => {
                const sourceLabel = e.source_type ?? refIdToType[e.source]?.type ?? e.source
                const targetLabel = e.target_type ?? refIdToType[e.target]?.type ?? e.target
                return (
                  <div
                    key={e.ref_id}
                    className="flex items-center gap-1.5 rounded-md border border-border/30 bg-muted/20 px-2 py-1.5"
                  >
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {sourceLabel}
                    </span>
                    <span className="text-[10px] font-mono font-medium text-foreground truncate mx-1">
                      — → —
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {targetLabel}
                    </span>
                    {canEdit && (
                      <button
                        onClick={() => onDeleteConnection(e.ref_id)}
                        title="Remove connection"
                        className="ml-auto text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Add connection */}
          {canEdit && (
            <div className="flex items-center gap-1.5 pt-1">
              <SelectCustom
                value={addSource}
                onChange={setAddSource}
                options={typeOptions}
                searchable
                compact
                className="flex-1 min-w-0"
              />
              <span className="text-[10px] text-muted-foreground shrink-0">→</span>
              <SelectCustom
                value={addTarget}
                onChange={setAddTarget}
                options={typeOptions}
                searchable
                compact
                className="flex-1 min-w-0"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={handleAddConnection}
                disabled={!addSource || !addTarget}
                title="Add connection"
                className="h-7 w-7 p-0 shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        <Separator className="bg-border/30" />

        {/* Attributes section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
              Attributes
            </Label>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                onClick={addAttr}
                className="h-6 px-2 text-[10px] text-muted-foreground"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            )}
          </div>

          {attributes.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/50">No attributes</p>
          ) : (
            <div className="space-y-2">
              {attributes.map((attr, i) =>
                canEdit ? (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 rounded-md border border-border/30 bg-muted/20 p-2"
                  >
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          value={attr.key}
                          onChange={(e) => updateAttr(i, { key: e.target.value })}
                          placeholder="key"
                          maxLength={MAX_LENGTHS.SCHEMA_ATTRIBUTE_KEY}
                          className="h-6 flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                        />
                        <SelectCustom
                          value={attr.type}
                          onChange={(val) => updateAttr(i, { type: val })}
                          options={ATTR_TYPES.map((t) => ({ value: t, label: t }))}
                          compact
                          className="w-[80px] shrink-0"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={attr.required}
                          onCheckedChange={(checked) => updateAttr(i, { required: !!checked })}
                          className="scale-75"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          {attr.required ? "Required" : "Optional"}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => removeAttr(i)}
                      className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-md border border-border/20 bg-muted/10 px-2 py-1.5 opacity-80"
                  >
                    <span className="text-[10px] font-mono text-muted-foreground">{attr.key}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-mono text-muted-foreground/60 rounded bg-muted/30 px-1 py-0.5">
                        {attr.type}
                      </span>
                      <span className="text-[9px] text-muted-foreground/50">
                        {attr.required ? "Required" : "Optional"}
                      </span>
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {canEdit && dirty && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-muted-foreground/60">
                Applies to all {edges.length} connection{edges.length !== 1 ? "s" : ""}
              </span>
              <Button
                size="sm"
                onClick={() => onSaveAttributes(attributes.filter((a) => a.key.trim()))}
                className="h-7 text-xs"
              >
                Save attributes
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      {canEdit && (
        <div className="border-t border-border p-4 space-y-3">
          {error && <p className="text-xs text-destructive leading-snug">{error}</p>}
          {confirmDelete ? (
            <div className="flex items-center justify-between">
              <span className="text-xs text-destructive">Delete this type?</span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDelete(false)}
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={onDeleteType}
                  className="h-7 text-xs"
                >
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              className="w-full text-xs text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3 mr-1.5" />
              Delete relationship type
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
