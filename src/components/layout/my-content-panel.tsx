"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { X, Loader2, BookMarked } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { NodePreviewPanel } from "./node-preview-panel"
import { NodeRow } from "./node-row"
import { api } from "@/lib/api"
import { isMocksEnabled, MOCK_CONTENT } from "@/lib/mock-data"
import { useUserStore } from "@/stores/user-store"
import { useSchemaStore } from "@/stores/schema-store"
import { useModalStore } from "@/stores/modal-store"
import { useGraphStore } from "@/stores/graph-store"
import { isInProgress, getStatusBadge, type StatusBadge } from "@/lib/node-status"
import type { GraphNode } from "@/lib/graph-api"

const POLL_INTERVAL_MS = 5000

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
  const { pubKey, routeHint, isAdmin } = useUserStore()
  const schemas = useSchemaStore((s) => s.schemas)
  const openModal = useModalStore((s) => s.open)
  const setHoveredNode = useGraphStore((s) => s.setHoveredNode)
  const setSidebarSelectedNode = useGraphStore((s) => s.setSidebarSelectedNode)
  const userFullPubkey = pubKey && routeHint ? `${pubKey}_${routeHint}` : pubKey
  const mocksEnabled = isMocksEnabled()
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [totalProcessing, setTotalProcessing] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchFromApi = useCallback(async (): Promise<ContentResponse | null> => {
    if (!pubKey) return null
    const fullPubkey = routeHint ? `${pubKey}_${routeHint}` : pubKey
    return api.get<ContentResponse>(
      `/v2/content?pubkey=${fullPubkey}&sort_by=date&limit=100`
    )
  }, [pubKey, routeHint])

  const applyResponse = useCallback((res: ContentResponse | null) => {
    if (!res) return
    const nextNodes = res.nodes ?? []
    const nextProcessing = res.totalProcessing ?? 0
    // Guard against identity churn: the poll effect depends on `nodes`, so
    // re-assigning a fresh array every tick would clear+restart the interval.
    setNodes((prev) => (sameContent(prev, nextNodes) ? prev : nextNodes))
    setTotalProcessing((prev) => (prev === nextProcessing ? prev : nextProcessing))
  }, [])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      try {
        if (mocksEnabled) {
          if (cancelled) return
          setNodes(MOCK_CONTENT.nodes as GraphNode[])
          setTotalProcessing(MOCK_CONTENT.totalProcessing)
        } else {
          const res = await fetchFromApi()
          if (cancelled) return
          applyResponse(res)
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
  }, [mocksEnabled, fetchFromApi, applyResponse])

  const hasInProgress =
    totalProcessing > 0 || nodes.some((n) => isInProgress(n.properties?.status))

  useEffect(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    if (!hasInProgress || mocksEnabled || !pubKey) return

    pollTimerRef.current = setInterval(async () => {
      try {
        applyResponse(await fetchFromApi())
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
  }, [hasInProgress, mocksEnabled, pubKey, fetchFromApi, applyResponse])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-sidebar border-r border-sidebar-border w-[300px] noise-bg">
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
              {!loading && (
                <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                  {nodes.length} item{nodes.length !== 1 ? "s" : ""}
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

          {totalProcessing > 0 && (
            <div className="relative z-10 flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20">
              <span className="text-xs text-amber-400">
                {totalProcessing} item{totalProcessing !== 1 ? "s" : ""} still processing…
              </span>
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
                  onClick={() => openModal("addContent")}
                  className="mt-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors underline underline-offset-2"
                >
                  Add Content
                </button>
              </div>
            ) : (
              <div className="py-1">
                {nodes.map((node, i) => (
                  <div key={node.ref_id}>
                    <NodeRow
                      node={node}
                      schemas={schemas}
                      onClick={() => { setSelectedNode(node); setSidebarSelectedNode(node) }}
                      onMouseEnter={() => setHoveredNode(node)}
                      onMouseLeave={() => setHoveredNode(null)}
                      hideBoost={isAdmin || node.properties?.pubkey === userFullPubkey}
                    />
                    {i < nodes.length - 1 && (
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
