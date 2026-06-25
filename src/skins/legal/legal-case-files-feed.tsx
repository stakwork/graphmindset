"use client"

import { useEffect, useMemo, useState } from "react"
import { useGraphStore } from "@/stores/graph-store"
import { useAppStore } from "@/stores/app-store"
import { useSchemaStore } from "@/stores/schema-store"
import { isMocksEnabled, MOCK_NODES, MOCK_EDGES } from "@/lib/mock-data"
import { getLatestNodes } from "@/lib/graph-api"
import { cn } from "@/lib/utils"
import type { GraphNode } from "@/lib/graph-api"

const LEGAL_TYPE_MAP: Record<string, string> = {
  Topic: "BRIEF",
  Person: "COUNSEL",
  Episode: "PROCEEDING",
  Clip: "EXCERPT",
}

function legalLabel(nodeType: string | undefined): string {
  return LEGAL_TYPE_MAP[nodeType ?? ""] ?? "FILING"
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return ""
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return ""
  }
}

interface LegalDocCardProps {
  node: GraphNode
  onSelect: () => void
}

function LegalDocCard({ node, onSelect }: LegalDocCardProps) {
  const title =
    (node.properties?.title as string | undefined) ??
    (node.properties?.name as string | undefined) ??
    node.ref_id

  const dateStr =
    (node.properties?.date as string | undefined) ??
    (node.properties?.date_added as string | undefined)

  const edgeCount = (node.properties?.edge_count as number | undefined) ?? 0

  return (
    <button
      type="button"
      className="w-full text-left group"
      onClick={onSelect}
    >
      <div className="border-t border-primary/30 py-3 px-1 hover:bg-primary/5 transition-colors">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Type badge */}
            <span className="inline-block text-[9px] font-mono font-semibold tracking-[0.2em] uppercase text-primary/70 mb-1">
              {legalLabel(node.node_type)}
            </span>

            {/* Title */}
            <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
              {title}
            </p>

            {/* Metadata */}
            <p className="mt-1 text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60">
              {[formatDate(dateStr), edgeCount > 0 ? `${edgeCount} links` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
      </div>
    </button>
  )
}

export function LegalCaseFilesFeed() {
  const nodes = useGraphStore((s) => s.nodes)
  const loading = useGraphStore((s) => s.loading)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const setSidebarSelectedNode = useGraphStore((s) => s.setSidebarSelectedNode)
  const clearSelection = useGraphStore((s) => s.clearSelection)
  const setGraphData = useGraphStore((s) => s.setGraphData)
  const setLoading = useGraphStore((s) => s.setLoading)
  const searchTerm = useAppStore((s) => s.searchTerm)

  const [activeType, setActiveType] = useState<string | null>(null)

  useEffect(() => {
    clearSelection()
    setActiveType(null)
  }, [searchTerm, clearSelection])

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
        console.error("[legal-feed] getLatestNodes failed:", err)
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
    () => (activeType === null ? nodes : nodes.filter((n) => (n.node_type ?? "Unknown") === activeType)),
    [nodes, activeType]
  )

  const hasResults = nodes.length > 0

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-primary/20 px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-mono font-semibold tracking-[0.3em] uppercase text-primary">
            Case Files
          </span>
          <span className="h-px flex-1 bg-primary/20" />
          <span className="text-[9px] font-mono text-muted-foreground/50 tracking-widest">
            {searchTerm ? "RESULTS" : "LATEST"}
          </span>
        </div>

        {/* Type filter chips */}
        {typeCounts.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setActiveType(null)}
              className={cn(
                "text-[9px] font-mono tracking-[0.15em] uppercase px-2 py-0.5 rounded border transition-colors",
                activeType === null
                  ? "border-primary text-primary bg-primary/10"
                  : "border-border/50 text-muted-foreground hover:border-primary/50"
              )}
            >
              All
            </button>
            {typeCounts.map(([type, count]) => (
              <button
                key={type}
                type="button"
                onClick={() => setActiveType(activeType === type ? null : type)}
                className={cn(
                  "text-[9px] font-mono tracking-[0.15em] uppercase px-2 py-0.5 rounded border transition-colors",
                  activeType === type
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border/50 text-muted-foreground hover:border-primary/50"
                )}
              >
                {legalLabel(type)} ({count})
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-4 pb-[200px]">
        {loading && !hasResults && (
          <div className="flex items-center justify-center py-24">
            <div className="h-5 w-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          </div>
        )}

        {!loading && !hasResults && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
              No documents found
            </p>
            <p className="text-[9px] font-mono text-muted-foreground/50 mt-2 tracking-[0.15em] uppercase">
              {searchTerm ? "Refine your search" : "Begin search to load filings"}
            </p>
          </div>
        )}

        {filtered.map((node) => (
          <LegalDocCard
            key={node.ref_id}
            node={node}
            onSelect={() => {
              setSelectedNode(node)
              setSidebarSelectedNode(node)
            }}
          />
        ))}

        {hasResults && (
          <div className="text-center py-8 font-mono text-[9px] uppercase tracking-[0.25em] text-muted-foreground/40">
            — End of Docket —
          </div>
        )}
      </div>
    </div>
  )
}
