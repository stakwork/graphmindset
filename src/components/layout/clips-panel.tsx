"use client"

import { useEffect, useState } from "react"
import { Loader2, X } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useGraphStore } from "@/stores/graph-store"
import { useSchemaStore } from "@/stores/schema-store"
import { useAppStore } from "@/stores/app-store"
import { listLatestByType } from "@/lib/graph-api"
import { isMocksEnabled, MOCK_NODES } from "@/lib/mock-data"
import { SideCard } from "@/components/feed/hot-takes"
import type { GraphNode } from "@/lib/graph-api"

const PAGE_SIZE = 20

export function ClipsPanel({ onClose }: { onClose: () => void }) {
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const setSidebarSelectedNode = useGraphStore((s) => s.setSidebarSelectedNode)
  const setClipsOpen = useAppStore((s) => s.setClipsOpen)
  const schemas = useSchemaStore((s) => s.schemas)

  const [clips, setClips] = useState<GraphNode[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [skip, setSkip] = useState(0)
  const [hasMore, setHasMore] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchInitial() {
      setLoading(true)
      try {
        if (isMocksEnabled()) {
          const all = MOCK_NODES
            .filter((n) => n.node_type === "Clip")
            .sort((a, b) => (b.date_added_to_graph ?? 0) - (a.date_added_to_graph ?? 0))
          setClips(all.slice(0, PAGE_SIZE))
          setHasMore(all.length > PAGE_SIZE)
          setSkip(PAGE_SIZE)
        } else {
          const res = await listLatestByType("Clip", PAGE_SIZE, 0)
          if (!cancelled) {
            const nodes = res.nodes ?? []
            setClips(nodes)
            setHasMore(nodes.length === PAGE_SIZE)
            setSkip(PAGE_SIZE)
          }
        }
      } catch (err) {
        if (!cancelled) console.error("[clips-panel] fetch failed:", err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchInitial()
    return () => { cancelled = true }
  }, [])

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      if (isMocksEnabled()) {
        const all = MOCK_NODES
          .filter((n) => n.node_type === "Clip")
          .sort((a, b) => (b.date_added_to_graph ?? 0) - (a.date_added_to_graph ?? 0))
        const next = all.slice(skip, skip + PAGE_SIZE)
        setClips((prev) => [...prev, ...next])
        setHasMore(skip + PAGE_SIZE < all.length)
        setSkip((s) => s + PAGE_SIZE)
      } else {
        const res = await listLatestByType("Clip", PAGE_SIZE, skip)
        const next = res.nodes ?? []
        setClips((prev) => [...prev, ...next])
        setHasMore(next.length === PAGE_SIZE)
        setSkip((s) => s + PAGE_SIZE)
      }
    } catch (err) {
      console.error("[clips-panel] load more failed:", err)
    } finally {
      setLoadingMore(false)
    }
  }

  function openClip(node: GraphNode) {
    setSelectedNode(node)
    setSidebarSelectedNode(node)
    setClipsOpen(false)
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="relative z-10 flex items-center justify-between px-4 py-3 border-b border-sidebar-border">
        <div>
          <h3 className="text-sm font-heading font-semibold tracking-wide text-sidebar-foreground">
            Latest Clips
          </h3>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
            {loading ? "Loading…" : `${clips.length}${hasMore ? "+" : ""} clips`}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ScrollArea className="relative z-10 flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : clips.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <p className="text-sm text-muted-foreground">No clips yet</p>
          </div>
        ) : (
          <div className="py-2 px-3 flex flex-col gap-1">
            {clips.map((node) => (
              <SideCard
                key={node.ref_id}
                node={node}
                onOpen={() => openClip(node)}
                schemas={schemas}
              />
            ))}
            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="mt-2 w-full py-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-2"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading…
                  </>
                ) : (
                  "View more"
                )}
              </button>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
