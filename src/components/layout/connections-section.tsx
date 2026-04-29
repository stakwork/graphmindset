"use client"

import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { useGraphStore } from "@/stores/graph-store"
import { pickString, DISPLAY_KEY_FALLBACKS } from "@/lib/node-display"
import { displayNodeType } from "@/lib/utils"
import type { SchemaNode } from "@/app/ontology/page"

interface ConnectionsSectionProps {
  nodeRefId: string
  schemas: SchemaNode[]
}

type GroupBy = "edge_type" | "node_type"

export function ConnectionsSection({ nodeRefId, schemas }: ConnectionsSectionProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>("edge_type")
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)

  const connections = useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.ref_id, n]))
    return edges
      .filter((e) => e.source === nodeRefId || e.target === nodeRefId)
      .flatMap((e) => {
        const peerId = e.source === nodeRefId ? e.target : e.source
        const peer = nodeMap.get(peerId)
        if (!peer) return []
        return [{ edge_type: e.edge_type, peer }]
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

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Connections
        </p>
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
              {conns.map((conn, i) => (
                <div
                  key={`${conn.peer.ref_id}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 bg-muted/20 border border-border/20"
                >
                  <span className="text-xs truncate min-w-0">{resolveTitle(conn.peer)}</span>
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1.5 py-0 h-4 border-border/50 text-muted-foreground font-mono shrink-0"
                  >
                    {displayNodeType(conn.peer.node_type)}
                  </Badge>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
