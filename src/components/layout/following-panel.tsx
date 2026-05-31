"use client"

import { useEffect, useState } from "react"
import { X, Loader2, Heart, Bookmark, Trash2, X as XIcon } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { FeedCard } from "@/components/feed/feed-card"
import { NodeRow } from "./node-row"
import { getFollowingFeed, getWatches, unwatchNode, unsubscribeType } from "@/lib/watch-api"
import type { WatchEntry } from "@/lib/watch-api"
import type { GraphNode, GraphEdge } from "@/lib/graph-api"
import { useSchemaStore } from "@/stores/schema-store"
import { useGraphStore } from "@/stores/graph-store"

export function FollowingPanel({ onClose }: { onClose: () => void }) {
  const schemas = useSchemaStore((s) => s.schemas)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const setSidebarSelectedNode = useGraphStore((s) => s.setSidebarSelectedNode)
  const setHoveredNode = useGraphStore((s) => s.setHoveredNode)

  // Feed tab state
  const [feedNodes, setFeedNodes] = useState<GraphNode[]>([])
  const [feedLoading, setFeedLoading] = useState(true)
  const [hasWatches, setHasWatches] = useState<boolean | null>(null)

  // Watching tab state
  const [watchedNodes, setWatchedNodes] = useState<WatchEntry[]>([])
  const [watchedTypes, setWatchedTypes] = useState<string[]>([])
  const [watchingLoading, setWatchingLoading] = useState(true)
  const [unwatchingId, setUnwatchingId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"feed" | "watching">("feed")

  // Fetch feed data on mount
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setFeedLoading(true)
      try {
        const [feedData, watchData] = await Promise.all([
          getFollowingFeed(),
          getWatches(),
        ])
        if (cancelled) return
        setFeedNodes(feedData.nodes ?? [])
        const hasAny =
          (watchData.nodes?.length ?? 0) > 0 || (watchData.types?.length ?? 0) > 0
        setHasWatches(hasAny)
      } catch {
        if (!cancelled) {
          setFeedNodes([])
          setHasWatches(false)
        }
      } finally {
        if (!cancelled) setFeedLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  // Fetch watching data on mount
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setWatchingLoading(true)
      try {
        const data = await getWatches()
        if (cancelled) return
        setWatchedNodes(data.nodes ?? [])
        setWatchedTypes(data.types ?? [])
      } catch {
        if (!cancelled) {
          setWatchedNodes([])
          setWatchedTypes([])
        }
      } finally {
        if (!cancelled) setWatchingLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  const handleUnwatch = async (refId: string) => {
    await unwatchNode(refId)
    setWatchedNodes((prev) => prev.filter((n) => n.ref_id !== refId))
    setUnwatchingId(null)
  }

  const handleUnsubscribeType = async (nodeType: string) => {
    await unsubscribeType(nodeType)
    setWatchedTypes((prev) => prev.filter((t) => t !== nodeType))
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="relative z-10 flex items-center justify-between px-4 py-3 border-b border-sidebar-border">
        <h3 className="text-sm font-heading font-semibold tracking-wide text-sidebar-foreground">
          Following
        </h3>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "feed" | "watching")}
        className="flex flex-col flex-1 min-h-0"
      >
        <TabsList className="w-full rounded-none border-b border-sidebar-border shrink-0">
          <TabsTrigger value="feed" className="flex-1">Feed</TabsTrigger>
          <TabsTrigger value="watching" className="flex-1">Watching</TabsTrigger>
        </TabsList>

        {/* Feed Tab */}
        <TabsContent
          value="feed"
          className="flex-1 min-h-0 mt-0 data-[state=active]:flex data-[state=active]:flex-col"
        >
          <ScrollArea className="relative z-10 flex-1 min-h-0">
            {feedLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : hasWatches === false ? (
              // Empty state A — no watches
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-3">
                <Heart className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Nothing here yet</p>
                <p className="text-xs text-muted-foreground/60">
                  Watch a node from its preview panel, or subscribe to a type using the bookmark
                  icon on the feed filter chips.
                </p>
              </div>
            ) : feedNodes.length === 0 ? (
              // Empty state B — has watches but no results
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-3">
                <p className="text-sm text-muted-foreground">
                  No new content yet — check back soon.
                </p>
              </div>
            ) : (
              <div className="py-2 flex flex-col gap-2 px-2">
                {feedNodes.map((node) => (
                  <FeedCard
                    key={node.ref_id}
                    node={node}
                    schemas={schemas}
                    onSelect={() => {
                      setSelectedNode(node)
                      setSidebarSelectedNode(node)
                    }}
                    onHover={(hovering) => setHoveredNode(hovering ? node : null)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* Watching Tab */}
        <TabsContent
          value="watching"
          className="flex-1 min-h-0 mt-0 data-[state=active]:flex data-[state=active]:flex-col"
        >
          <ScrollArea className="relative z-10 flex-1 min-h-0">
            {watchingLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : watchedNodes.length === 0 && watchedTypes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-3">
                <Bookmark className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {"You're not watching anything yet."}
                </p>
              </div>
            ) : (
              <div className="py-1">
                {/* Watched nodes */}
                {watchedNodes.map((entry, i) => {
                  const isConfirming = unwatchingId === entry.ref_id
                  // Build a minimal GraphNode-like object for NodeRow
                  const nodeForRow = {
                    ref_id: entry.ref_id,
                    node_type: entry.node_type ?? "Node",
                    properties: entry.properties ?? {},
                  } as GraphNode

                  return (
                    <div key={entry.ref_id}>
                      <div className="relative group">
                        <NodeRow
                          node={nodeForRow}
                          schemas={schemas}
                          onClick={() => {}}
                          onMouseEnter={() => {}}
                          onMouseLeave={() => {}}
                          hideBoost={true}
                        />
                        {!isConfirming && (
                          <button
                            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation()
                              setUnwatchingId(entry.ref_id)
                            }}
                            aria-label="Unwatch node"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {isConfirming && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 border-t border-destructive/20">
                          <span className="text-xs text-destructive flex-1">Unwatch?</span>
                          <button
                            className="text-xs font-medium text-destructive hover:text-destructive/80 transition-colors"
                            onClick={() => handleUnwatch(entry.ref_id)}
                          >
                            Confirm
                          </button>
                          <button
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setUnwatchingId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      {i < watchedNodes.length - 1 && (
                        <Separator className="bg-sidebar-border/50" />
                      )}
                    </div>
                  )
                })}

                {/* Subscribed types */}
                {watchedTypes.length > 0 && (
                  <>
                    {watchedNodes.length > 0 && (
                      <Separator className="bg-sidebar-border/50 my-2" />
                    )}
                    <div className="px-4 py-2 flex flex-wrap gap-2">
                      {watchedTypes.map((nodeType) => (
                        <Badge
                          key={nodeType}
                          variant="outline"
                          className="flex items-center gap-1 pr-1"
                        >
                          <span>{nodeType}</span>
                          <button
                            aria-label={`Unsubscribe from ${nodeType}`}
                            onClick={() => handleUnsubscribeType(nodeType)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <XIcon className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}
