"use client"

import { useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"
import { getSchemaIconInfo } from "@/lib/schema-icons"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { BoostButton } from "@/components/boost/boost-button"
import { NodePreviewPanel } from "./node-preview-panel"
import { useGraphStore } from "@/stores/graph-store"
import { useAppStore } from "@/stores/app-store"
import { useSchemaStore } from "@/stores/schema-store"
import { cn } from "@/lib/utils"
import type { GraphNode } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"

const DISPLAY_KEY_FALLBACKS = ["name", "title", "label", "text", "content", "body"] as const

function pickString(props: Record<string, unknown> | undefined, key: string | undefined): string | undefined {
  if (!props || !key) return undefined
  const v = props[key]
  return typeof v === "string" && v.length > 0 ? v : undefined
}

function NodeRow({ node, schemas, onClick, onMouseEnter, onMouseLeave }: { node: GraphNode; schemas: SchemaNode[]; onClick: () => void; onMouseEnter: () => void; onMouseLeave: () => void }) {
  const nodeType = node.node_type ?? "Unknown"
  const schema = schemas.find((s) => s.type === nodeType)
  // Priority: title_key → index (sphinx convention) → common display-ish
  // property names → ref_id. The last step catches nodes whose schema key
  // isn't populated on this particular row.
  const props = node.properties
  let name = pickString(props, schema?.title_key) ?? pickString(props, schema?.index)
  if (!name) {
    for (const key of DISPLAY_KEY_FALLBACKS) {
      name = pickString(props, key)
      if (name) break
    }
  }
  if (!name) name = node.ref_id

  const pubkey = typeof props?.pubkey === "string" ? props.pubkey : undefined
  const routeHint = typeof props?.route_hint === "string" ? props.route_hint : undefined
  const boostAmt = typeof props?.boost === "number" ? props.boost : 0
  const { icon: Icon, accent } = getSchemaIconInfo(schema?.icon)

  return (
    <button onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className="flex items-center gap-3 px-4 py-3 w-full text-left cursor-pointer hover:bg-sidebar-accent transition-colors group">
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border"
        style={{ backgroundColor: `${accent}15`, borderColor: `${accent}30` }}
      >
        <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
      </div>
      <div className="flex-1 min-w-0 overflow-hidden">
        <p className="text-sm text-foreground truncate">{name}</p>
        <Badge
          variant="outline"
          className="mt-0.5 text-[9px] px-1.5 py-0 h-4 border-border/50 text-muted-foreground font-mono"
        >
          {nodeType}
        </Badge>
      </div>
      {pubkey && (
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          <BoostButton refId={node.ref_id} pubkey={pubkey} routeHint={routeHint} boostCount={boostAmt} className="shrink-0" />
        </div>
      )}
    </button>
  )
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
    setActiveTypes(new Set())
  }, [searchTerm, setSelectedNode])

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

  if (!searchTerm) return null

  const filtering = activeTypes.size > 0

  return (
    <div className="flex h-full flex-col overflow-hidden bg-sidebar border-r border-sidebar-border w-[300px] noise-bg">
      {selectedNode ? (
        <NodePreviewPanel
          node={selectedNode}
          onBack={() => { setSelectedNode(null); setSidebarSelectedNode(null) }}
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
              Searching &ldquo;<span className="text-foreground">{searchTerm}</span>&rdquo;
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
                {filteredNodes.map((node, i) => (
                  <div key={node.ref_id}>
                    <NodeRow
                      node={node}
                      schemas={schemas}
                      onClick={() => { setSelectedNode(node); setSidebarSelectedNode(node) }}
                      onMouseEnter={() => setHoveredNode(node)}
                      onMouseLeave={() => setHoveredNode(null)}
                    />
                    {i < filteredNodes.length - 1 && (
                      <Separator className="bg-sidebar-border/50" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </>
      )}
    </div>
  )
}
