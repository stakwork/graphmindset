"use client"

import React, { useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { NodePreviewPanel } from "./node-preview-panel"
import { NodeRow } from "./node-row"
import { useGraphStore } from "@/stores/graph-store"
import { useAppStore } from "@/stores/app-store"
import { useSchemaStore } from "@/stores/schema-store"
import { pickString, DISPLAY_KEY_FALLBACKS } from "@/lib/node-display"
import { cn, displayNodeType } from "@/lib/utils"
import type { GraphNode } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"

function highlightTerm(text: string, term: string): React.ReactNode[] {
  if (!term) return [text]
  const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
  const parts = text.split(regex)
  return parts.map((part, i) =>
    regex.test(part)
      ? <span key={i} className="font-semibold text-primary">{part}</span>
      : part
  )
}

function buildMatchExcerpt(node: GraphNode, schemas: SchemaNode[], searchTerm: string): React.ReactNode | undefined {
  const schema = schemas.find((s) => s.type === (node.node_type ?? "Unknown"))
  const titleKey = schema?.title_key ?? schema?.index
  const isTitleMatch = node.matched_property !== undefined && node.matched_property === titleKey
  if (!isTitleMatch && node.match_excerpt != null) {
    return (
      <p className="text-[10px] font-mono text-muted-foreground/70 truncate mt-0.5">
        <span className="text-muted-foreground/50">{node.matched_property}: </span>
        {highlightTerm(node.match_excerpt, searchTerm)}
      </p>
    )
  }
  return undefined
}

export function SearchResultsPanel({ onClose }: { onClose: () => void }) {
  const { nodes, edges, loading, selectedNode, setSelectedNode } = useGraphStore()
  const setHoveredNode = useGraphStore((s) => s.setHoveredNode)
  const setSidebarSelectedNode = useGraphStore((s) => s.setSidebarSelectedNode)
  const searchTerm = useAppStore((s) => s.searchTerm)
  const schemas = useSchemaStore((s) => s.schemas)
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set())

  useEffect(() => {
    setSelectedNode(null)
    setSidebarSelectedNode(null)
    setHoveredNode(null)
    setActiveTypes(new Set())
  }, [searchTerm, setSelectedNode, setSidebarSelectedNode, setHoveredNode])

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of nodes) {
      const t = n.node_type ?? "Unknown"
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [nodes])

  const filteredNodes = useMemo(
    () =>
      activeTypes.size === 0
        ? nodes
        : nodes.filter((n) => activeTypes.has(n.node_type ?? "Unknown")),
    [nodes, activeTypes]
  )

  const toggleType = (type: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  // No early return on empty searchTerm anymore — the panel also renders the
  // initial "latest" load that populates the store before any user search.
  const filtering = activeTypes.size > 0

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {selectedNode ? (
        <NodePreviewPanel
          node={selectedNode}
          onBack={() => { setSelectedNode(null); setSidebarSelectedNode(null); setHoveredNode(null) }}
          schemas={schemas}
        />
      ) : (
        <>
          <div className="relative z-10 flex items-center justify-between px-4 py-3 border-b border-sidebar-border">
            <div>
              <h3 className="text-sm font-heading font-semibold tracking-wide text-sidebar-foreground">
                Results
              </h3>
              <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                {filtering ? `${filteredNodes.length} of ${nodes.length}` : nodes.length} nodes &middot; {edges.length} edges
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="relative z-10 px-4 py-2 border-b border-sidebar-border/50">
            <p className="text-xs text-muted-foreground">
              {searchTerm
                ? <>Searching &ldquo;<span className="text-foreground">{searchTerm}</span>&rdquo;</>
                : <span>Latest activity</span>}
            </p>
          </div>

          {typeCounts.length > 1 && (
            <div className="relative z-10 px-4 py-2 border-b border-sidebar-border/50">
              <div className="flex flex-wrap gap-1">
                {typeCounts.map(([type, count]) => {
                  const active = activeTypes.has(type)
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleType(type)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono transition-colors cursor-pointer",
                        active
                          ? "border-primary/40 bg-primary/15 text-foreground"
                          : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                      )}
                    >
                      <span>{type}</span>
                      <span className={cn("text-[9px]", active ? "text-primary" : "text-muted-foreground/70")}>
                        {count}
                      </span>
                    </button>
                  )
                })}
                {filtering && (
                  <button
                    type="button"
                    onClick={() => setActiveTypes(new Set())}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

          <ScrollArea className="relative z-10 flex-1 min-h-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-5 w-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
              </div>
            ) : filteredNodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <p className="text-sm text-muted-foreground">
                  {nodes.length === 0 ? "No results found" : "No results match the selected types"}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  {nodes.length === 0 ? "Try a different search term" : "Try clearing or changing filters"}
                </p>
              </div>
            ) : (
              <div className="py-1">
                {filteredNodes.map((node, i) => {
                  const schema = schemas.find((s) => s.type === (node.node_type ?? "Unknown"))
                  const titleKey = schema?.title_key ?? schema?.index
                  let name = pickString(node.properties, titleKey)
                  if (!name) {
                    for (const key of DISPLAY_KEY_FALLBACKS) {
                      name = pickString(node.properties, key)
                      if (name) break
                    }
                  }
                  if (!name) name = node.ref_id
                  const isTitleMatch = node.matched_property !== undefined && node.matched_property === titleKey
                  return (
                  <div key={node.ref_id}>
                    <NodeRow
                      node={node}
                      schemas={schemas}
                      nameDisplay={isTitleMatch ? highlightTerm(name, searchTerm) : undefined}
                      matchExcerpt={buildMatchExcerpt(node, schemas, searchTerm)}
                      onClick={() => { setSelectedNode(node); setSidebarSelectedNode(node) }}
                      onMouseEnter={() => setHoveredNode(node)}
                      onMouseLeave={() => setHoveredNode(null)}
                    />
                    {i < filteredNodes.length - 1 && (
                      <Separator className="bg-sidebar-border/50" />
                    )}
                  </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </>
      )}
    </div>
  )
}
