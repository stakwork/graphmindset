"use client"

import { useEffect, useState } from "react"
import { Play, Flame, Clock, ChevronRight, Quote } from "lucide-react"
import { useGraphStore } from "@/stores/graph-store"
import { useAppStore } from "@/stores/app-store"
import { useSchemaStore } from "@/stores/schema-store"
import { pickString, resolveNodeTitle, resolveNodeThumbnail } from "@/lib/node-display"
import { listLatestByType } from "@/lib/graph-api"
import { isMocksEnabled, MOCK_NODES } from "@/lib/mock-data"
import type { GraphNode } from "@/lib/graph-api"

const LIMIT = 10

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`
}

export function clipQuote(node: GraphNode): string | undefined {
  const p = node.properties || {}
  const desc = pickString(p, "description")
  if (desc) return desc
  const transcript = pickString(p, "transcript")
  if (transcript) return transcript.slice(0, 220)
  return undefined
}

export function HotTakes() {
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const setSidebarSelectedNode = useGraphStore((s) => s.setSidebarSelectedNode)
  const setClipsOpen = useAppStore((s) => s.setClipsOpen)
  const schemas = useSchemaStore((s) => s.schemas)
  const [clips, setClips] = useState<GraphNode[]>([])

  useEffect(() => {
    if (isMocksEnabled()) {
      const seeded = MOCK_NODES
        .filter((n) => n.node_type === "Clip")
        .sort((a, b) => (b.date_added_to_graph ?? 0) - (a.date_added_to_graph ?? 0))
        .slice(0, LIMIT)
      setClips(seeded)
      return
    }
    const controller = new AbortController()
    ;(async () => {
      try {
        const res = await listLatestByType("Clip", LIMIT, 0, controller.signal)
        setClips((res.nodes ?? []).filter((n) => clipQuote(n)))
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        console.error("[hot-takes] fetch failed:", err)
      }
    })()
    return () => controller.abort()
  }, [])

  if (clips.length === 0) return null

  const [featured, ...rest] = clips
  const side = rest.slice(0, 3)

  function openClip(node: GraphNode) {
    setSelectedNode(node)
    setSidebarSelectedNode(node)
  }

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-6 pt-4">
      <div className="rounded-xl border border-border/40 bg-card/30 overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-amber" />
            <span className="font-semibold text-sm text-foreground">Hot Takes</span>
          </div>
          <button
            type="button"
            onClick={() => {
              useGraphStore.getState().clearSelection()
              setClipsOpen(true)
            }}
            className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            See all <ChevronRight className="h-3 w-3" />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-5 pb-5">
          <FeaturedCard node={featured} onOpen={() => openClip(featured)} schemas={schemas} />
          <div className="flex flex-col gap-2">
            {side.map((n) => (
              <SideCard key={n.ref_id} node={n} onOpen={() => openClip(n)} schemas={schemas} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function FeaturedCard({
  node,
  onOpen,
  schemas,
}: {
  node: GraphNode
  onOpen: () => void
  schemas: ReturnType<typeof useSchemaStore.getState>["schemas"]
}) {
  const p = node.properties || {}
  const quote = clipQuote(node) ?? resolveNodeTitle(node, schemas)
  const speaker = pickString(p, "speaker_name") || pickString(p, "name")
  const show = pickString(p, "show") || pickString(p, "show_title")
  const episodeNum = typeof p.episode_number === "number" ? p.episode_number : null
  const duration = typeof p.duration === "number" ? p.duration : null
  const boost = typeof p.boost === "number" ? p.boost : null
  const thumb = resolveNodeThumbnail(node)

  return (
    <article
      onClick={onOpen}
      className="group relative aspect-[4/3] rounded-lg overflow-hidden cursor-pointer ring-1 ring-border/40"
    >
      {thumb && (
        <div
          className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
          style={{ backgroundImage: `url(${thumb})` }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />

      <div className="absolute top-3 left-3 flex items-center gap-2">
        <div className="px-2 py-0.5 rounded bg-black/50 backdrop-blur-sm font-mono text-[10px] uppercase tracking-wider text-amber flex items-center gap-1">
          <Flame className="h-2.5 w-2.5" />
          Featured{boost !== null ? ` · ↑ ${boost}` : ""}
        </div>
      </div>
      {duration !== null && (
        <div className="absolute top-3 right-3 px-2 py-0.5 rounded bg-black/60 font-mono text-[10px] text-white inline-flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          {formatDuration(duration)}
        </div>
      )}

      <div className="absolute bottom-4 left-4 right-4">
        <Quote className="h-5 w-5 text-amber/80 mb-2" strokeWidth={1.5} />
        <blockquote className="text-xl leading-snug text-white font-medium mb-3 line-clamp-3">
          {quote}
        </blockquote>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {speaker && <div className="text-sm font-semibold text-white truncate">{speaker}</div>}
            {(show || episodeNum !== null) && (
              <div className="font-mono text-[9px] uppercase tracking-wider text-white/60 truncate">
                {show}
                {show && episodeNum !== null && " · "}
                {episodeNum !== null && `#${episodeNum}`}
              </div>
            )}
          </div>
          <div className="h-9 w-9 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20 shrink-0 group-hover:scale-110 transition-transform">
            <Play className="h-3.5 w-3.5 text-white fill-white ml-0.5" />
          </div>
        </div>
      </div>
    </article>
  )
}

export function SideCard({
  node,
  onOpen,
  schemas,
}: {
  node: GraphNode
  onOpen: () => void
  schemas: ReturnType<typeof useSchemaStore.getState>["schemas"]
}) {
  const p = node.properties || {}
  const quote = clipQuote(node) ?? resolveNodeTitle(node, schemas)
  const speaker = pickString(p, "speaker_name")
  const show = pickString(p, "show") || pickString(p, "show_title")
  const duration = typeof p.duration === "number" ? p.duration : null
  const boost = typeof p.boost === "number" ? p.boost : null
  const thumb = resolveNodeThumbnail(node)

  return (
    <article
      onClick={onOpen}
      className="group flex gap-3 items-stretch p-2 rounded-lg hover:bg-card/50 transition-colors cursor-pointer border border-transparent hover:border-border/40"
    >
      <div className="relative shrink-0 w-24 aspect-[4/3] rounded-md overflow-hidden bg-cover bg-center ring-1 ring-border/40"
        style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-7 w-7 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/20">
            <Play className="h-3 w-3 text-white fill-white ml-0.5" />
          </div>
        </div>
        {duration !== null && (
          <div className="absolute bottom-1 right-1 px-1 rounded bg-black/60 font-mono text-[9px] text-white">
            {formatDuration(duration)}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
        <blockquote className="text-[13px] leading-snug text-foreground/95 font-medium line-clamp-2">
          {quote}
        </blockquote>
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground mt-1.5">
          {speaker && <span className="text-primary truncate">{speaker}</span>}
          {speaker && show && <span>·</span>}
          {show && <span className="truncate">{show}</span>}
          {boost !== null && (
            <span className="ml-auto text-amber inline-flex items-center gap-0.5">
              <Flame className="h-2.5 w-2.5" />
              {boost}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}
