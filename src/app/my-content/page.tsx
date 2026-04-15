"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  Loader2,
  ExternalLink,
  Video,
  GitFork,
  Rss,
  AtSign,
  BookMarked,
} from "lucide-react"
import { AuthGuard } from "@/components/auth/auth-guard"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { api } from "@/lib/api"
import { useUserStore } from "@/stores/user-store"
import { useModalStore } from "@/stores/modal-store"
import { SOURCE_TYPES, extractNameFromSource } from "@/lib/source-detection"
import type { SourceType } from "@/lib/source-detection"

interface ContentNode {
  node_type: string
  ref_id: string
  properties: Record<string, unknown>
}

interface ContentResponse {
  nodes: ContentNode[]
  totalCount: number
  totalProcessing: number
}

function ContentIcon({ type }: { type: string }) {
  const cls = "h-3.5 w-3.5 shrink-0 text-muted-foreground"
  switch (type) {
    case SOURCE_TYPES.TWITTER_HANDLE:
    case SOURCE_TYPES.TWEET:
      return <AtSign className={cls} />
    case SOURCE_TYPES.YOUTUBE_CHANNEL:
      return <Video className={cls} />
    case SOURCE_TYPES.GITHUB_REPOSITORY:
      return <GitFork className={cls} />
    case SOURCE_TYPES.RSS:
      return <Rss className={cls} />
    default:
      return <ExternalLink className={cls} />
  }
}

function StatusBadge({ status }: { status: unknown }) {
  const isProcessing = status === "processing"
  return (
    <span
      className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
        isProcessing
          ? "bg-amber-500/15 text-amber-400"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {isProcessing ? "Processing" : "Complete"}
    </span>
  )
}

function MyContentPage() {
  const router = useRouter()
  const { pubKey } = useUserStore()
  const openModal = useModalStore((s) => s.open)
  const [nodes, setNodes] = useState<ContentNode[]>([])
  const [totalProcessing, setTotalProcessing] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!pubKey) return
    const fetch = async () => {
      setLoading(true)
      try {
        const res = await api.get<ContentResponse>(`/v2/content?pubkey=${pubKey}`)
        setNodes(res.nodes ?? [])
        setTotalProcessing(res.totalProcessing ?? 0)
      } catch {
        setNodes([])
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [pubKey])

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar-style panel */}
      <div className="w-[300px] shrink-0 border-r border-border flex flex-col bg-sidebar noise-bg">
        {/* Header */}
        <div className="relative z-10 flex items-center gap-2 p-4 border-b border-border">
          <button
            onClick={() => router.push("/")}
            className="h-7 w-7 p-0 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted/50"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="text-sm font-heading font-semibold tracking-wide uppercase flex-1">
            My Content
          </h2>
          {!loading && (
            <span className="text-[10px] font-mono text-muted-foreground">
              {nodes.length} item{nodes.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Processing banner */}
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
              {nodes.map((node, i) => {
                const source = node.properties.source as string | undefined
                const sourceType = (node.properties.source_type as SourceType | undefined) ?? (node.node_type as SourceType)
                const displayName = source
                  ? extractNameFromSource(source, sourceType)
                  : node.ref_id

                return (
                  <div key={node.ref_id}>
                    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors overflow-hidden">
                      <ContentIcon type={sourceType} />
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <span className="text-sm text-foreground block truncate" title={displayName}>
                          {displayName}
                        </span>
                        <span className="text-[10px] text-muted-foreground capitalize">
                          {sourceType?.replace(/_/g, " ")}
                        </span>
                      </div>
                      <StatusBadge status={node.properties.status} />
                    </div>
                    {i < nodes.length - 1 && (
                      <Separator className="bg-sidebar-border/50" />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Main area placeholder */}
      <div className="flex-1 flex items-center justify-center text-muted-foreground/30">
        <BookMarked className="h-16 w-16" />
      </div>
    </div>
  )
}

export default function MyContentPageWrapper() {
  return (
    <AuthGuard>
      <MyContentPage />
    </AuthGuard>
  )
}
