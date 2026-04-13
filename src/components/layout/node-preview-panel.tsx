"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, CircleDot, Zap, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { api } from "@/lib/api"
import { useGraphStore } from "@/stores/graph-store"
import type { GraphNode } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"

const DISPLAY_KEY_FALLBACKS = ["name", "title", "label", "text", "content", "body"] as const

const INTERNAL_FIELDS = new Set([
  "ref_id",
  "pubkey",
  "node_type",
  "date_added_to_graph",
])

function pickString(
  props: Record<string, unknown> | undefined,
  key: string | undefined
): string | undefined {
  if (!props || !key) return undefined
  const v = props[key]
  return typeof v === "string" && v.length > 0 ? v : undefined
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

type UnlockState = "preview" | "loading" | "unlocked" | "error"

interface Props {
  node: GraphNode
  onBack: () => void
  schemas: SchemaNode[]
  alreadyUnlocked: boolean
}

export function NodePreviewPanel({ node, onBack, schemas, alreadyUnlocked }: Props) {
  const [unlockState, setUnlockState] = useState<UnlockState>("preview")
  const [fullNode, setFullNode] = useState<GraphNode | null>(null)

  const schema = schemas.find((s) => s.type === node.node_type)
  const props = node.properties

  // Resolve display fields
  let title = pickString(props, schema?.title_key) ?? pickString(props, schema?.index)
  if (!title) {
    for (const key of DISPLAY_KEY_FALLBACKS) {
      title = pickString(props, key)
      if (title) break
    }
  }
  if (!title) title = node.ref_id

  const rawDescription = pickString(props, schema?.description_key) ?? ""
  const description = rawDescription.length > 160
    ? rawDescription.slice(0, 160) + "…"
    : rawDescription

  const thumbnail =
    (typeof props?.image_url === "string" && props.image_url) ||
    (typeof props?.thumbnail === "string" && props.thumbnail) ||
    null

  async function handleUnlock() {
    setUnlockState("loading")
    try {
      const result = await api.get<GraphNode>(`/v2/nodes/${node.ref_id}`)
      setFullNode(result)
      // Optimistic: mark as purchased in store so refresh skips CTA
      const store = useGraphStore.getState()
      store.setPurchasedNodeIds([
        ...store.purchasedNodeIds,
        node.ref_id,
      ])
      setUnlockState("unlocked")
    } catch {
      setUnlockState("error")
    }
  }

  // Auto-unlock if already purchased
  useEffect(() => {
    if (alreadyUnlocked) {
      handleUnlock()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-sidebar border-r border-sidebar-border w-[300px] noise-bg">
      {/* Header */}
      <div className="relative z-10 flex items-center gap-2 px-3 py-3 border-b border-sidebar-border">
        <button
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
          aria-label="Back to results"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Badge
          variant="outline"
          className="text-[9px] px-1.5 py-0 h-4 border-border/50 text-muted-foreground font-mono"
        >
          {node.node_type ?? "node"}
        </Badge>
      </div>

      <ScrollArea className="relative z-10 flex-1 min-h-0">
        <div className="p-4 space-y-4">
          {/* Thumbnail */}
          {thumbnail ? (
            <img
              src={thumbnail}
              alt={title}
              className="w-full h-32 object-cover rounded-md"
            />
          ) : (
            <div className="w-full h-32 rounded-md bg-primary/10 border border-primary/15 flex items-center justify-center">
              <CircleDot className="h-8 w-8 text-primary/30" />
            </div>
          )}

          {/* Title */}
          <p className="text-sm font-semibold text-foreground leading-snug">{title}</p>

          {/* Description */}
          {description && (
            <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
          )}

          {/* Unlocked content */}
          {unlockState === "unlocked" && fullNode ? (
            <div className="space-y-2">
              {Object.entries(fullNode.properties)
                .filter(([key]) => !INTERNAL_FIELDS.has(key))
                .map(([key, value]) => {
                  const strVal = typeof value === "string" ? value : JSON.stringify(value)
                  return (
                    <div key={key} className="space-y-0.5">
                      <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider">
                        {key.replace(/_/g, " ")}
                      </p>
                      {typeof value === "string" && isUrl(value) ? (
                        <a
                          href={value}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary underline break-all"
                        >
                          {value}
                        </a>
                      ) : (
                        <p className="text-xs text-foreground break-words">{strVal}</p>
                      )}
                    </div>
                  )
                })}
            </div>
          ) : (
            <>
              {/* Skeleton rows for locked content */}
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
              </div>

              {/* Error message */}
              {unlockState === "error" && (
                <p className="text-xs text-destructive">
                  Unlock failed — tap to retry
                </p>
              )}

              {/* Unlock button / spinner */}
              {unlockState === "loading" ? (
                <div className="flex items-center justify-center py-2">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : (
                <Button
                  onClick={handleUnlock}
                  className="w-full gap-2"
                  size="sm"
                >
                  <Zap className="h-3.5 w-3.5" />
                  Unlock Full Content
                </Button>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
