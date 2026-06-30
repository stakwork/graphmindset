"use client"

import { useState } from "react"
import { X, Plus, Trash2, GitMerge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { SelectCustom } from "@/components/ui/select-custom"
import { MAX_LENGTHS } from "@/lib/input-limits"
import type { SchemaNode, SchemaAttribute } from "@/lib/schema-types"

const ATTR_TYPES = ["string", "int", "float", "boolean", "date"]
const WILDCARD = "*"

export interface NewEdgeParams {
  sourceType: string
  targetType: string
  edgeType: string
  attributes: SchemaAttribute[]
}

interface Props {
  allSchemas: SchemaNode[]
  initialSource?: string
  initialTarget?: string
  onCreate: (params: NewEdgeParams) => void
  onClose: () => void
  error?: string
  onClearError?: () => void
}

/**
 * Right-panel form for creating a new relationship (edge schema). Source/target
 * are picked by type name; the backend keys edge schemas off names and accepts
 * "*" as a wildcard for either endpoint.
 */
export function EdgeCreatePanel({
  allSchemas,
  initialSource,
  initialTarget,
  onCreate,
  onClose,
  error,
  onClearError,
}: Props) {
  const [edgeType, setEdgeType] = useState("")
  const [sourceType, setSourceType] = useState(initialSource ?? "")
  const [targetType, setTargetType] = useState(initialTarget ?? "")
  const [attributes, setAttributes] = useState<SchemaAttribute[]>([])

  const sortedTypes = [...allSchemas]
    .map((s) => ({ value: s.type, label: s.type }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const sourceOptions = [
    { value: "", label: "Select type…" },
    { value: WILDCARD, label: "Any (*)" },
    ...sortedTypes,
  ]
  const targetOptions = sourceOptions

  const canCreate = !!edgeType.trim() && !!sourceType && !!targetType

  const addAttr = () =>
    setAttributes((a) => [...a, { key: "", type: "string", required: false }])
  const updateAttr = (i: number, partial: Partial<SchemaAttribute>) =>
    setAttributes((a) => a.map((x, idx) => (idx === i ? { ...x, ...partial } : x)))
  const removeAttr = (i: number) =>
    setAttributes((a) => a.filter((_, idx) => idx !== i))

  const handleCreate = () => {
    if (!canCreate) return
    onClearError?.()
    onCreate({
      sourceType,
      targetType,
      edgeType: edgeType.trim(),
      attributes: attributes.filter((a) => a.key.trim()),
    })
  }

  return (
    <div className="w-[340px] shrink-0 border-l border-border flex flex-col bg-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground mb-1">
            New Relationship
          </p>
          <div className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 shrink-0 text-muted-foreground" />
            <h2 className="font-mono font-semibold text-sm truncate">
              {edgeType.trim() || "edge type"}
            </h2>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            A <span className="font-medium text-foreground">relationship</span> connects two
            types in one direction, e.g.{" "}
            <span className="font-mono text-foreground">Person —AUTHORED_BY→ Document</span>.
            Name it, pick the From and To types, then{" "}
            <span className="font-medium text-foreground">Create</span>.
          </p>
        </div>
        {/* Edge type name */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
            Relationship Type
          </Label>
          <Input
            value={edgeType}
            onChange={(e) => {
              onClearError?.()
              setEdgeType(e.target.value)
            }}
            placeholder="e.g. POSTED, MENTIONS"
            maxLength={MAX_LENGTHS.SCHEMA_TYPE_NAME}
            className="h-8 text-sm bg-muted/50 border-border/50 font-mono"
          />
          <p className="text-[10px] text-muted-foreground/60">
            Saved uppercased with underscores (e.g. “has clip” → HAS_CLIP).
          </p>
        </div>

        {/* Source → Target */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
            From (source)
          </Label>
          <SelectCustom
            value={sourceType}
            onChange={setSourceType}
            options={sourceOptions}
            searchable
            placeholder="Select type…"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
            To (target)
          </Label>
          <SelectCustom
            value={targetType}
            onChange={setTargetType}
            options={targetOptions}
            searchable
            placeholder="Select type…"
          />
          <p className="text-[10px] text-muted-foreground/60">
            The arrow points From → To. Choose “Any (*)” to allow any type on that end.
          </p>
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
              onClick={addAttr}
              className="h-6 px-2 text-[10px] text-muted-foreground"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          </div>
          {attributes.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/50">No attributes (optional)</p>
          ) : (
            <div className="space-y-2">
              {attributes.map((attr, i) => (
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
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border p-4 space-y-3">
        {error && <p className="text-xs text-destructive leading-snug">{error}</p>}
        <Button
          onClick={handleCreate}
          disabled={!canCreate}
          className="w-full h-8 text-xs"
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Create relationship
        </Button>
      </div>
    </div>
  )
}
