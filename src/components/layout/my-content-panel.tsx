"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Socket } from "socket.io-client"
import { getSocket } from "@/lib/socket"
import { X, Loader2, BookMarked, Trash2, ShoppingBag } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { NodePreviewPanel } from "./node-preview-panel"
import { NodeRow } from "./node-row"
import { api } from "@/lib/api"
import { deleteNode } from "@/lib/graph-api"
import { isMocksEnabled, MOCK_CONTENT, MOCK_PURCHASED_NODES, MOCK_CREATOR_INSIGHTS } from "@/lib/mock-data"
import { getL402 } from "@/lib/sphinx"
import { cookieStorage } from "@/lib/cookie-storage"
import { useUserStore } from "@/stores/user-store"
import { useSchemaStore } from "@/stores/schema-store"
import { useModalStore } from "@/stores/modal-store"
import { useAppStore } from "@/stores/app-store"
import { useGraphStore } from "@/stores/graph-store"
import { isInProgress } from "@/lib/node-status"
import { cn } from "@/lib/utils"
import { fetchCreatorInsights, getGrowthBadge } from "@/lib/creator-insights"
import type { CreatorInsightsResponse, NodeInsight } from "@/lib/creator-insights"
import type { GraphNode } from "@/lib/graph-api"

const POLL_INTERVAL_MS = 5000
const PAGE_SIZE = 50
const STALE_PROCESSING_THRESHOLD_SECONDS = 72 * 60 * 60 // 72 hours

const isStaleProcessing = (node: GraphNode): boolean => {
  if (!isInProgress(node.properties?.status)) return false
  const nowSeconds = Date.now() / 1000
  return (nowSeconds - (node.date_added_to_graph ?? 0)) > STALE_PROCESSING_THRESHOLD_SECONDS
}

function sameContent(a: GraphNode[], b: GraphNode[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].ref_id !== b[i].ref_id) return false
    if (a[i].properties?.status !== b[i].properties?.status) return false
  }
  return true
}

interface ContentResponse {
  nodes: GraphNode[]
  totalCount: number
  totalProcessing: number
}

