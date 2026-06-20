"use client"

import { useMemo, useState } from "react"
import { X, Trash2, Plus, EyeOff, Eye, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { MultiSelectCustom } from "@/components/ui/multi-select-custom"
import { MAX_LENGTHS } from "@/lib/input-limits"
import type { SchemaNode } from "@/app/ontology/page"

export interface DomainRow {
  /** Lowercased domain identifier (the canonical key). */
  key: string
  /** Display casing (from a member schema, or capitalized key). */
  label: string
  /** Node types whose `domain` resolves to this domain. */
  members: SchemaNode[]
  hidden: boolean
}

interface DomainPanelProps {
  domain: DomainRow
  /** All schema types — used to pick which to add to this domain. */
  allTypes: SchemaNode[]
  onRename: (newName: string) => void
  onAddTypes: (typeNames: string[]) => void
  onRemoveType: (typeName: string) => void
  onToggleHidden: (hidden: boolean) => void
  onDelete: () => void
  onClose: () => void
  busy?: boolean
  error?: string
}

/**
 * Manage a single domain (a category grouping many node types). Rename cascades
 * the `domain` property across member types; add/remove reassigns a type's
 * domain. All writes go through the schema API, then a background relabel
 * catches up existing nodes — surfaced via the note below.
 */
export function DomainPanel({
  domain,
  allTypes,
  onRename,
  onAddTypes,
  onRemoveType,
  onToggleHidden,
  onDelete,
  onClose,
  busy,
  error,
}: DomainPanelProps) {
  const [renameValue, setRenameValue] = useState(domain.label)
  const [confirmingRename, setConfirmingRename] = useState(false)
  const [toAdd, setToAdd] = useState<string[]>([])

  // Reset local edit state when switching domains.
  const renameDirty =
    renameValue.trim().length > 0 &&
    renameValue.trim().toLowerCase() !== domain.key

  const memberKeys = useMemo(
    () => new Set(domain.members.map((m) => m.type)),
    [domain.members]
  )

  const addableOptions = useMemo(
    () =>
      allTypes
        .filter((s) => s.type && s.type !== "Thing" && !memberKeys.has(s.type))
        .sort((a, b) => a.type.localeCompare(b.type))
        .map((s) => ({
          value: s.type,
          label: s.type,
          hint: s.domain ? s.domain.toLowerCase() : undefined,
        })),
    [allTypes, memberKeys]
  )

  const startRename = () => {
    if (renameDirty) setConfirmingRename(true)
  }
  const confirmRename = () => {
    onRename(renameValue.trim())
    setConfirmingRename(false)
  }

  const commitAdd = () => {
    if (toAdd.length === 0) return
    onAddTypes(toAdd)
    setToAdd([])
  }

  return (
    <div className="flex w-full max-w-xl flex-col rounded-lg border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-heading font-semibold truncate">{domain.label}</h3>
          <span className="font-mono text-[10px] text-muted-foreground shrink-0">
            {domain.key}
          </span>
          {domain.hidden && (
            <span className="inline-flex items-center gap-1 rounded-sm bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-amber-300/90 shrink-0">
              <EyeOff className="h-2.5 w-2.5" />
              hidden
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-5 p-4">
        {/* Rename */}
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
            Domain Name
          </Label>
          {confirmingRename ? (
            <div className="rounded-md border border-amber-400/30 bg-amber-400/5 p-3 space-y-2">
              <p className="text-xs text-foreground">
                Rename <span className="font-mono">{domain.key}</span> →{" "}
                <span className="font-mono">{renameValue.trim().toLowerCase()}</span>?
                This updates {domain.members.length} member type
                {domain.members.length === 1 ? "" : "s"} and relabels their
                existing nodes in the background.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingRename(false)}
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={confirmRename}
                  disabled={busy}
                  className="h-7 text-xs"
                >
                  Rename
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                maxLength={MAX_LENGTHS.SCHEMA_TYPE_NAME}
                className="h-8 text-sm bg-muted/50 border-border/50"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={startRename}
                disabled={!renameDirty || busy}
                className="h-8 text-xs shrink-0"
              >
                Rename
              </Button>
            </div>
          )}
        </div>

        {/* Visibility */}
        <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3 py-2">
          <div className="flex items-center gap-2">
            {domain.hidden ? (
              <EyeOff className="h-3.5 w-3.5 text-amber-300/90" />
            ) : (
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="text-xs text-foreground">Hidden from search</span>
          </div>
          <Switch
            checked={domain.hidden}
            onCheckedChange={(c) => onToggleHidden(!!c)}
            disabled={busy}
            className="scale-90"
          />
        </div>

        <Separator className="bg-border/30" />

        {/* Member types */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
              Member node types
            </Label>
            <span className="text-[10px] text-muted-foreground">
              {domain.members.length}
            </span>
          </div>

          {domain.members.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No node types in this domain.
            </p>
          ) : (
            <div className="rounded-md border border-border/40 divide-y divide-border/30 max-h-56 overflow-y-auto">
              {domain.members.map((m) => (
                <div
                  key={m.ref_id || m.type}
                  className="flex items-center gap-2 px-3 py-2"
                >
                  <div
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: m.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-foreground truncate">{m.type}</p>
                    {m.parent && (
                      <p className="text-[10px] font-mono text-muted-foreground/70 truncate">
                        ↳ {m.parent}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => onRemoveType(m.type)}
                    disabled={busy}
                    title="Remove from domain (moves to entity)"
                    className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0 disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add types */}
          <div className="flex items-center gap-2 pt-1">
            <MultiSelectCustom
              value={toAdd}
              onChange={setToAdd}
              options={addableOptions}
              placeholder="Add node types…"
              className="flex-1"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={commitAdd}
              disabled={toAdd.length === 0 || busy}
              className="h-8 text-xs shrink-0"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add
            </Button>
          </div>
        </div>

        {/* Relabel note */}
        <div className="flex gap-2 rounded-md border border-border/40 bg-muted/10 p-2.5">
          <Info className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Changes apply to the domains list and newly-created nodes immediately.
            Existing nodes are relabeled in the background.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border p-4 space-y-2">
        {error && <p className="text-xs text-destructive leading-snug">{error}</p>}
        {domain.members.length > 0 ? (
          <p className="text-[10px] text-muted-foreground/60 text-center">
            Remove all member types to delete this domain.
          </p>
        ) : (
          <Button
            variant="ghost"
            onClick={onDelete}
            disabled={busy}
            className="w-full text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3 w-3 mr-1.5" />
            Delete empty domain
          </Button>
        )}
      </div>
    </div>
  )
}
