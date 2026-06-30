"use client"

import { useMemo, useState } from "react"
import { X, Plus, Trash2, Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { SelectCustom } from "@/components/ui/select-custom"
import { MultiSelectCustom } from "@/components/ui/multi-select-custom"
import { MAX_LENGTHS } from "@/lib/input-limits"
import type { SchemaNode, SchemaAttribute, SchemaEdge } from "@/lib/schema-types"

const COLORS = [
  "#6366f1", "#0d9488", "#d97706", "#8b5cf6", "#ef4444",
  "#ec4899", "#14b8a6", "#f59e0b", "#3b82f6", "#10b981",
  "#64748b", "#e11d48",
]

const ATTR_TYPES = ["string", "int", "float", "boolean", "date"]

interface Props {
  schema: SchemaNode
  allSchemas: SchemaNode[]
  edges: SchemaEdge[]
  canEdit: boolean
  /** Draft (unsaved) new type — shows a Create button and persists nothing until clicked. */
  isNew?: boolean
  onSave: (schema: SchemaNode) => void
  onCreate?: (schema: SchemaNode) => void
  onDelete: (refId: string) => void
  onClose: () => void
  error?: string
  onClearError?: () => void
}

/** Parse "type-key1-key2" → ["key1", "key2"] */
function parseNodeKeySegments(nodeKey: string, type: string): string[] {
  const prefix = `${type.toLowerCase()}-`
  const withoutPrefix = nodeKey.startsWith(prefix) ? nodeKey.slice(prefix.length) : nodeKey
  return withoutPrefix ? withoutPrefix.split("-").filter(Boolean) : []
}

export function TypeEditor({ schema: schemaProp, allSchemas, edges, canEdit, isNew, onSave, onCreate, onDelete, onClose, error, onClearError }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Local working copy — nothing is persisted until Save/Create. The parent
  // remounts this component (key) when the selected type changes, re-seeding it.
  const [draft, setDraft] = useState<SchemaNode>(schemaProp)
  const schema = draft

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(schemaProp),
    [draft, schemaProp]
  )

  const update = (partial: Partial<SchemaNode>) => {
    onClearError?.()
    setDraft((d) => ({ ...d, ...partial }))
  }

  const updateAttribute = (index: number, partial: Partial<SchemaAttribute>) => {
    onClearError?.()
    setDraft((d) => {
      const attrs = [...d.attributes]
      const prev = attrs[index]
      const next = { ...prev, ...partial }
      attrs[index] = next

      // Keep node_key consistent with attribute edits: a key segment can't be
      // optional (backend rejects it), and must track renames.
      let segments = parseNodeKeySegments(d.node_key ?? "", d.type)
      if (partial.key !== undefined && prev.key && segments.includes(prev.key)) {
        segments = segments.map((s) => (s === prev.key ? next.key : s)).filter(Boolean)
      }
      if (partial.required === false && segments.includes(next.key)) {
        segments = segments.filter((s) => s !== next.key)
      }
      return { ...d, attributes: attrs, node_key: segments.join("-") }
    })
  }

  const addAttribute = () => {
    setDraft((d) => ({
      ...d,
      attributes: [...d.attributes, { key: "", type: "string", required: false }],
    }))
  }

  const removeAttribute = (index: number) => {
    setDraft((d) => {
      const removed = d.attributes[index]
      const attrs = d.attributes.filter((_, i) => i !== index)
      const segments = parseNodeKeySegments(d.node_key ?? "", d.type).filter(
        (s) => s !== removed?.key
      )
      return { ...d, attributes: attrs, node_key: segments.join("-") }
    })
  }

  // Set the unique key from the picker. Any selected attribute that's optional
  // is promoted to required, since node_key segments must be required.
  const setNodeKey = (vals: string[]) => {
    onClearError?.()
    setDraft((d) => ({
      ...d,
      attributes: d.attributes.map((a) => (vals.includes(a.key) ? { ...a, required: true } : a)),
      node_key: vals.join("-"),
    }))
  }

  const parentOptions = allSchemas
    .filter((s) => s.ref_id !== schema.ref_id)
    .map((s) => s.type)

  const refIdToType = Object.fromEntries(allSchemas.map((s) => [s.ref_id, s]))

  const relationships = edges.filter(
    (e) => (e.source === schema.ref_id || e.target === schema.ref_id)
      && e.edge_type !== "CHILD_OF"
  )

  // All own + inherited attribute keys for title/description selects
  const ownAttrOptions = schema.attributes
    .filter((a) => a.key)
    .map((a) => ({ value: a.key, label: a.key }))

  const inheritedAttrOptions = (schema.inherited_attributes ?? [])
    .filter((a) => a.key)
    .map((a) => ({
      value: a.key,
      label: a.key,
      hint: schema.parent ? `from ${schema.parent}` : undefined,
    }))

  const allAttrOptions = [
    { value: "", label: "None" },
    ...ownAttrOptions,
    ...inheritedAttrOptions,
  ]

  // node_key multi-select: any named attribute (optional ones get promoted to
  // required on selection, since the backend forbids optional key segments).
  const nodeKeyOptions = schema.attributes
    .filter((a) => a.key)
    .map((a) => ({ value: a.key, label: a.key }))

  const selectedNodeKeys = parseNodeKeySegments(schema.node_key ?? "", schema.type)
  const nodeKeyValid = selectedNodeKeys.length > 0

  return (
    <div className="w-[340px] shrink-0 border-l border-border flex flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div
            className="h-4 w-4 rounded-full"
            style={{ backgroundColor: schema.color }}
          />
          <h3 className="text-sm font-heading font-semibold">{schema.type}</h3>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!canEdit && (
          <div className="mb-4 flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
            <Lock className="h-3 w-3 shrink-0 text-muted-foreground/70" />
            <span className="text-[10px] text-muted-foreground">
              Read-only — admin access required to edit.
            </span>
          </div>
        )}
        <div className={cn("space-y-5", !canEdit && "pointer-events-none opacity-90")}>
        {isNew && (
          <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              A <span className="font-medium text-foreground">type</span> is a kind of node
              (e.g. Person, Document). Name it, pick a parent to inherit attributes from, add
              its own attributes, choose a unique key, then{" "}
              <span className="font-medium text-foreground">Create</span>.
            </p>
          </div>
        )}
        {/* Type name */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
            Type Name
          </Label>
          <Input
            value={schema.type}
            onChange={(e) => update({ type: e.target.value })}
            maxLength={MAX_LENGTHS.SCHEMA_TYPE_NAME}
            className="h-8 text-sm bg-muted/50 border-border/50"
          />
        </div>

        {/* Parent */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
            Parent Type
          </Label>
          <SelectCustom
            value={schema.parent}
            onChange={(val) => update({ parent: val })}
            options={[
              { value: "", label: "None (root)" },
              ...parentOptions.map((t) => ({ value: t, label: t })),
            ]}
          />
          <p className="text-[10px] text-muted-foreground/60">
            Inherits the parent&apos;s attributes. Use “Thing” for a top-level type.
          </p>
        </div>

        {/* Title Property */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
            Title Property
          </Label>
          <SelectCustom
            value={schema.title_key ?? ""}
            onChange={(val) => update({ title_key: val || undefined })}
            options={allAttrOptions}
            placeholder="None"
          />
          <p className="text-[10px] text-muted-foreground/60">
            Which attribute shows as the node&apos;s title in the graph.
          </p>
        </div>

        {/* Description Property */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
            Description Property
          </Label>
          <SelectCustom
            value={schema.description_key ?? ""}
            onChange={(val) => update({ description_key: val || undefined })}
            options={allAttrOptions}
            placeholder="None"
          />
          <p className="text-[10px] text-muted-foreground/60">
            Optional attribute shown as the node&apos;s subtitle.
          </p>
        </div>

        {/* Color */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
            Color
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => update({ color: c })}
                className={`h-6 w-6 rounded-full transition-all ${
                  schema.color === c
                    ? "ring-2 ring-foreground ring-offset-2 ring-offset-card scale-110"
                    : "hover:scale-110"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {/* Unique Key (node_key) */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
            Unique Key
          </Label>
          <MultiSelectCustom
            value={selectedNodeKeys}
            onChange={setNodeKey}
            options={nodeKeyOptions}
            placeholder="Select attributes…"
          />
          <p className="text-[10px] text-muted-foreground/60">
            Combined to uniquely identify nodes. Selecting an optional attribute marks it required.
          </p>
          {!nodeKeyValid && (
            <p className="text-[10px] text-destructive/80">
              Pick at least one attribute as the unique key.
            </p>
          )}
        </div>

        <Separator className="bg-border/30" />

        {/* Attributes */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
              Attributes
            </Label>
            <Button
              size="sm"
              variant="ghost"
              onClick={addAttribute}
              className="h-6 px-2 text-[10px] text-muted-foreground"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            Fields stored on each node of this type. Toggle Required for mandatory ones.
          </p>

          {/* Inherited attributes (read-only) */}
          {(schema.inherited_attributes ?? []).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wide font-heading">
                Inherited from {schema.parent}
              </p>
              {(schema.inherited_attributes ?? []).map((attr, i) => (
                <div
                  key={`inh-${i}`}
                  className="flex items-center gap-1.5 rounded-md border border-border/20 bg-muted/10 p-2 opacity-60"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground/70 font-mono truncate">
                        {attr.key}
                      </span>
                      <span className="shrink-0 rounded-sm bg-muted/40 px-1 py-0 text-[9px] font-mono text-muted-foreground/60">
                        {attr.type}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground/50">
                      {attr.required ? "Required" : "Optional"} · from {schema.parent}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Own attributes (editable) */}
          <div className="space-y-2">
            {schema.attributes.map((attr, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded-md border border-border/30 bg-muted/20 p-2"
              >
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      value={attr.key}
                      onChange={(e) => updateAttribute(i, { key: e.target.value })}
                      placeholder="key"
                      maxLength={MAX_LENGTHS.SCHEMA_ATTRIBUTE_KEY}
                      className="h-6 flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                    />
                    <SelectCustom
                      value={attr.type}
                      onChange={(val) => updateAttribute(i, { type: val })}
                      options={ATTR_TYPES.map((t) => ({ value: t, label: t }))}
                      compact
                      className="w-[80px] shrink-0"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={attr.required}
                        onCheckedChange={(checked) =>
                          updateAttribute(i, { required: !!checked })
                        }
                        className="scale-75"
                      />
                      <span className="text-[10px] text-muted-foreground">
                        {attr.required ? "Required" : "Optional"}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => removeAttribute(i)}
                  className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <Separator className="bg-border/30" />

        {/* Relationships */}
        <div className="space-y-2">
          <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
            Relationships
          </Label>

          {relationships.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/50">No relationships defined</p>
          ) : (
            <div className="space-y-1.5">
              {relationships.map((e) => {
                const source = refIdToType[e.source]
                const target = refIdToType[e.target]
                return (
                  <div
                    key={e.ref_id}
                    className="flex items-center gap-1.5 rounded-md border border-border/30 bg-muted/20 px-2 py-1.5"
                  >
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {source?.type ?? e.source}
                    </span>
                    <span className="text-[10px] font-mono font-medium text-foreground truncate mx-1">
                      — {e.edge_type} →
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {target?.type ?? e.target}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Footer */}
      {canEdit && (
        <div className="border-t border-border p-4 space-y-3">
          {error && <p className="text-xs text-destructive leading-snug">{error}</p>}

          {isNew ? (
            <Button
              onClick={() => onCreate?.(draft)}
              disabled={!draft.type.trim() || !nodeKeyValid}
              className="w-full h-8 text-xs"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Create type
            </Button>
          ) : (
            <>
              <Button
                onClick={() => onSave(draft)}
                disabled={!dirty || !nodeKeyValid}
                className="w-full h-8 text-xs"
              >
                {dirty ? "Save changes" : "Saved"}
              </Button>
              {schema.type === "Thing" ? (
                <p className="text-[10px] text-muted-foreground/50 text-center">
                  Root type cannot be deleted
                </p>
              ) : confirmDelete ? (
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
                      onClick={() => onDelete(schemaProp.ref_id)}
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
                  Delete Type
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
