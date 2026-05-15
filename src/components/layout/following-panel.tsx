"use client"

import { useCallback, useEffect, useState } from "react"
import { X, Loader2, Heart, Bookmark, Trash2 } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { FeedCard } from "@/components/feed/feed-card"
import { NodeRow } from "./node-row"
import { useSchemaStore } from "@/stores/schema-store"
import { useGraphStore } from "@/stores/graph-store"
import {
  getFollowingFeed,
  getWatches,
  unwatchNode,
  unsubscribeType,
} from "@/lib/watch-api"
import type { GraphNode, GraphEdge } from "@/lib/graph-api"
import type { WatchEntry } from "@/lib/watch-api"

export function FollowingPanel({ onClose }: { onClose: () => void }) {
  const schemas = useSchemaStore((s) => s.schemas)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const setSidebarSelectedNode = useGraphStore((s) => s.setSidebarSelectedNode)
  const setHoveredNode = useGraphStore((s) => s.setHoveredNode)

  // Feed tab state
  const [feedNodes, setFeedNodes] = useState<GraphNode[]>([])
  const [feedEdges, setFeedEdges] = useState<GraphEdge[]>([])
  const [feedLoading, setFeedLoading] = useState(true)

  // Watching tab state
  const [watchedNodes, setWatchedNodes] = useState<WatchEntry[]>([])
  const [subscribedTypes, setSubscribedTypes] = useState<string[]>([])
  const [watchesLoading, setWatchesLoading] = useState(true)

  // hasWatches is used to distinguish "no watches" vs "watches but no content"
  const [hasWatches, setHasWatches] = useState(false)

  // Inline-confirm unwatch state
  const [confirmUnwatchId, setConfirmUnwatchId] = useState<string | null>(null)

  const fetchFeed = useCallback(async () => {
    setFeedLoading(true)
    try {
      const res = await getFollowingFeed()
      setFeedNodes(res.nodes ?? [])
      setFeedEdges(res.edges ?? [])
    } catch {
      setFeedNodes([])
      setFeedEdges([])
    } finally {
      setFeedLoading(false)
    }
  }, [])

  const fetchWatches = useCallback(async () => {
    setWatchesLoading(true)
    try {
      const res = await getWatches()
      setWatchedNodes(res.nodes ?? [])
      setSubscribedTypes(res.types ?? [])
      setHasWatches((res.nodes?.length ?? 0) > 0 || (res.types?.length ?? 0) > 0)
    } catch {
      setWatchedNodes([])
      setSubscribedTypes([])
      setHasWatches(false)
    } finally {
      setWatchesLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchFeed()
    fetchWatches()
  }, [fetchFeed, fetchWatches])

  const handleUnwatch = async (refId: string) => {
    try {
      await unwatchNode(refId)
      setWatchedNodes((prev) => prev.filter((n) => n.ref_id !== refId))
      setConfirmUnwatchId(null)
      // Refresh feed since watched set changed
      fetchFeed()
    } catch {
      setConfirmUnwatchId(null)
    }
  }

  const handleUnsubscribeType = async (nodeType: string) => {
    try {
      await unsubscribeType(nodeType)
      setSubscribedTypes((prev) => prev.filter((t) => t !== nodeType))
      // Refresh feed since subscription set changed
      fetchFeed()
    } catch {
      // keep the badge, silent fail
    }
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-4 py-3 border-b border-sidebar-border">
        <h3 className="text-sm font-heading font-semibold tracking-wide text-sidebar-foreground">
          Following
        </h3>
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Tabs defaultValue="feed" className="flex flex-col flex-1 min-h-0">
        <TabsList className="w-full rounded-none border-b border-sidebar-border shrink-0">
          <TabsTrigger value="feed" className="flex-1">Feed</TabsTrigger>
          <TabsTrigger value="watching" className="flex-1">Watching</TabsTrigger>
        </TabsList>

        {/* Feed tab */}
        <TabsContent value="feed" className="flex-1 min-h-0 mt-0 data-[state=active]:flex data-[state=active]:flex-col">
          <ScrollArea className="relative z-10 flex-1 min-h-0">
            {feedLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !hasWatches ? (
              /* Empty state: user hasn't watched anything yet */
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-3">
                <Heart className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">Nothing here yet</p>
                <p className="text-xs text-muted-foreground/60 max-w-xs">
                  Watch a node from its preview panel or subscribe to a node type from the feed
                  filter chips to start building your Following feed.
                </p>
              </div>
            ) : feedNodes.length === 0 ? (
              /* Empty state: has watches but no new content yet */
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-3">
                <p className="text-sm text-muted-foreground">No new content yet — check back soon.</p>
              </div>
            ) : (
              <div className="py-2 px-3 flex flex-col gap-3">
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

        {/* Watching tab */}
        <TabsContent value="watching" className="flex-1 min-h-0 mt-0 data-[state=active]:flex data-[state=active]:flex-col">
          <ScrollArea className="relative z-10 flex-1 min-h-0">
            {watchesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : watchedNodes.length === 0 && subscribedTypes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-3">
                <Bookmark className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">You&apos;re not watching anything yet.</p>
              </div>
            ) : (
              <div>
                {/* Watched nodes */}
                {watchedNodes.length > 0 && (
                  <div className="py-1">
                    {watchedNodes.map((entry, i) => {
                      const isConfirming = confirmUnwatchId === entry.ref_id
                      // Build a minimal GraphNode for NodeRow
                      const nodeForRow: GraphNode = {
                        ref_id: entry.ref_id,
                        node_type: entry.node_type ?? "Unknown",
                        properties: { name: entry.title ?? entry.ref_id },
                        date_added_to_graph: 0,
                      }
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
                                  setConfirmUnwatchId(entry.ref_id)
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
                                onClick={() => setConfirmUnwatchId(null)}
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
                  </div>
                )}

                {/* Separator between sections if both exist */}
                {watchedNodes.length > 0 && subscribedTypes.length > 0 && (
                  <Separator className="my-2 bg-sidebar-border" />
                )}

                {/* Subscribed types */}
                {subscribedTypes.length > 0 && (
                  <div className="px-4 py-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                      Subscribed Types
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {subscribedTypes.map((type) => (
                        <Badge
                          key={type}
                          variant="secondary"
                          className="flex items-center gap-1 pr-1.5"
                        >
                          <span>{type}</span>
                          <button
                            onClick={() => handleUnsubscribeType(type)}
                            className="ml-0.5 rounded-full text-muted-foreground hover:text-foreground transition-colors"
                            aria-label={`Unsubscribe from ${type}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}
