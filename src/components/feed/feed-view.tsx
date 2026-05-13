"use client"

import { useEffect, useMemo, useState } from "react"
import { Search as SearchIcon } from "lucide-react"
import { useGraphStore } from "@/stores/graph-store"
import { useAppStore } from "@/stores/app-store"
import { useSchemaStore } from "@/stores/schema-store"
import { isMocksEnabled, MOCK_NODES, MOCK_EDGES } from "@/lib/mock-data"
import { getLatestNodes } from "@/lib/graph-api"
import { FeedCard } from "./feed-card"
import { HotTakes } from "./hot-takes"
import { cn } from "@/lib/utils"

export function FeedView() {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const loading = useGraphStore((s) => s.loading)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const setSidebarSelectedNode = useGraphStore((s) => s.setSidebarSelectedNode)
  const setHoveredNode = useGraphStore((s) => s.setHoveredNode)
  const clearSelection = useGraphStore((s) => s.clearSelection)
  const setGraphData = useGraphStore((s) => s.setGraphData)
  const setLoading = useGraphStore((s) => s.setLoading)
  const searchTerm = useAppStore((s) => s.searchTerm)
  const schemas = useSchemaStore((s) => s.schemas)

  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set())

  useEffect(() => {
    clearSelection()
    setActiveTypes(new Set())
  }, [searchTerm, clearSelection])

  // Mocks mode seeds from fixtures so the Latest feed has content before any search.
  useEffect(() => {
    if (useGraphStore.getState().nodes.length > 0) return
    if (isMocksEnabled()) {
      setGraphData(MOCK_NODES, MOCK_EDGES)
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const result = await getLatestNodes()
        if (cancelled) return
        setGraphData(result.nodes ?? [], result.edges ?? [])
      } catch (err) {
        console.error("[feed-view] getLatestNodes failed:", err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of nodes) {
      const t = n.node_type ?? "Unknown"
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [nodes])

  const filtered = useMemo(
    () =>
      activeTypes.size === 0
        ? nodes
        : nodes.filter((n) => activeTypes.has(n.node_type ?? "Unknown")),
    [nodes, activeTypes]
  )

  function toggleType(type: string) {
    setActiveTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const hasResults = nodes.length > 0
  const filtering = activeTypes.size > 0

  // Hot Takes only belongs on the landing surface (no active search).
  const showHotTakes = !searchTerm

  return (
    <div className="h-full w-full overflow-y-auto">
      {showHotTakes && <HotTakes />}

      {typeCounts.length > 1 && (
        <FilterChips
          typeCounts={typeCounts}
          activeTypes={activeTypes}
          onClear={() => setActiveTypes(new Set())}
          onToggle={toggleType}
        />
      )}

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-3 pb-[200px]">
        {loading && !hasResults && (
          <div className="flex items-center justify-center py-24">
            <div className="h-6 w-6 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          </div>
        )}

        {!loading && !hasResults && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <SearchIcon className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {searchTerm ? "No results found" : "Start by searching"}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {searchTerm
                ? "Try a different search term"
                : "Use the search above, or open Sources / My Content from the rail"}
            </p>
          </div>
        )}

        {filtered.map((node) => (
          <FeedCard
            key={node.ref_id}
            node={node}
            schemas={schemas}
            onSelect={() => {
              setSelectedNode(node)
              setSidebarSelectedNode(node)
            }}
            onHover={(h) => setHoveredNode(h ? node : null)}
          />
        ))}

        {hasResults && (
          <div className="text-center py-8 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
            ◇ End of {searchTerm ? "results" : "feed"}
          </div>
        )}
      </div>
    </div>
  )
}

function FilterChips({
  typeCounts,
  activeTypes,
  onClear,
  onToggle,
}: {
  typeCounts: [string, number][]
  activeTypes: Set<string>
  onClear: () => void
  onToggle: (type: string) => void
}) {
  const filtering = activeTypes.size > 0
  return (
    <div className="sticky top-0 z-10 bg-background/85 backdrop-blur-sm border-b border-border/40">
      <div className="max-w-3xl mx-auto px-6 py-2.5 flex flex-wrap items-center gap-1.5">
        <button
          onClick={onClear}
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium transition-colors",
            !filtering
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-card/70 hover:text-foreground"
          )}
        >
          All
        </button>
        {typeCounts.map(([type, count]) => {
          const active = activeTypes.has(type)
          return (
            <button
              key={type}
              onClick={() => onToggle(type)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 border",
                active
                  ? "bg-primary/15 text-foreground border-primary/40"
                  : "text-muted-foreground hover:bg-card/70 hover:text-foreground border-transparent"
              )}
            >
              <span>{type}</span>
              <span className="font-mono text-[10px] opacity-60">{count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
