"use client"

import { useCallback, useEffect, useState } from "react"
import { ExternalLink, Trash2, Loader2, X, Video, GitFork, Rss, AtSign, Pencil } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { useSourcesStore, type Source } from "@/stores/sources-store"
import { useUserStore } from "@/stores/user-store"
import { isMocksEnabled, MOCK_SOURCES } from "@/lib/mock-data"
import {
  SOURCE_TYPES,
  SOURCE_TYPE_LABELS,
  extractNameFromSource,
} from "@/lib/source-detection"

const TWITTER_LINK = "https://x.com"

function SourceIcon({ type }: { type: string }) {
  const cls = "h-3.5 w-3.5 shrink-0 text-muted-foreground"
  const label = SOURCE_TYPE_LABELS[type] ?? type
  let icon: React.ReactElement
  switch (type) {
    case SOURCE_TYPES.TWITTER_HANDLE:
    case SOURCE_TYPES.TWEET:
      icon = <AtSign className={cls} />
      break
    case SOURCE_TYPES.YOUTUBE_CHANNEL:
      icon = <Video className={cls} />
      break
    case SOURCE_TYPES.GITHUB_REPOSITORY:
      icon = <GitFork className={cls} />
      break
    case SOURCE_TYPES.RSS:
      icon = <Rss className={cls} />
      break
    default:
      icon = <ExternalLink className={cls} />
  }
  return (
    <Tooltip>
      <TooltipTrigger>
        <span className="shrink-0">{icon}</span>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function SourceRow({
  source,
  canEdit,
  onDelete,
  onRefresh,
}: {
  source: Source
  canEdit: boolean
  onDelete: (id: string) => void
  onRefresh: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editCategory, setEditCategory] = useState(source.category ?? "")
  const [editWeight, setEditWeight] = useState<string>(
    source.weight != null ? String(source.weight) : ""
  )
  const [saving, setSaving] = useState(false)

  // Sync edit fields when editing opens
  const handleOpenEdit = useCallback(() => {
    setEditCategory(source.category ?? "")
    setEditWeight(source.weight != null ? String(source.weight) : "")
    setEditing(true)
  }, [source.category, source.weight])

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

  const handleSave = useCallback(async () => {
    if (!canEdit) return
    setSaving(true)
    try {
      const weightVal = editWeight !== "" ? parseFloat(editWeight) : null
      await api.put(`/radar/${source.ref_id}`, {
        category: editCategory || null,
        weight: weightVal,
      })
      setEditing(false)
      onRefresh()
    } catch {
      console.warn("Failed to save source metadata")
    } finally {
      setSaving(false)
    }
  }, [canEdit, source.ref_id, editCategory, editWeight, onRefresh])

  const displayName = extractNameFromSource(source.source, source.source_type as never)
  const typeLabel = SOURCE_TYPE_LABELS[source.source_type] ?? source.source_type

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
    <div className="px-4 py-2.5 hover:bg-muted/30 transition-colors group overflow-hidden">
      <div className="flex items-center gap-3">
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
          <span className="text-[10px] text-muted-foreground">{typeLabel}</span>
          {source.category && (
            <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0 text-[9px] text-primary mt-0.5">
              {source.category}
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
            onClick={handleOpenEdit}
            className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all"
            aria-label="Edit source metadata"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
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

      {editing && (
        <div className="mt-2 flex flex-col gap-2">
          <input
            value={editCategory}
            onChange={(e) => setEditCategory(e.target.value)}
            placeholder="Category"
            className="w-full rounded border border-border/50 bg-muted/50 px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={editWeight}
            onChange={(e) => setEditWeight(e.target.value)}
            placeholder="Weight (0–1)"
            className="w-full rounded border border-border/50 bg-muted/50 px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-[10px] rounded bg-primary px-2.5 py-1 text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-[10px] rounded bg-muted px-2.5 py-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function SourcesPanel({ onClose }: { onClose: () => void }) {
  const { sources, loading, setSources, setLoading, removeSource } =
    useSourcesStore()
  const isAdmin = useUserStore((s) => s.isAdmin)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const fetchSources = useCallback(async () => {
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
  }, [setSources, setLoading])

  useEffect(() => {
    fetchSources()
  }, [fetchSources])

  const categories = [...new Set(sources.map((s) => s.category).filter(Boolean))] as string[]
  const visibleSources = selectedCategory
    ? sources.filter((s) => s.category === selectedCategory)
    : sources

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="relative z-10 flex items-center justify-between px-4 py-3 border-b border-sidebar-border">
        <div>
          <h3 className="text-sm font-heading font-semibold tracking-wide text-sidebar-foreground">
            Sources
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            External feeds that continuously bring new content into the graph.
          </p>
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
            {isAdmin ? (
              <>
                <p className="text-sm text-muted-foreground">No sources yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Add a YouTube channel, Twitter handle, RSS feed, or GitHub repo to start populating the graph.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">No sources configured yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Ask an admin to add content sources.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-sidebar-border/50">
                {(["All", ...categories] as string[]).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat === "All" ? null : cat)}
                    className={`text-[10px] rounded px-2 py-0.5 border transition-colors ${
                      (cat === "All" && !selectedCategory) || selectedCategory === cat
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/50 text-muted-foreground border-border/50 hover:border-primary/40"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
            <div className="py-1">
              {visibleSources.map((source, i) => (
                <div key={source.ref_id}>
                  <SourceRow
                    source={source}
                    canEdit={isAdmin}
                    onDelete={removeSource}
                    onRefresh={fetchSources}
                  />
                  {i < visibleSources.length - 1 && (
                    <Separator className="bg-sidebar-border/50" />
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </ScrollArea>
    </div>
  )
}
