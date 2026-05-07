"use client"

import { useCallback, useEffect, useState } from "react"
import { ExternalLink, Trash2, Loader2, X, Video, GitFork, Rss, AtSign } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { api } from "@/lib/api"
import { useSourcesStore, type Source } from "@/stores/sources-store"
import { useUserStore } from "@/stores/user-store"
import { isMocksEnabled, MOCK_SOURCES } from "@/lib/mock-data"
import {
  SOURCE_TYPES,
  extractNameFromSource,
} from "@/lib/source-detection"

const TWITTER_LINK = "https://x.com"

function SourceIcon({ type }: { type: string }) {
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

function SourceRow({
  source,
  canEdit,
  onDelete,
}: {
  source: Source
  canEdit: boolean
  onDelete: (id: string) => void
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = useCallback(async () => {
    if (!canEdit) return
    setDeleting(true)
    try {
      await api.delete(`/radar/${source.ref_id}`)
      onDelete(source.ref_id)
    } catch {
      console.warn("Failed to delete source")
    } finally {
      setDeleting(false)
    }
  }, [canEdit, source.ref_id, onDelete])

  const displayName = extractNameFromSource(source.source, source.source_type as never)

  const href =
    source.source_type === SOURCE_TYPES.TWITTER_HANDLE
      ? `${TWITTER_LINK}/${source.source}`
      : source.source

  const linkTypes: string[] = [
    SOURCE_TYPES.TWITTER_HANDLE,
    SOURCE_TYPES.YOUTUBE_CHANNEL,
    SOURCE_TYPES.RSS,
    SOURCE_TYPES.GITHUB_REPOSITORY,
  ]
  const isLink = linkTypes.includes(source.source_type)

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group overflow-hidden">
      <SourceIcon type={source.source_type} />
      <div className="flex-1 min-w-0 overflow-hidden">
        {isLink ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-foreground hover:text-primary transition-colors block truncate"
          >
            {displayName}
          </a>
        ) : (
          <span className="text-sm text-foreground block truncate">
            {displayName}
          </span>
        )}
        {source.topics && source.topics.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {source.topics.map((t) => (
              <span
                key={t}
                className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0 text-[9px] text-primary"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      {canEdit && (
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  )
}

export function SourcesPanel({ onClose }: { onClose: () => void }) {
  const { sources, loading, setSources, setLoading, removeSource } =
    useSourcesStore()
  const isAdmin = useUserStore((s) => s.isAdmin)

  useEffect(() => {
    const fetchSources = async () => {
      setLoading(true)
      try {
        if (isMocksEnabled()) {
          setSources(MOCK_SOURCES)
        } else {
          const res = await api.get<{ data: Source[] }>(
            "/radar?skip=0&limit=500"
          )
          setSources(res.data ?? [])
        }
      } catch {
        setSources([])
      } finally {
        setLoading(false)
      }
    }
    fetchSources()
  }, [setSources, setLoading])

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="relative z-10 flex items-center justify-between px-4 py-3 border-b border-sidebar-border">
        <div>
          <h3 className="text-sm font-heading font-semibold tracking-wide text-sidebar-foreground">
            Sources
          </h3>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
            {sources.length} sources
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ScrollArea className="relative z-10 flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <p className="text-sm text-muted-foreground">No sources yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Add content to start building your graph
            </p>
          </div>
        ) : (
          <div className="py-1">
            {sources.map((source, i) => (
              <div key={source.ref_id}>
                <SourceRow
                  source={source}
                  canEdit={isAdmin}
                  onDelete={removeSource}
                />
                {i < sources.length - 1 && (
                  <Separator className="bg-sidebar-border/50" />
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