export function MyContentPanel({ onClose }: { onClose: () => void }) {
  const { pubKey, isAdmin } = useUserStore()
  const myContentRefreshKey = useAppStore((s) => s.myContentRefreshKey)
  const schemas = useSchemaStore((s) => s.schemas)
  const openAdd = useModalStore((s) => s.openAdd)
  const setHoveredNode = useGraphStore((s) => s.setHoveredNode)
  const setSidebarSelectedNode = useGraphStore((s) => s.setSidebarSelectedNode)
  const mocksEnabled = isMocksEnabled()
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [totalProcessing, setTotalProcessing] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const [activeTab, setActiveTab] = useState<'added' | 'purchased'>('added')
  const [purchasedNodes, setPurchasedNodes] = useState<GraphNode[]>([])
  const [purchasedLoading, setPurchasedLoading] = useState(false)

  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const [insights, setInsights] = useState<CreatorInsightsResponse | null>(null)
  const [insightsLoading, setInsightsLoading] = useState(false)

  const [isSocketConnected, setIsSocketConnected] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchFromApi = useCallback(async (limit: number, skip: number): Promise<ContentResponse | null> => {
    // Sphinx path: identity is derived from the auto-attached sig+msg by the
    // api wrapper; boltwall verifies and stamps X-Caller-Pubkey downstream.
    // The client never sends pubkey — that prevents enumerating other users.
    if (pubKey) {
      return api.get<ContentResponse>(`/v2/content?sort_by=date&limit=${limit}&skip=${skip}`)
    }
    // L402 path — api wrapper auto-attaches Authorization header
    const l402 = await getL402()
    if (l402) {
      return api.get<ContentResponse>(`/v2/content?sort_by=date&limit=${limit}&skip=${skip}`)
    }
    // No identity — return empty payload; panel renders empty state
    return { nodes: [], totalCount: 0, totalProcessing: 0 }
  }, [pubKey])

  const applyResponse = useCallback((res: ContentResponse | null) => {
    if (!res) return
    const nextNodes = res.nodes ?? []
    const nextProcessing = nextNodes.filter(
      (n) => isInProgress(n.properties?.status) && !isStaleProcessing(n)
    ).length
    // Guard against identity churn: the poll effect depends on `nodes`, so
    // re-assigning a fresh array every tick would clear+restart the interval.
    setNodes((prev) => (sameContent(prev, nextNodes) ? prev : nextNodes))
    setTotalProcessing((prev) => (prev === nextProcessing ? prev : nextProcessing))
  }, [])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setHasMore(true)
      try {
        if (mocksEnabled) {
          if (cancelled) return
          setNodes(MOCK_CONTENT.nodes as GraphNode[])
          setTotalProcessing(MOCK_CONTENT.totalProcessing)
          setHasMore(false)
        } else {
          const res = await fetchFromApi(PAGE_SIZE, 0)
          if (cancelled) return
          applyResponse(res)
          const next = res?.nodes ?? []
          setHasMore(next.length === PAGE_SIZE)
        }
      } catch {
        if (!cancelled) setNodes([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [mocksEnabled, fetchFromApi, applyResponse, myContentRefreshKey])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const res = await fetchFromApi(PAGE_SIZE, nodes.length)
      if (res) {
        const next = res.nodes ?? []
        setNodes((prev) => [...prev, ...next])
        setHasMore(next.length === PAGE_SIZE)
      }
    } catch {
      // leave existing state
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, nodes.length, fetchFromApi])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore || loadingMore) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore() },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, loadMore])

  // Fetch purchased nodes when tab switches to 'purchased'
  useEffect(() => {
    if (activeTab !== 'purchased') return
    let cancelled = false
    const run = async () => {
      setPurchasedLoading(true)
      try {
        if (mocksEnabled) {
          if (!cancelled) setPurchasedNodes(MOCK_PURCHASED_NODES.nodes as GraphNode[])
        } else {
          const res = await api.get<{ nodes: GraphNode[] }>('/lsat/purchased-nodes')
          if (!cancelled) setPurchasedNodes(res?.nodes ?? [])
        }
      } catch {
        if (!cancelled) setPurchasedNodes([])
      } finally {
        if (!cancelled) setPurchasedLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [activeTab, mocksEnabled])

  // Client-side deduplication: exclude nodes already in Added
  const addedRefIdSet = useMemo(() => new Set(nodes.map((n) => n.ref_id)), [nodes])
  const deduplicatedPurchased = useMemo(
    () => purchasedNodes.filter((n) => !addedRefIdSet.has(n.ref_id)),
    [purchasedNodes, addedRefIdSet]
  )

  const hasInProgress =
    totalProcessing > 0 || nodes.some((n) => isInProgress(n.properties?.status) && !isStaleProcessing(n))

  const hasIdentity = !!pubKey || !!cookieStorage.getItem("l402")

  // Insights map for quick lookup by ref_id
  const insightsMap = useMemo(() => {
    const m = new Map<string, NodeInsight>()
    insights?.nodes.forEach((n) => m.set(n.ref_id, n))
    return m
  }, [insights])

  // Fetch creator insights when on Added tab with identity
  useEffect(() => {
    if (activeTab !== 'added' || !hasIdentity) return
    let cancelled = false
    const run = async () => {
      setInsightsLoading(true)
      try {
        const res = mocksEnabled
          ? MOCK_CREATOR_INSIGHTS
          : await fetchCreatorInsights(period)
        if (!cancelled) setInsights(res)
      } catch {
        if (!cancelled) setInsights(null)
      } finally {
        if (!cancelled) setInsightsLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [period, activeTab, hasIdentity, mocksEnabled])

  // Socket.IO lifecycle — runs once on mount; keeps poll as fallback when disconnected
  useEffect(() => {
    if (mocksEnabled) return
    let sock: Socket
    try { sock = getSocket() } catch { return }

    const onConnect = () => setIsSocketConnected(true)
    const onDisconnect = () => setIsSocketConnected(false)
    const onNodeUpdated = ({ ref_id, status }: { ref_id: string; status: string }) => {
      setNodes((prev) => {
        const next = prev.map((n) =>
          n.ref_id === ref_id ? { ...n, properties: { ...n.properties, status } } : n
        )
        // Keep totalProcessing in sync so the banner clears when all nodes settle
        setTotalProcessing(next.filter((n) => isInProgress(n.properties?.status) && !isStaleProcessing(n)).length)
        return next
      })
    }

    if (sock.connected) setIsSocketConnected(true)
    sock.on('connect', onConnect)
    sock.on('disconnect', onDisconnect)
    sock.on('node_updated', onNodeUpdated)

    return () => {
      sock.off('connect', onConnect)
      sock.off('disconnect', onDisconnect)
      sock.off('node_updated', onNodeUpdated)
    }
  }, [mocksEnabled])

  useEffect(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    if (!hasInProgress || mocksEnabled || !hasIdentity || isSocketConnected) return

    pollTimerRef.current = setInterval(async () => {
      try {
        applyResponse(await fetchFromApi(Math.max(nodes.length, PAGE_SIZE), 0))
      } catch {
        // Leave existing state; next tick will retry.
      }
    }, POLL_INTERVAL_MS)

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [hasInProgress, mocksEnabled, hasIdentity, isSocketConnected, fetchFromApi, applyResponse, nodes.length])

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
                My Content
              </h3>
              {!loading && activeTab === 'added' && (
                <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                  {nodes.length}{hasMore ? '+' : ''} item{nodes.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {totalProcessing > 0 && activeTab === 'added' && (
            <div className="relative z-10 flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20">
              <span className="text-xs text-amber-400">
                {totalProcessing} item{totalProcessing !== 1 ? "s" : ""} still processing…
              </span>
            </div>
          )}

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'added' | 'purchased')} className="flex flex-col flex-1 min-h-0">
            <TabsList className="w-full rounded-none border-b border-sidebar-border shrink-0">
              <TabsTrigger value="added" className="flex-1">Added</TabsTrigger>
              <TabsTrigger value="purchased" className="flex-1">Purchased</TabsTrigger>
            </TabsList>

            <TabsContent value="added" className="flex-1 min-h-0 mt-0 data-[state=active]:flex data-[state=active]:flex-col">
              {hasIdentity && (
                <div className="px-4 py-3 border-b border-sidebar-border shrink-0 space-y-2">
                  {/* Period toggle */}
                  <div className="flex gap-1">
                    {(["week", "month"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className={cn(
                          "px-3 py-0.5 rounded-full text-[10px] font-mono transition-colors",
                          period === p
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {p === "week" ? "This Week" : "This Month"}
                      </button>
                    ))}
                  </div>
                  {/* Stat tiles */}
                  {insightsLoading ? (
                    <div className="flex gap-4">
                      <Skeleton className="h-8 w-24" />
                      <Skeleton className="h-8 w-20" />
                    </div>
                  ) : insights && insights.total_unlocks > 0 ? (
                    <div className="flex gap-4">
                      <div>
                        <p className="font-mono text-sm font-semibold text-foreground">⚡ {insights.total_sats_earned}</p>
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">sats earned</p>
                      </div>
                      <div>
                        <p className="font-mono text-sm font-semibold text-foreground">🔓 {insights.total_unlocks}</p>
                        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">unlocks</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/60">
                      Start earning — share your content to get unlocks
                    </p>
                  )}
                </div>
              )}
              <ScrollArea className="relative z-10 flex-1 min-h-0">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : nodes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-3">
                    <BookMarked className="h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">No content yet</p>
                    <p className="text-xs text-muted-foreground/60">
                      Add content and start earning money for contributing
                    </p>
                    <button
                      onClick={() => openAdd("source")}
                      className="mt-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors underline underline-offset-2"
                    >
                      Add Content
                    </button>
                  </div>
                ) : (
                  <div className="py-1">
                    {nodes.map((node, i) => {
                      // /v2/content is server-filtered to the caller's content, so every node
                      // here is the user's — always deletable, never self-boostable.
                      const isConfirming = deletingId === node.ref_id

                      const handleConfirmDelete = async () => {
                        try {
                          await deleteNode(node.ref_id)
                          setNodes((prev) => prev.filter((n) => n.ref_id !== node.ref_id))
                          setDeletingId(null)
                          setDeleteError(null)
                        } catch {
                          setDeletingId(null)
                          setDeleteError("Could not delete content. Please try again.")
                        }
                      }

                      const insight = insightsMap.get(node.ref_id)
                      const nodeBadge = insight && insight.unlock_count > 0
                        ? getGrowthBadge(insight.unlock_count, insight.previous_unlock_count)
                        : undefined

                      return (
                        <div key={node.ref_id}>
                          <div className="relative group">
                            <NodeRow
                              node={node}
                              schemas={schemas}
                              onClick={() => { setSelectedNode(node); setSidebarSelectedNode(node) }}
                              onMouseEnter={() => setHoveredNode(node)}
                              onMouseLeave={() => setHoveredNode(null)}
                              hideBoost={true}
                              isAdmin={isAdmin}
                              unlockCount={insight?.unlock_count}
                              growthBadge={nodeBadge}
                            />
                            {!isConfirming && (
                              <button
                                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                onClick={(e) => { e.stopPropagation(); setDeletingId(node.ref_id); setDeleteError(null) }}
                                aria-label="Delete node"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          {isConfirming && (
                            <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 border-t border-destructive/20">
                              <span className="text-xs text-destructive flex-1">Delete this content?</span>
                              <button
                                className="text-xs font-medium text-destructive hover:text-destructive/80 transition-colors"
                                onClick={handleConfirmDelete}
                              >
                                Confirm delete
                              </button>
                              <button
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                                onClick={() => setDeletingId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                          {i < nodes.length - 1 && (
                            <Separator className="bg-sidebar-border/50" />
                          )}
                        </div>
                      )
                    })}
                    {hasMore && (
                      <div ref={sentinelRef} data-testid="sentinel" className="flex justify-center py-3">
                        {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>
              {deleteError && (
                <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20">
                  <span className="text-xs text-destructive">{deleteError}</span>
                </div>
              )}
            </TabsContent>

            <TabsContent value="purchased" className="flex-1 min-h-0 mt-0 data-[state=active]:flex data-[state=active]:flex-col">
              <ScrollArea className="relative z-10 flex-1 min-h-0">
                {purchasedLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : deduplicatedPurchased.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-3">
                    <ShoppingBag className="h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">No purchases yet</p>
                    <p className="text-xs text-muted-foreground/60">
                      Explore the graph to find content to unlock
                    </p>
                  </div>
                ) : (
                  <div className="py-1">
                    {deduplicatedPurchased.map((node, i) => (
                      <div key={node.ref_id}>
                        <NodeRow
                          node={node}
                          schemas={schemas}
                          onClick={() => { setSelectedNode(node); setSidebarSelectedNode(node) }}
                          onMouseEnter={() => setHoveredNode(node)}
                          onMouseLeave={() => setHoveredNode(null)}
                          hideBoost={true}
                          isAdmin={isAdmin}
                        />
                        {i < deduplicatedPurchased.length - 1 && (
                          <Separator className="bg-sidebar-border/50" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
