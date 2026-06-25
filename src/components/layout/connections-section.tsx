"use client"

import { useMemo, useState } from "react"
import { Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useGraphStore } from "@/stores/graph-store"
import { useUserStore } from "@/stores/user-store"
import { useModalStore } from "@/stores/modal-store"
import { pickString, DISPLAY_KEY_FALLBACKS } from "@/lib/node-display"
import { displayNodeType } from "@/lib/utils"
import { deleteEdge } from "@/lib/graph-api"
import type { SchemaNode } from "@/lib/schema-types"
import type { GraphNode } from "@/lib/graph-api"

interface ConnectionsSectionProps {
  nodeRefId: string
  schemas: SchemaNode[]
  currentNode?: GraphNode
  onNavigate?: (node: GraphNode) => void
}

type GroupBy = "edge_type" | "node_type"

export function ConnectionsSection({ nodeRefId, schemas, currentNode, onNavigate }: ConnectionsSectionProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>("edge_type")
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const removeEdge = useGraphStore((s) => s.removeEdge)
  const isAdmin = useUserStore((s) => s.isAdmin)
  const openAddEdge = useModalStore((s) => s.openAddEdge)

  const connections = useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.ref_id, n]))
    return edges
      .filter((e) => e.source === nodeRefId || e.target === nodeRefId)
      .flatMap((e) => {
        const peerId = e.source === nodeRefId ? e.target : e.source
        const peer = nodeMap.get(peerId)
        if (!peer) return []
        return [{ edge_type: e.edge_type, peer, edge_ref_id: e.ref_id }]
      })
  }, [edges, nodes, nodeRefId])

  // Group connections
  const groups = useMemo(() => {
    const map = new Map<string, typeof connections>()
    for (const conn of connections) {
      const key = groupBy === "edge_type" ? conn.edge_type : conn.peer.node_type
      const existing = map.get(key) ?? []
      map.set(key, [...existing, conn])
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [connections, groupBy])

  function resolveTitle(peer: (typeof connections)[number]["peer"]): string {
    const props = peer.properties
    const schema = schemas.find((s) => s.type === peer.node_type)
    let title =
      pickString(props, schema?.title_key) ??
      pickString(props, schema?.index)
    if (!title) {
      for (const key of DISPLAY_KEY_FALLBACKS) {
        title = pickString(props, key)
        if (title) break
      }
    }
    return title ?? peer.ref_id
  }

  async function handleConfirmDelete(edgeRefId: string) {
    if (!isAdmin) return
    try {
      await deleteEdge(edgeRefId)
    } catch {
      // Best-effort — remove locally regardless
    }
    removeEdge(edgeRefId)
    setConfirmingDelete(null)
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Connections
        </p>
        <div className="flex items-center gap-1.5">
          {currentNode && (
            <button
              onClick={() => openAddEdge(currentNode)}
              className="text-[9px] font-mono text-primary hover:text-primary/80 transition-colors px-1.5 py-0.5 rounded border border-primary/30 hover:border-primary/60"
              aria-label="Add connection"
            >
              ＋ Add connection
            </button>
          )}
          <div className="flex items-center gap-0.5 rounded-md border border-border/30 p-0.5">
            <button
              onClick={() => setGroupBy("edge_type")}
              className={`rounded px-2 py-0.5 text-[9px] font-mono transition-colors ${
                groupBy === "edge_type"
                  ? "bg-border/50 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Edge Type
            </button>
            <button
              onClick={() => setGroupBy("node_type")}
              className={`rounded px-2 py-0.5 text-[9px] font-mono transition-colors ${
                groupBy === "node_type"
                  ? "bg-border/50 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Node Type
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      {connections.length === 0 ? (
        <p className="text-xs text-muted-foreground">No connections</p>
      ) : (
        <div className="space-y-3">
          {groups.map(([groupKey, conns]) => (
            <div key={groupKey} className="space-y-1">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">
                {groupBy === "node_type" ? displayNodeType(groupKey) : groupKey}{" "}
                <span className="text-muted-foreground/60">({conns.length})</span>
              </p>
              {conns.map((conn, i) => {
                const isConfirming = confirmingDelete === conn.edge_ref_id
                return (
                  <div
                    key={`${conn.peer.ref_id}-${i}`}
                    className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 bg-muted/20 border border-border/20 hover:bg-muted/40 transition-colors"
                  >
                    <button
                      className="flex-1 flex items-center justify-between gap-2 cursor-pointer text-left min-w-0"
                      onClick={() => onNavigate?.(conn.peer)}
                    >
                      <span className="text-xs truncate min-w-0">{resolveTitle(conn.peer)}</span>
                      <Badge
                        variant="outline"
                        className="text-[9px] px-1.5 py-0 h-4 border-border/50 text-muted-foreground font-mono shrink-0"
                      >
                        {displayNodeType(conn.peer.node_type)}
                      </Badge>
                    </button>
                    {isAdmin && conn.edge_ref_id !== undefined && (
                      isConfirming ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[9px] text-muted-foreground">Remove?</span>
                          <button
                            onClick={() => handleConfirmDelete(conn.edge_ref_id!)}
                            className="text-[9px] font-mono text-destructive hover:text-destructive/80 transition-colors"
                            aria-label="Confirm remove"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmingDelete(null)}
                            className="text-[9px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                            aria-label="Cancel remove"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmingDelete(conn.edge_ref_id!)}
                          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                          aria-label="Remove connection"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
