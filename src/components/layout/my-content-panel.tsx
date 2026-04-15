"use client"

import { useEffect, useState } from "react"
import { X, Loader2, BookMarked } from "lucide-react"
import { getSchemaIconInfo } from "@/lib/schema-icons"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { BoostButton } from "@/components/boost/boost-button"
import { NodePreviewPanel } from "./node-preview-panel"
import { api } from "@/lib/api"
import { useMocks, MOCK_CONTENT } from "@/lib/mock-data"
import { useUserStore } from "@/stores/user-store"
import { useSchemaStore } from "@/stores/schema-store"
import { useModalStore } from "@/stores/modal-store"
import type { GraphNode } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"

const DISPLAY_KEY_FALLBACKS = ["name", "title", "label", "text", "content", "body"] as const

function pickString(props: Record<string, unknown> | undefined, key: string | undefined): string | undefined {
  if (!props || !key) return undefined
  const v = props[key]
  return typeof v === "string" && v.length > 0 ? v : undefined
}

function NodeRow({ node, schemas, onClick }: { node: GraphNode; schemas: SchemaNode[]; onClick: () => void }) {
  const nodeType = node.node_type ?? "Unknown"
  const schema = schemas.find((s) => s.type === nodeType)
  const props = node.properties
  let name = pickString(props, schema?.title_key) ?? pickString(props, schema?.index)
  if (!name) {
    for (const key of DISPLAY_KEY_FALLBACKS) {
      name = pickString(props, key)
      if (name) break
    }
  }
  if (!name) name = node.ref_id

  const pubkey = typeof props?.pubkey === "string" ? props.pubkey : undefined
  const routeHint = typeof props?.route_hint === "string" ? props.route_hint : undefined
  const isProcessing = props?.status === "processing"
  const { icon: Icon, accent } = getSchemaIconInfo(schema?.icon)

  return (
    <button onClick={onClick} className="flex items-center gap-3 px-4 py-3 w-full text-left cursor-pointer hover:bg-sidebar-accent transition-colors group">
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border"
        style={{ backgroundColor: `${accent}15`, borderColor: `${accent}30` }}
      >
        <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
      </div>
      <div className="flex-1 min-w-0 overflow-hidden">
        <p className="text-sm text-foreground truncate">{name}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Badge
            variant="outline"
            className="text-[9px] px-1.5 py-0 h-4 border-border/50 text-muted-foreground font-mono"
          >
            {nodeType}
          </Badge>
          {isProcessing && (
            <span className="inline-flex items-center rounded-full px-1.5 py-0 h-4 text-[9px] font-medium bg-amber-500/15 text-amber-400">
              Processing
            </span>
          )}
        </div>
      </div>
      {pubkey && (
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          <BoostButton refId={node.ref_id} pubkey={pubkey} routeHint={routeHint} className="shrink-0" />
        </div>
      )}
    </button>
  )
}

interface ContentResponse {
  nodes: GraphNode[]
  totalCount: number
  totalProcessing: number
}

export function MyContentPanel({ onClose }: { onClose: () => void }) {
  const { pubKey, routeHint } = useUserStore()
  const schemas = useSchemaStore((s) => s.schemas)
  const openModal = useModalStore((s) => s.open)
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [totalProcessing, setTotalProcessing] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)

  useEffect(() => {
    const fetchContent = async () => {
      setLoading(true)
      try {
        if (useMocks()) {
          setNodes(MOCK_CONTENT.nodes as GraphNode[])
          setTotalProcessing(MOCK_CONTENT.totalProcessing)
        } else if (pubKey) {
          const fullPubkey = pubKey && routeHint ? `${pubKey}_${routeHint}` : pubKey
          const res = await api.get<ContentResponse>(
            `/v2/content?pubkey=${fullPubkey}&only_content=true&sort_by=date&limit=100`
          )
          setNodes(res.nodes ?? [])
          setTotalProcessing(res.totalProcessing ?? 0)
        }
      } catch {
        setNodes([])
      } finally {
        setLoading(false)
      }
    }
    fetchContent()
  }, [pubKey])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-sidebar border-r border-sidebar-border w-[300px] noise-bg">
      {selectedNode ? (
        <NodePreviewPanel
          node={selectedNode}
          onBack={() => setSelectedNode(null)}
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
                  Add content to start building your graph
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
                    <NodeRow node={node} schemas={schemas} onClick={() => setSelectedNode(node)} />
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
