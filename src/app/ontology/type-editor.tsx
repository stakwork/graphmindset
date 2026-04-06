"use client"

import { useCallback, useState } from "react"
import { X, Plus, Trash2, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { SelectCustom } from "@/components/ui/select-custom"
import type { SchemaNode, SchemaAttribute } from "./page"

const COLORS = [
  "#6366f1", "#0d9488", "#d97706", "#8b5cf6", "#ef4444",
  "#ec4899", "#14b8a6", "#f59e0b", "#3b82f6", "#10b981",
  "#64748b", "#e11d48",
]

const ATTR_TYPES = ["string", "int", "float", "boolean", "date"]

interface Props {
  schema: SchemaNode
  allSchemas: SchemaNode[]
  onUpdate: (schema: SchemaNode) => void
  onDelete: (refId: string) => void
  onClose: () => void
}

export function TypeEditor({ schema, allSchemas, onUpdate, onDelete, onClose }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const update = useCallback(
    (partial: Partial<SchemaNode>) => {
      onUpdate({ ...schema, ...partial })
    },
    [schema, onUpdate]
  )

  const updateAttribute = useCallback(
    (index: number, partial: Partial<SchemaAttribute>) => {
      const attrs = [...schema.attributes]
      attrs[index] = { ...attrs[index], ...partial }
      update({ attributes: attrs })
    },
    [schema, update]
  )

  const addAttribute = useCallback(() => {
    update({
      attributes: [
        ...schema.attributes,
        { key: "", type: "string", required: false },
      ],
    })
  }, [schema, update])

  const removeAttribute = useCallback(
    (index: number) => {
      update({
        attributes: schema.attributes.filter((_, i) => i !== index),
      })
    },
    [schema, update]
  )

  const parentOptions = allSchemas
    .filter((s) => s.ref_id !== schema.ref_id)
    .map((s) => s.type)

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

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Type name */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
            Type Name
          </Label>
          <Input
            value={schema.type}
            onChange={(e) => update({ type: e.target.value })}
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

        {/* Node Key */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
            Display Key
          </Label>
          <SelectCustom
            value={schema.node_key}
            onChange={(val) => update({ node_key: val })}
            options={schema.attributes.map((a) => ({
              value: a.key,
              label: a.key || "(unnamed)",
            }))}
          />
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

          <div className="space-y-2">
            {schema.attributes.map((attr, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded-md border border-border/30 bg-muted/20 p-2"
              >
                <GripVertical className="h-3 w-3 text-muted-foreground/30 shrink-0" />
                <input
                  value={attr.key}
                  onChange={(e) => updateAttribute(i, { key: e.target.value })}
                  placeholder="key"
                  className="h-6 flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                />
                <SelectCustom
                  value={attr.type}
                  onChange={(val) => updateAttribute(i, { type: val })}
                  options={ATTR_TYPES.map((t) => ({ value: t, label: t }))}
                  compact
                  className="w-[80px] shrink-0"
                />
                <div className="flex items-center gap-1 shrink-0" title="Required">
                  <Switch
                    checked={attr.required}
                    onCheckedChange={(checked) =>
                      updateAttribute(i, { required: !!checked })
                    }
                    className="scale-75"
                  />
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
      </div>

      {/* Footer */}
      <div className="border-t border-border p-4">
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
                onClick={() => onDelete(schema.ref_id)}
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
      </div>
    </div>
  )
}
