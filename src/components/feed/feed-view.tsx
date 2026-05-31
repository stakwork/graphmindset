"use client"

import { useEffect, useMemo, useState } from "react"
import { Search as SearchIcon, Clock } from "lucide-react"
import { MultiSelectCustom, type MultiSelectOption } from "@/components/ui/multi-select-custom"
import { useGraphStore } from "@/stores/graph-store"
import { useAppStore } from "@/stores/app-store"
import { useSchemaStore } from "@/stores/schema-store"
import { isMocksEnabled, MOCK_NODES, MOCK_EDGES } from "@/lib/mock-data"
import { getLatestNodes } from "@/lib/graph-api"
import { metroSeries } from "@/data/metro"
import type { GraphNode, GraphEdge } from "@/lib/graph-api"
import { FeedCard } from "./feed-card"
import { HotTakes } from "./hot-takes"
import { cn } from "@/lib/utils"

export function FeedView() {
  const nodes = useGraphStore((s) => s.nodes)
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

  // Seed from the local metro fixture first — the platform search/list
  // endpoints strip mapX/mapZ, so the overlay can't position bullets from
  // API payloads alone. Then fetch /v2/nodes/latest and splice in anything
  // the backend has that the fixture doesn't (deduped by ref_id). Backend
  // Station rows are dropped — they'd float without positions, and the
  // fixture is the source of truth for the schematic.
  //
  // Metro fixture seeding is opt-in via NEXT_PUBLIC_METRO_OVERLAY=1. When
  // off, we only load whatever NEXT_PUBLIC_API_URL returns.
  useEffect(() => {
    if (useGraphStore.getState().nodes.length > 0) return
    if (isMocksEnabled()) {
      setGraphData(MOCK_NODES, MOCK_EDGES)
      return
    }

    const metroEnabled = process.env.NEXT_PUBLIC_METRO_OVERLAY === "1"
    const fixtureNodes = metroEnabled ? (metroSeries.nodes as GraphNode[]) : []
    const fixtureEdges = metroEnabled ? (metroSeries.edges as GraphEdge[]) : []
    if (metroEnabled) {
      setGraphData(fixtureNodes, fixtureEdges)
    }

    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const result = await getLatestNodes()
        if (cancelled) return
        const seenNodeIds = new Set(fixtureNodes.map((n) => n.ref_id))
        const seenEdgeKeys = new Set(
          fixtureEdges.map((e) => `${e.source}|${e.target}|${e.edge_type}`),
        )
        const extraNodes = (result.nodes ?? []).filter(
          (n) =>
            (metroEnabled ? n.node_type !== "Station" : true) &&
            !seenNodeIds.has(n.ref_id),
        )
        const extraNodeIds = new Set(extraNodes.map((n) => n.ref_id))
        const extraEdges = (result.edges ?? []).filter((e) => {
          if (seenEdgeKeys.has(`${e.source}|${e.target}|${e.edge_type}`)) return false
          // Both endpoints must exist in the visible node set (fixture or extras)
          // — otherwise the edge dangles. Backend station endpoints get filtered
          // out here since they were dropped above.
          const hasSource = seenNodeIds.has(e.source) || extraNodeIds.has(e.source)
          const hasTarget = seenNodeIds.has(e.target) || extraNodeIds.has(e.target)
          return hasSource && hasTarget
        })
        if (extraNodes.length === 0 && extraEdges.length === 0) {
          if (!metroEnabled) setGraphData([], [])
          return
        }
        setGraphData([...fixtureNodes, ...extraNodes], [...fixtureEdges, ...extraEdges])
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

  const hasResults = nodes.length > 0

  // Hot Takes only belongs on the landing surface (no active search).
  const showHotTakes = !searchTerm

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden">
      {showHotTakes && <HotTakes />}

      {(showHotTakes || typeCounts.length > 1) && (
        <div className="sticky top-0 z-10 bg-background/85 backdrop-blur-sm">
          <div className="max-w-3xl mx-auto px-3 sm:px-6 pt-6 pb-3">
            <div className={cn("flex items-center justify-between gap-3", showHotTakes && "border-t border-border/40 pt-4")}>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm text-foreground">
                  {searchTerm ? "Results" : "Latest"}
                </span>
              </div>
              {typeCounts.length > 1 && (
                <FilterChips
                  typeCounts={typeCounts}
                  activeTypes={activeTypes}
                  onChange={setActiveTypes}
                />
              )}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-6 space-y-3 pb-[200px]">
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
  onChange,
}: {
  typeCounts: [string, number][]
  activeTypes: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const options: MultiSelectOption[] = typeCounts.map(([type, count]) => ({
    value: type,
    label: type,
    hint: String(count),
  }))

  return (
    <MultiSelectCustom
      value={Array.from(activeTypes)}
      onChange={(vals) => onChange(new Set(vals))}
      options={options}
      placeholder="All types"
      className="w-40 shrink-0"
    />
  )
}
