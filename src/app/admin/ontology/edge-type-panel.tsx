"use client"

import { X, GitMerge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Label } from "@/components/ui/label"
import type { SchemaEdge, SchemaNode } from "@/lib/schema-types"

interface Props {
  edgeType: string
  edges: SchemaEdge[]
  allSchemas: SchemaNode[]
  onClose: () => void
}

export function EdgeTypePanel({ edgeType, edges, allSchemas, onClose }: Props) {
  const refIdToType = Object.fromEntries(allSchemas.map((s) => [s.ref_id, s]))

  // Deduplicate attributes across all edges of this type
  const attrMap = new Map<string, { type: string; optional: boolean }>()
  let hasAttributes = false
  for (const e of edges) {
    if (!e.attributes) continue
    const attrs = e.attributes
    for (const [key, rawType] of Object.entries(attrs)) {
      if (typeof rawType !== "string") continue
      hasAttributes = true
      if (!attrMap.has(key)) {
        const optional = rawType.startsWith("?")
        attrMap.set(key, { type: rawType.replace(/^\?/, ""), optional })
      }
    }
  }

  const attrEntries = Array.from(attrMap.entries())

  return (
    <div className="w-[340px] shrink-0 border-l border-border flex flex-col bg-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground mb-1">
            Edge Type
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
                const sourceLabel =
                  e.source_type ?? refIdToType[e.source]?.type ?? e.source
                const targetLabel =
                  e.target_type ?? refIdToType[e.target]?.type ?? e.target
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
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Attributes section — only render if any edge has attributes */}
        {hasAttributes && (
          <>
            <Separator className="bg-border/30" />
            <div className="space-y-2">
              <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
                Attributes
              </Label>
              <div className="space-y-1.5">
                {attrEntries.map(([key, { type, optional }]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-md border border-border/20 bg-muted/10 px-2 py-1.5 opacity-80"
                  >
                    <span className="text-[10px] font-mono text-muted-foreground">{key}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-mono text-muted-foreground/60 rounded bg-muted/30 px-1 py-0.5">
                        {type}
                      </span>
                      <span className="text-[9px] text-muted-foreground/50">
                        {optional ? "Optional" : "Required"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
