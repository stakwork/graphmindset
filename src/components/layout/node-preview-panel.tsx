"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { ArrowLeft, Link, Zap, Loader2, Play, Film, ExternalLink, Heart, Repeat2, ChevronDown, ChevronUp, MessageCircle, Quote, Eye, BadgeCheck, AtSign, HeartOff, X, Pencil, FlaskConical, GitMerge, MoreHorizontal } from "lucide-react"
import { BulletIcon } from "@/components/ui/bullet-icon"

import { Badge } from "@/components/ui/badge"
import { BoostButton } from "@/components/boost/boost-button"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { api } from "@/lib/api"
import { payL402 } from "@/lib/sphinx"
import { isSphinx } from "@/lib/sphinx/detect"
import { buildSphinxDeepLink } from "@/lib/sphinx/deep-link"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { unlockNode } from "@/lib/unlock-node"
import { isMocksEnabled, MOCK_FULL_NODES } from "@/lib/mock-data"
import { usePlayerStore } from "@/stores/player-store"
import { useUserStore } from "@/stores/user-store"
import { useModalStore } from "@/stores/modal-store"
import { cn, displayNodeType, formatCompactNumber } from "@/lib/utils"
import { pickString, unescapeText, DISPLAY_KEY_FALLBACKS } from "@/lib/node-display"
import { getStatusBadge, isBlockedStatus, isInProgress } from "@/lib/node-status"
import type { GraphNode, GraphData, StakworkRun } from "@/lib/graph-api"
import { triggerDeepResearch, getLatestStakworkRun, getNode, isGraphData } from "@/lib/graph-api"
import { getWatches, watchNode, unwatchNode } from "@/lib/watch-api"
import { cookieStorage } from "@/lib/cookie-storage"
import type { SchemaNode } from "@/app/ontology/page"
import { ConnectionsSection } from "./connections-section"
import { TranscriptChatWidget } from "../agent/transcript-chat"
import type { AgentChatContext } from "../agent/transcript-chat"
import { AttachableEmbeds } from "./attachable-embeds"
import { formatDateAbsolute, formatDateRelative } from "@/lib/date-format"
import { useGraphStore } from "@/stores/graph-store"
import { metroSeries } from "@/data/metro"

const DEEP_RESEARCH_NODE_TYPES = ["Topic"]

// Most fixture stations now carry their backend UUID (STATION_BACKEND_REF_ID_MAP
// in metro.ts), so clicks resolve to the real DB record. The only exceptions are
// the dual-platform transfer twins (e.g. komsomolskaya_r): the backend collapses
// them into their ring node, so they keep a fixture slug for the schematic and
// have no 1:1 backend record. Short-circuit ONLY those — i.e. station ref_ids
// that are still slugs (not UUIDs) — so they render from the fixture instead of
// 500-ing, while the mapped stations hit the API normally.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const METRO_FIXTURE_STATION_REF_IDS = new Set(
  (metroSeries.nodes as { ref_id: string; node_type?: string }[])
    .filter((n) => n.node_type === "Station" && !UUID_RE.test(n.ref_id))
    .map((n) => n.ref_id),
)

const INTERNAL_FIELDS = new Set([
  "ref_id", "pubkey", "owner_reference_id", "node_type", "date_added_to_graph", "status", "project_id",
  // Fields rendered by rich widgets — hide from the fallback key/value list
  "name", "title", "description", "text", "transcript", "summary", "media_url", "link",
  "image_url", "thumbnail", "source_link", "tweet_id", "author",
  "twitter_handle", "verified", "date", "published_date",
  "bio", "duration", "timestamp", "channel", "show", "show_title",
  "episode_title", "episode_number", "file_size", "content_type",
  "boost", "num_boost",
  // Tweet engagement
  "like_count", "retweet_count", "reply_count", "quote_count",
  "impression_count", "bookmark_count", "followers",
  // TwitterAccount
  "image_url", "author_id", "verified_type", "is_identity_verified",
  // Chapter system-set fields
  "is_ad",
])

function isUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

function isMediaUrl(value: string): boolean {
  return /\.(mp4|webm|mov|mp3|ogg|wav|m4a)(\?.*)?$/i.test(value)
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  return `${m}:${s.toString().padStart(2, "0")}`
}

const formatNumber = formatCompactNumber

function pickNumber(props: Record<string, unknown>, key: string): number | undefined {
  const v = props[key]
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

interface NodePreviewPanelProps {
  node: GraphNode
  onBack: () => void
  schemas: SchemaNode[]
}

type UnlockState = "preview" | "loading" | "unlocked" | "error" | "unavailable"

// --- Rich content widgets ---

function TweetStat({
  icon: Icon,
  value,
}: {
  icon: typeof Heart
  value: number
}) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Icon className="h-3 w-3" strokeWidth={1.75} />
      {formatNumber(value)}
    </span>
  )
}

function TweetCard({ props }: { props: Record<string, unknown> }) {
  const text = (props.text as string | undefined) ?? undefined
  const handle = (props.twitter_handle as string | undefined) ?? undefined
  const displayName =
    (props.name as string | undefined) ??
    (props.author as string | undefined) ??
    handle
  const verified = props.verified === true
  const imageUrl = (props.image_url as string | undefined) ?? undefined
  const tweetId = (props.tweet_id as string | undefined) ?? undefined
  const sourceLink =
    (props.source_link as string | undefined) ??
    (handle && tweetId ? `https://x.com/${handle}/status/${tweetId}` : undefined)
  const formattedDate = formatDateAbsolute(props.date)

  const replies = pickNumber(props, "reply_count")
  const retweets = pickNumber(props, "retweet_count")
  const likes = pickNumber(props, "like_count")
  const quotes = pickNumber(props, "quote_count")
  const impressions = pickNumber(props, "impression_count")
  const hasEngagement =
    replies !== undefined ||
    retweets !== undefined ||
    likes !== undefined ||
    quotes !== undefined ||
    impressions !== undefined

  return (
    <article className="relative overflow-hidden rounded-md border border-border/60 bg-card/40">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-cyan/0 via-cyan/60 to-cyan/0"
      />
      <header className="flex items-center gap-2.5 px-3 pt-3">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-border/60"
          />
        ) : (
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted/40 ring-1 ring-border/60 font-mono text-[11px] uppercase text-muted-foreground">
            {(displayName ?? "?").slice(0, 1)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold leading-none">
              {displayName ?? "Unknown"}
            </span>
            {verified && (
              <BadgeCheck
                className="h-3.5 w-3.5 shrink-0 text-cyan"
                strokeWidth={2}
              />
            )}
          </div>
          {handle && (
            <span className="block pt-0.5 font-mono text-[10px] text-muted-foreground">
              @{handle}
            </span>
          )}
        </div>
      </header>

      {text && (
        <p className="whitespace-pre-line px-3 pt-2.5 text-[13px] leading-relaxed text-foreground/95">
          {text}
        </p>
      )}

      {hasEngagement && (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-3 pt-3 pb-2 font-mono text-[10px] text-muted-foreground">
          {replies !== undefined && <TweetStat icon={MessageCircle} value={replies} />}
          {retweets !== undefined && <TweetStat icon={Repeat2} value={retweets} />}
          {likes !== undefined && <TweetStat icon={Heart} value={likes} />}
          {quotes !== undefined && <TweetStat icon={Quote} value={quotes} />}
          {impressions !== undefined && <TweetStat icon={Eye} value={impressions} />}
        </div>
      )}

      {(formattedDate || sourceLink) && (
        <footer className="mt-1 flex items-center gap-2 border-t border-border/40 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
          {formattedDate && <span>{formattedDate}</span>}
          {formattedDate && sourceLink && <span className="text-border">·</span>}
          {sourceLink && (
            <a
              href={sourceLink}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 hover:text-cyan"
            >
              <ExternalLink className="h-2.5 w-2.5" strokeWidth={2} />
              View
            </a>
          )}
        </footer>
      )}
    </article>
  )
}

function MediaCard({ node, props, thumbnail }: { node: GraphNode; props: Record<string, unknown>; thumbnail?: string }) {
  const setPlayingNode = usePlayerStore((s) => s.setPlayingNode)
  const setHost = usePlayerStore((s) => s.setHost)
  const isThisNodeSelected = usePlayerStore(
    (s) => s.playingNode?.ref_id === node.ref_id
  )
  const rawLink = typeof props.link === "string" ? props.link : undefined
  const mediaUrl = (props.media_url ?? (rawLink && isMediaUrl(rawLink) ? rawLink : undefined)) as string | undefined
  const duration = typeof props.duration === "number" ? props.duration : undefined
  const show = (props.show_title ?? props.show) as string | undefined
  const channel = props.channel as string | undefined
  const epNum = typeof props.episode_number === "number" ? props.episode_number : undefined
  const formattedDate = formatDateAbsolute(props.date)
  const isVideo = typeof mediaUrl === "string" && /\.(mp4|webm|mov)/i.test(mediaUrl)

  return (
    <div className="space-y-2">
      {mediaUrl ? (
        isThisNodeSelected ? (
          // Reserve the space the floating MediaPlayer will overlay. Video
          // cards need aspect-video + controls row height; audio just the
          // controls row. The card itself is a sibling at document-body z,
          // tracking this div's getBoundingClientRect().
          <div
            ref={setHost}
            className={cn("w-full", isVideo ? "aspect-video" : "h-[48px]")}
            // 52px = 4px (h-1 progress bar) + 48px (py-2 controls row with h-8 button).
            // Must stay in sync with the MediaPlayer controls layout in media-player.tsx.
            style={{ marginBottom: 52 }}
          />
        ) : isVideo ? (
          // Stable aspect-video container — same size as the host div above.
          // Zero layout shift when Play is tapped.
          <button
            className="relative w-full aspect-video rounded-md overflow-hidden group"
            onClick={() => setPlayingNode({ ...node, properties: props })}
          >
            {thumbnail ? (
              <img src={thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-muted flex items-center justify-center">
                <Film className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90">
                <Play className="h-5 w-5 text-black ml-0.5" />
              </div>
            </div>
            {duration !== undefined && (
              <span className="absolute bottom-2 right-2 text-[10px] font-mono text-white bg-black/60 px-1.5 py-0.5 rounded">
                {formatDuration(duration)}
              </span>
            )}
          </button>
        ) : (
          // Audio — existing button unchanged
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => setPlayingNode({ ...node, properties: props })}
          >
            <Play className="h-3.5 w-3.5 mr-1.5" />
            Play Audio
            {duration !== undefined && (
              <span className="ml-auto text-muted-foreground font-mono text-[10px]">
                {formatDuration(duration)}
              </span>
            )}
          </Button>
        )
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
        {(show ?? channel) && <span>{show ?? channel}</span>}
        {epNum !== undefined && <span>Ep. {epNum}</span>}
        {duration !== undefined && !mediaUrl && <span>{formatDuration(duration)}</span>}
        {formattedDate && (
          <span className="ml-auto font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
            {formattedDate}
          </span>
        )}
      </div>
    </div>
  )
}

export function parseTranscriptSegments(
  text: string
): Array<{ speaker: string; text: string; timestampSeconds?: number }> | null {
  // Optional [MM:SS] or [H:MM:SS] prefix, then Speaker: text
  const speakerLineRe = /^(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?([^:\n]+):\s*(.*)$/
  const lines = text.split("\n")
  const segments: Array<{ speaker: string; text: string; timestampSeconds?: number }> = []
  let current: { speaker: string; lines: string[]; timestampSeconds?: number } | null = null

  function parseTimestampToSeconds(ts: string): number {
    const parts = ts.split(":").map(Number)
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return parts[0] * 60 + parts[1]
  }

  for (const line of lines) {
    const match = line.match(speakerLineRe)
    if (match) {
      if (current)
        segments.push({ speaker: current.speaker, text: current.lines.join("\n").trim(), timestampSeconds: current.timestampSeconds })
      const tsRaw = match[1]
      current = {
        speaker: match[2].trim(),
        lines: match[3] ? [match[3]] : [],
        timestampSeconds: tsRaw !== undefined ? parseTimestampToSeconds(tsRaw) : undefined,
      }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) segments.push({ speaker: current.speaker, text: current.lines.join("\n").trim(), timestampSeconds: current.timestampSeconds })

  return segments.length > 1 ? segments : null
}

export function TranscriptBlock({
  text,
  onTimestampClick,
}: {
  text: string
  onTimestampClick?: (seconds: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  // Parse from the full text before any truncation
  const allSegments = parseTranscriptSegments(text)

  const SEGMENT_COLLAPSE_COUNT = 3
  const PLAIN_COLLAPSE_CHARS = 800

  const hasMoreSegments = allSegments ? allSegments.length > SEGMENT_COLLAPSE_COUNT : false
  const isLongPlain = !allSegments && text.length > PLAIN_COLLAPSE_CHARS

  const visibleSegments = allSegments
    ? expanded
      ? allSegments
      : allSegments.slice(0, SEGMENT_COLLAPSE_COUNT)
    : null

  const displayText =
    !allSegments && isLongPlain && !expanded
      ? text.slice(0, PLAIN_COLLAPSE_CHARS) + "\u2026"
      : text

  const showToggle = hasMoreSegments || isLongPlain

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Transcript</p>
      {visibleSegments ? (
        <div className="space-y-3">
          {visibleSegments.map((seg, i) => (
            <div key={i} className="mb-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-primary font-mono flex items-center gap-1.5">
                {seg.timestampSeconds !== undefined ? (
                  onTimestampClick ? (
                    <button
                      onClick={() => onTimestampClick(seg.timestampSeconds!)}
                      className="font-mono text-[10px] text-primary/60 hover:text-primary underline-offset-2 hover:underline transition-colors"
                    >
                      [{formatTimestamp(seg.timestampSeconds)}]
                    </button>
                  ) : (
                    <span className="font-mono text-[10px] text-primary/60">
                      [{formatTimestamp(seg.timestampSeconds)}]
                    </span>
                  )
                ) : null}
                {seg.speaker}
              </p>
              <p className="text-xs leading-relaxed whitespace-pre-line">{seg.text}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs leading-relaxed whitespace-pre-line">{displayText}</p>
      )}
      {showToggle && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[10px] text-primary hover:underline"
        >
          {expanded ? <><ChevronUp className="h-3 w-3" />Show less</> : <><ChevronDown className="h-3 w-3" />Show more</>}
        </button>
      )}
    </div>
  )
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function SummaryBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > 800
  const display = isLong && !expanded ? text.slice(0, 800) + "\u2026" : text

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Summary</p>
      <p className="text-xs leading-relaxed whitespace-pre-line">{display}</p>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[10px] text-primary hover:underline"
        >
          {expanded ? <><ChevronUp className="h-3 w-3" />Show less</> : <><ChevronDown className="h-3 w-3" />Show more</>}
        </button>
      )}
    </div>
  )
}

function ArticleCard({ props }: { props: Record<string, unknown> }) {
  const summary =
    (props.summary as string | undefined) ?? (props.text as string | undefined)
  const sourceLink = props.source_link as string | undefined
  const author = props.author as string | undefined
  const date =
    (props.published_date as string | undefined) ??
    (props.date as string | undefined)
  const contentType = props.content_type as string | undefined

  return (
    <article className="space-y-3">
      {(contentType || author || date) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {contentType && (
            <span className="rounded-sm border border-border/60 px-1.5 py-0.5 text-[9px] text-foreground/80">
              {contentType.replace(/_/g, " ")}
            </span>
          )}
          {author && <span className="normal-case tracking-normal">{author}</span>}
          {author && date && <span className="text-border">·</span>}
          {date && <span>{date}</span>}
        </div>
      )}
      {summary && (
        <p className="whitespace-pre-line text-xs leading-relaxed">{summary}</p>
      )}
      {sourceLink && (
        <a
          href={sourceLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          View Source
        </a>
      )}
    </article>
  )
}

function VerifiedPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-cyan/40 bg-cyan/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cyan">
      <BadgeCheck className="h-2.5 w-2.5" strokeWidth={2.5} />
      {children}
    </span>
  )
}

function TwitterAccountCard({ props }: { props: Record<string, unknown> }) {
  const handle = props.twitter_handle as string | undefined
  const name = props.name as string | undefined
  const imageUrl = props.image_url as string | undefined
  const verified = props.verified === true
  const verifiedType = props.verified_type as string | undefined
  const idVerified = props.is_identity_verified === true
  const followers = pickNumber(props, "followers")
  const profileUrl = handle ? `https://x.com/${handle}` : undefined

  const hasBadges = verified || idVerified

  return (
    <article className="relative overflow-hidden rounded-md border border-border/60 bg-card/40">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-cyan/0 via-cyan/60 to-cyan/0"
      />
      <div className="flex items-start gap-3 px-3 py-3">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-border/60"
          />
        ) : (
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-muted/40 ring-1 ring-border/60">
            <AtSign className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold leading-tight">
              {name ?? handle ?? "Unknown"}
            </span>
            {verified && (
              <BadgeCheck
                className="h-3.5 w-3.5 shrink-0 text-cyan"
                strokeWidth={2}
              />
            )}
          </div>
          {handle && (
            <p className="font-mono text-[11px] text-muted-foreground">
              @{handle}
            </p>
          )}
          {followers !== undefined && (
            <p className="pt-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
              {formatNumber(followers)}{" "}
              <span className="uppercase tracking-wider text-muted-foreground/60">
                followers
              </span>
            </p>
          )}
        </div>
      </div>
      {hasBadges && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 px-3 py-2">
          {verified && (
            <VerifiedPill>{verifiedType ?? "verified"}</VerifiedPill>
          )}
          {idVerified && <VerifiedPill>id verified</VerifiedPill>}
        </div>
      )}
      {profileUrl && (
        <footer className="flex items-center justify-end border-t border-border/40 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
          <a
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-cyan"
          >
            <ExternalLink className="h-2.5 w-2.5" strokeWidth={2} />
            View on X
          </a>
        </footer>
      )}
    </article>
  )
}

function PersonCard({ props }: { props: Record<string, unknown> }) {
  const bio = props.bio as string | undefined
  const handle = props.twitter_handle as string | undefined
  const imageUrl = props.image_url as string | undefined

  return (
    <div className="space-y-3">
      {imageUrl && (
        <img src={imageUrl} alt="" className="w-16 h-16 rounded-full object-cover border border-border/50" />
      )}
      {bio && <p className="text-xs leading-relaxed whitespace-pre-line">{bio}</p>}
      {handle && (
        <p className="text-[10px] text-muted-foreground font-mono">@{handle}</p>
      )}
    </div>
  )
}

// Image-type node — the image IS the content, so render it full-width with
// native aspect ratio. Click opens a lightbox at viewport size. Falls back
// across the property keys an Image node might use depending on backend
// (uploaded files land in image_url; some pipelines use source_link/url).
function ImageCard({ props }: { props: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  const raw =
    (typeof props.image_url === "string" && props.image_url) ||
    (typeof props.source_link === "string" && props.source_link) ||
    (typeof props.url === "string" && props.url) ||
    null
  if (!raw) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full overflow-hidden rounded-md ring-1 ring-foreground/10 hover:ring-foreground/30 transition"
      >
        <img
          src={raw}
          alt=""
          className="w-full h-auto object-contain bg-black/20"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="!max-w-[92vw] !sm:max-w-[92vw] p-2 bg-popover"
          showCloseButton
        >
          <img
            src={raw}
            alt=""
            className="max-h-[85vh] max-w-full mx-auto object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

// --- Ordered children / parent breadcrumb components ---

export function ChildContentBlock({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold leading-snug">{heading}</p>
      <SummaryBlock text={body} />
    </div>
  )
}

interface IndexedChildrenProps {
  nodeRefId: string
  schemas: SchemaNode[]
}

export function OrderedChildrenView({ nodeRefId, schemas }: IndexedChildrenProps) {
  const edges = useGraphStore((s) => s.edges)
  const nodes = useGraphStore((s) => s.nodes)

  const nodeMap = new Map(nodes.map((n) => [n.ref_id, n]))

  // All outgoing edges from this node
  const outgoing = edges.filter((e) => e.source === nodeRefId)

  // Split into indexed and unindexed
  const indexed = outgoing.filter((e) => e.properties?.index !== undefined)
  const unindexed = outgoing.filter((e) => e.properties?.index === undefined)

  if (indexed.length === 0) return null

  // Sort indexed ascending by index, then append unindexed sorted alphabetically by peer title
  const resolveTitle = (refId: string): string => {
    const peer = nodeMap.get(refId)
    if (!peer) return refId
    const schema = schemas.find((s) => s.type === peer.node_type)
    let t = pickString(peer.properties, schema?.title_key) ?? pickString(peer.properties, schema?.index)
    if (!t) {
      for (const key of DISPLAY_KEY_FALLBACKS) {
        t = pickString(peer.properties, key)
        if (t) break
      }
    }
    return t ?? peer.ref_id
  }

  const sortedIndexed = [...indexed].sort(
    (a, b) => Number(a.properties!.index) - Number(b.properties!.index)
  )
  const sortedUnindexed = [...unindexed].sort((a, b) =>
    resolveTitle(a.target).localeCompare(resolveTitle(b.target))
  )
  const allEdges = [...sortedIndexed, ...sortedUnindexed]

  // Check if we're still loading — outgoing edges exist but peers not yet in store
  const allPeersLoaded = outgoing.every((e) => nodeMap.has(e.target))
  if (!allPeersLoaded && indexed.length > 0) {
    return (
      <p className="text-xs text-muted-foreground">Loading sections…</p>
    )
  }

  const items = allEdges
    .map((e) => {
      const peer = nodeMap.get(e.target)
      if (!peer) return null
      const summary = typeof peer.properties?.summary === "string" ? peer.properties.summary : ""
      if (!summary) return null
      return { heading: resolveTitle(e.target), body: summary }
    })
    .filter((x): x is { heading: string; body: string } => x !== null)

  if (items.length === 0) return null

  return (
    <div className="space-y-4 pt-2 border-t border-border/30">
      {items.map((item, i) => (
        <ChildContentBlock key={i} heading={item.heading} body={item.body} />
      ))}
    </div>
  )
}

interface ParentBreadcrumbsProps {
  nodeRefId: string
  schemas: SchemaNode[]
}

export function ParentBreadcrumbs({ nodeRefId, schemas }: ParentBreadcrumbsProps) {
  const edges = useGraphStore((s) => s.edges)
  const nodes = useGraphStore((s) => s.nodes)

  const nodeMap = new Map(nodes.map((n) => [n.ref_id, n]))

  // Incoming edges with properties.index — dedupe by parent ref_id
  const seen = new Set<string>()
  const parents: { node: (typeof nodes)[number]; edge: (typeof edges)[number] }[] = []
  for (const e of edges) {
    if (e.target === nodeRefId && e.properties?.index !== undefined) {
      if (!seen.has(e.source)) {
        seen.add(e.source)
        const parentNode = nodeMap.get(e.source)
        if (parentNode) parents.push({ node: parentNode, edge: e })
      }
    }
  }

  if (parents.length === 0) return null

  const resolveTitle = (node: (typeof nodes)[number]): string => {
    const schema = schemas.find((s) => s.type === node.node_type)
    let t = pickString(node.properties, schema?.title_key) ?? pickString(node.properties, schema?.index)
    if (!t) {
      for (const key of DISPLAY_KEY_FALLBACKS) {
        t = pickString(node.properties, key)
        if (t) break
      }
    }
    return t ?? node.ref_id
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {parents.map(({ node }) => (
        <button
          key={node.ref_id}
          onClick={() => useGraphStore.getState().setSidebarSelectedNode(node)}
          className="inline-flex items-center gap-1 rounded-sm border border-border/50 bg-muted/30 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          ↑ {resolveTitle(node)}
        </button>
      ))}
    </div>
  )
}

// --- Main component ---

export function NodePreviewPanel({ node, onBack, schemas }: NodePreviewPanelProps) {
  const [currentNode, setCurrentNode] = useState<GraphNode>(node)
  // Derived up-front so it's in scope throughout the (long) component body —
  // referencing it lower down (or from a debugger) won't hit the TDZ.
  const props = currentNode.properties
  const [history, setHistory] = useState<GraphNode[]>([])
  const [unlockState, setUnlockState] = useState<UnlockState>("loading")
  const [fullNode, setFullNode] = useState<GraphNode | null>(null)
  const [price, setPrice] = useState<number | null>(null)
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null)
  const [unavailableRetryable, setUnavailableRetryable] = useState(false)
  const [unavailableCategory, setUnavailableCategory] = useState<"terminal" | "in_flight" | null>(null)
  // Bump to force the preview probe to re-run without remounting (used by the
  // "Check again" button on still-processing nodes).
  const [probeNonce, setProbeNonce] = useState(0)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const boostRef = useRef<HTMLSpanElement>(null)
  const episodeFetchedRef = useRef(false)
  const [watched, setWatched] = useState(false)
  const [watchLoading, setWatchLoading] = useState(false)

  // Deep Research state
  type DeepResearchStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "ERROR" | "HALTED" | null
  const [deepResearchStatus, setDeepResearchStatus] = useState<DeepResearchStatus>(null)
  const [deepResearchLoading, setDeepResearchLoading] = useState(false)
  const deepResearchPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function isDeepResearchInFlight(status: DeepResearchStatus): boolean {
    return status === "PENDING" || status === "RUNNING"
  }

  function mapRunStatus(status: string): DeepResearchStatus {
    const s = status.toUpperCase()
    if (s === "PENDING" || s === "IN_PROGRESS" || s === "RUNNING") return "RUNNING"
    if (s === "COMPLETED") return "COMPLETED"
    if (s === "FAILED" || s === "ERROR" || s === "HALTED") return "FAILED"
    return null
  }

  function startDeepResearchPoll(refId: string) {
    if (deepResearchPollRef.current) clearInterval(deepResearchPollRef.current)
    deepResearchPollRef.current = setInterval(async () => {
      try {
        const run = await getLatestStakworkRun(refId, "deep_research")
        if (!run) return
        const mapped = mapRunStatus(run.status)
        setDeepResearchStatus(mapped)
        if (mapped !== "PENDING" && mapped !== "RUNNING") {
          if (deepResearchPollRef.current) clearInterval(deepResearchPollRef.current)
          deepResearchPollRef.current = null
          if (mapped === "COMPLETED") {
            // Trigger node refetch by bumping probeNonce
            setProbeNonce((n) => n + 1)
          }
        }
      } catch {
        // silent — keep polling
      }
    }, 5000)
  }

  // Hydrate deep research status on mount / node change
  useEffect(() => {
    setDeepResearchStatus(null)
    if (!DEEP_RESEARCH_NODE_TYPES.includes(currentNode.node_type)) return
    let cancelled = false
    getLatestStakworkRun(currentNode.ref_id, "deep_research")
      .then((run) => {
        if (cancelled || !run) return
        const mapped = mapRunStatus(run.status)
        setDeepResearchStatus(mapped)
        if (mapped === "PENDING" || mapped === "RUNNING") {
          startDeepResearchPoll(currentNode.ref_id)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (deepResearchPollRef.current) {
        clearInterval(deepResearchPollRef.current)
        deepResearchPollRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNode.ref_id])

  async function handleDeepResearch() {
    if (deepResearchLoading || isDeepResearchInFlight(deepResearchStatus)) return
    setDeepResearchLoading(true)
    setDeepResearchStatus("PENDING")
    try {
      await triggerDeepResearch(currentNode.ref_id)
      startDeepResearchPoll(currentNode.ref_id)
    } catch {
      setDeepResearchStatus("FAILED")
    } finally {
      setDeepResearchLoading(false)
    }
  }

  // Full reset (currentNode + history + scroll) only when a genuinely different
  // node is selected.
  useEffect(() => {
    setCurrentNode(node)
    setHistory([])
    scrollContentRef.current?.parentElement?.scrollTo({ top: 0, behavior: 'instant' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.ref_id])

  // Pick up in-place edits to the *currently displayed* node (same ref_id, new
  // object) — e.g. an image upload/removal that re-sets selectedNode — so the
  // panel refreshes without a full page reload. The ref_id guard avoids
  // clobbering a peer the user has navigated to, and leaves history/scroll
  // untouched.
  useEffect(() => {
    setCurrentNode((prev) => (prev.ref_id === node.ref_id ? node : prev))
  }, [node])

  function handleNavigate(peer: GraphNode) {
    setHistory((prev) => [...prev, currentNode])
    setCurrentNode(peer)
    scrollContentRef.current?.parentElement?.scrollTo({ top: 0 })
  }

  function handleBack() {
    if (history.length > 0) {
      const prev = history[history.length - 1]
      setHistory((h) => h.slice(0, -1))
      setCurrentNode(prev)
    } else {
      onBack()
    }
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(`${window.location.origin}/?id=${currentNode.ref_id}`).then(() => {
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    }).catch(() => { })
  }

  function handleCopySphinxLink() {
    navigator.clipboard.writeText(buildSphinxDeepLink(currentNode.ref_id)).then(() => {
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    }).catch(() => { })
  }

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current) }, [])

  const refreshBalance = useUserStore((s) => s.refreshBalance)
  const isAdmin = useUserStore((s) => s.isAdmin)
  const pubKey = useUserStore((s) => s.pubKey)
  const hasIdentity = !!pubKey || !!cookieStorage.getItem("l402")
  const openModal = useModalStore((s) => s.open)
  const openEdit = useModalStore((s) => s.openEdit)
  const openAddEdge = useModalStore((s) => s.openAddEdge)

  const edges = useGraphStore((s) => s.edges)
  const graphNodes = useGraphStore((s) => s.nodes)
  const graphEdges = useGraphStore((s) => s.edges)

  const nodeType = currentNode.node_type ?? "Unknown"
  const schema = schemas.find((s) => s.type === nodeType)
  const paidProperties = schema?.paid_properties ?? []

  const nodeIsBlocked = isBlockedStatus(props?.status)
  const ownerReference = typeof props?.owner_reference_id === "string" ? props.owner_reference_id : undefined
  // Legacy pubkey/route_hint for the admin direct-keysend path; phase-4d removes them.
  const pubkey = typeof props?.pubkey === "string" ? props.pubkey : undefined
  const routeHint = typeof props?.route_hint === "string" ? props.route_hint : undefined
  const boostAmt = typeof props?.boost === "number" ? props.boost : 0

  // Self-boost detection moved server-side: caller's L402 isn't known to the
  // frontend, so /boost rejects with SELF_BOOST when caller equals contributor.
  // Admin still hides locally to match the existing UX.
  const hideBoost = isAdmin

  let title = pickString(props, schema?.title_key) ?? pickString(props, schema?.index)
  if (!title) {
    for (const key of DISPLAY_KEY_FALLBACKS) {
      title = pickString(props, key)
      if (title) break
    }
  }
  if (!title) title = currentNode.ref_id
  title = unescapeText(title)

  // When the schema points title and description at the same field, the
  // description is just a longer copy of the title \u2014 skip it.
  const titleDescSame =
    !!schema?.title_key && schema.title_key === schema.description_key
  const rawDesc = titleDescSame
    ? undefined
    : pickString(props, schema?.description_key) ?? pickString(props, "description")
  const description = rawDesc
    ? unescapeText(rawDesc.length > 500 ? rawDesc.slice(0, 500) + "\u2026" : rawDesc)
    : undefined

  const thumbnail = (props?.image_url ?? props?.thumbnail) as string | undefined
  // Hide the static thumbnail when this node is the one currently playing —
  // the inline MediaPlayer card (rendered by MediaCard below) already shows
  // the video frame, so both together would be a duplicate. Also suppress
  // for Image-type nodes, which render their own full-width ImageCard.
  const isThisNodePlayingHere = usePlayerStore(
    (s) => s.playingNode?.ref_id === currentNode.ref_id
  )
  const seekTo = usePlayerStore((s) => s.seekTo)
  const setPlayingNodePanel = usePlayerStore((s) => s.setPlayingNode)
  const isImageNode = currentNode.node_type === "Image"
  const mediaUrlForNode =
    (fullNode?.properties?.media_url as string | undefined) ??
    (typeof fullNode?.properties?.link === "string" && isMediaUrl(fullNode.properties.link as string)
      ? (fullNode.properties.link as string)
      : undefined)
  const isVideoNode =
    typeof mediaUrlForNode === "string" && /\.(mp4|webm|mov)/i.test(mediaUrlForNode)

  // Suppress static thumbnail when:
  //  - this node is playing (floating player already visible)
  //  - it is an Image node
  //  - it is an unlocked video node (thumbnail now lives inside MediaCard)
  const showThumbnail = !!thumbnail && !isThisNodePlayingHere && !isImageNode && !(unlockState === 'unlocked' && isVideoNode)

  async function handleUnlock() {
    if (METRO_FIXTURE_STATION_REF_IDS.has(currentNode.ref_id)) {
      setFullNode(currentNode)
      setUnlockState("unlocked")
      return
    }
    setUnlockState("loading")
    try {
      const unlocked = await unlockNode(currentNode.ref_id)
      setFullNode(unlocked)
      setUnlockState("unlocked")
      refreshBalance()
    } catch (err) {
      if (err instanceof Response && err.status === 402) {
        try {
          await payL402(() => { })
          const unlocked = await unlockNode(currentNode.ref_id)
          setFullNode(unlocked)
          setUnlockState("unlocked")
          refreshBalance()
        } catch {
          openModal("budget")
          setUnlockState("preview")
        }
      } else {
        setUnlockState("error")
      }
    }
  }

  useEffect(() => {
    setWatched(false)
    if (hasIdentity) {
      getWatches()
        .then((data) => {
          setWatched(data.nodes.some((n) => n.ref_id === currentNode.ref_id))
        })
        .catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNode.ref_id, hasIdentity])

  useEffect(() => {
    const controller = new AbortController()

    setFullNode(null)
    setPrice(null)
    setUnavailableReason(null)
    setUnavailableRetryable(false)
    setUnavailableCategory(null)
    episodeFetchedRef.current = false

    // Blocked nodes (halted/paused/failed/etc) never come back useful from a
    // probe — skip the call entirely and surface the right unavailable copy
    // up front. Pre-fill the category from the locally-known status so we
    // can show a "Check again" button for still-processing nodes without
    // waiting for the backend to tell us the same thing.
    if (nodeIsBlocked) {
      const localStatus = currentNode.properties?.status
      if (isInProgress(localStatus)) {
        setUnavailableCategory("in_flight")
        setUnavailableRetryable(true)
        setUnavailableReason("This content is still being processed. Try again in a few minutes.")
      } else {
        setUnavailableCategory("terminal")
        setUnavailableRetryable(false)
        setUnavailableReason("Processing didn't complete for this content, so it can't be unlocked.")
      }
      setUnlockState("unavailable")
      return () => controller.abort()
    }

    setUnlockState("loading")

    async function probe() {
      // Fixture-only metro lore — no backend representation, so skip the API
      // entirely and treat the local node as the unlocked payload.
      if (METRO_FIXTURE_STATION_REF_IDS.has(currentNode.ref_id)) {
        setFullNode(currentNode)
        setUnlockState("unlocked")
        return
      }
      if (isMocksEnabled()) {
        await new Promise((r) => setTimeout(r, 300))
        if (controller.signal.aborted) return
        const mock = MOCK_FULL_NODES[currentNode.ref_id]
        if (mock) {
          setFullNode(mock.nodes?.[0] ?? null)
          setUnlockState("unlocked")
        } else {
          setUnlockState("preview")
        }
        return
      }
      try {
        // Send L402 (if any) with preview=1 so the backend can run hasPurchasedNode /
        // contributor checks without ever debiting the user. Admin/contributor still
        // bypass via signed query params; first-time users get 402 + price as before.
        const result = await api.get<GraphData>(
          `/v2/nodes/${currentNode.ref_id}?preview=1`,
          undefined,
          controller.signal,
        )
        if (controller.signal.aborted) return
        const unlocked = result.nodes?.[0] ?? null
        setFullNode(unlocked)
        setUnlockState("unlocked")
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof Response && err.status === 402) {
          try {
            const body = await err.json()
            setPrice(body?.price ?? null)
          } catch {
            setPrice(null)
          }
          setUnlockState("preview")
          return
        }
        // Non-402: backend may explain why the content is gone. Parse the
        // body for `{ error: true, message, retryable?, category? }` and
        // route to the unavailable state. The structured `retryable` /
        // `category` fields let us distinguish "Stakwork won't recover this"
        // from "still processing — try again later" without string-matching
        // on the message. Generic network/5xx errors fall through to the
        // retry path.
        if (err instanceof Response) {
          try {
            const body = await err.json()
            if (body?.error === true && typeof body?.message === "string") {
              setUnavailableReason(body.message)
              setUnavailableRetryable(body.retryable === true)
              if (body.category === "terminal" || body.category === "in_flight") {
                setUnavailableCategory(body.category)
              }
              setUnlockState("unavailable")
              return
            }
          } catch {
            /* unparseable body — fall through to error */
          }
        }
        setUnlockState("error")
      }
    }

    probe()
    return () => controller.abort()
  }, [currentNode.ref_id, refreshBalance, nodeIsBlocked, probeNonce])

  const fp = fullNode?.properties

  // Detect property-driven content type. Rules are mutually exclusive — a node
  // with overlapping shapes (e.g. Episode has media_url AND source_link, or a
  // Person with a twitter_handle) only renders one rich widget.
  //   bio wins over twitter_handle → Person, not TwitterAccount.
  //   media_url wins over source_link → MediaCard, not ArticleCard.
  const hasTweet = !!fp && "tweet_id" in fp && "text" in fp
  const linkValue = typeof fp?.link === "string" ? fp.link : undefined
  const hasMedia = !!fp && (
    "media_url" in fp ||
    (linkValue !== undefined && isMediaUrl(linkValue))
  )
  const hasWebPageLink = !!linkValue && !isMediaUrl(linkValue)
  const hasTranscript = !!fp && typeof fp.transcript === "string"
  const hasSummary = hasMedia && !!fp && typeof fp.summary === "string" && fp.summary.length > 0
  const hasPerson = !!fp && "bio" in fp && !hasTweet
  const hasTwitterAccount =
    !!fp && "twitter_handle" in fp && !hasTweet && !hasPerson
  const hasArticle =
    !!fp &&
    "source_link" in fp &&
    !hasMedia &&
    !hasTweet &&
    !hasTwitterAccount &&
    !hasPerson
  // The rich widget covers the same field that `description` would render —
  // suppress the generic description block to avoid duplicate body text.
  const widgetCoversDescription = hasTweet || hasTwitterAccount || hasArticle

  // Find a connected Episode node with media_url for tweet nodes
  const tweetEpisodeNode = useMemo(() => {
    if (unlockState !== "unlocked" || !hasTweet) return null
    const nodeMap = new Map(graphNodes.map((n) => [n.ref_id, n]))
    for (const edge of graphEdges) {
      if (edge.source !== currentNode.ref_id && edge.target !== currentNode.ref_id) continue
      const peerId = edge.source === currentNode.ref_id ? edge.target : edge.source
      const peer = nodeMap.get(peerId)
      if (peer?.node_type === "Episode" && peer.properties?.media_url) return peer
    }
    return null
  }, [unlockState, hasTweet, graphNodes, graphEdges, currentNode.ref_id])

  // Transcript Q&A eligibility
  const transcriptContextRefId =
    tweetEpisodeNode?.ref_id ?? (hasTranscript || hasMedia ? currentNode.ref_id : null)
  const transcriptContextNodeType =
    (tweetEpisodeNode?.node_type ?? nodeType) as string
  const hasTranscriptContext =
    unlockState === "unlocked" && transcriptContextRefId !== null

  // Edge fetch for admin/contributor probe path on tweet nodes.
  // The paid-unlock path (unlockNode) already calls ?expand=edges and populates
  // the store, so tweetEpisodeNode will be non-null before this runs — guarded
  // by episodeFetchedRef to prevent double-fetches.
  useEffect(() => {
    if (unlockState !== "unlocked" || !fullNode || episodeFetchedRef.current) return
    const fp = fullNode.properties as Record<string, unknown> | undefined
    if (!fp || !("tweet_id" in fp)) return
    if (tweetEpisodeNode) { episodeFetchedRef.current = true; return }
    episodeFetchedRef.current = true
    const controller = new AbortController()
    getNode(currentNode.ref_id, "edges", controller.signal)
      .then((result) => {
        if (controller.signal.aborted || !isGraphData(result)) return
        useGraphStore.getState().addNodes(result.nodes, result.edges)
      })
      .catch(() => {})
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlockState, fullNode, currentNode.ref_id, tweetEpisodeNode])

  // Remaining properties not handled by rich widgets
  const remainingProps = fp
    ? Object.entries(fp).filter(([k]) =>
      !INTERNAL_FIELDS.has(k) && k !== schema?.title_key && k !== schema?.description_key
    )
    : []

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-sidebar-border">
        <button
          onClick={handleBack}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Badge
          variant="outline"
          className="text-[9px] px-1.5 py-0 h-4 border-border/50 text-muted-foreground font-mono"
        >
          {displayNodeType(nodeType)}
        </Badge>
        <div className="ml-auto flex items-center gap-1.5">
          {/* Hidden BoostButton — clicked programmatically from the dropdown */}
          {ownerReference && !hideBoost && (
            <span className="hidden" ref={boostRef}>
              <BoostButton
                refId={currentNode.ref_id}
                ownerReference={ownerReference}
                pubkey={pubkey}
                routeHint={routeHint}
                boostCount={boostAmt}
              />
            </span>
          )}

          {/* ⋯ overflow menu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 text-xs"
              title="More actions"
            >
              {copied ? (
                <span className="text-[10px] text-green-500">Copied!</span>
              ) : (
                <MoreHorizontal className="h-4 w-4" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Share — always visible */}
              {isSphinx() ? (
                <>
                  <DropdownMenuItem onClick={handleCopyLink}>
                    <Link className="h-3.5 w-3.5 mr-1.5" />
                    Copy link
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCopySphinxLink}>
                    <Link className="h-3.5 w-3.5 mr-1.5" />
                    Copy Sphinx link
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onClick={handleCopyLink}>
                  <Link className="h-3.5 w-3.5 mr-1.5" />
                  Copy link
                </DropdownMenuItem>
              )}

              {/* Watch */}
              {hasIdentity && (
                <DropdownMenuItem
                  onClick={async () => {
                    if (watchLoading) return
                    const next = !watched
                    setWatched(next)
                    setWatchLoading(true)
                    try {
                      if (next) {
                        await watchNode(currentNode.ref_id)
                      } else {
                        await unwatchNode(currentNode.ref_id)
                      }
                    } catch {
                      setWatched(!next)
                    } finally {
                      setWatchLoading(false)
                    }
                  }}
                  disabled={watchLoading}
                >
                  <Heart
                    className={cn(
                      "h-3.5 w-3.5 mr-1.5 transition-colors",
                      watched ? "fill-red-400 text-red-400" : ""
                    )}
                  />
                  {watched ? "Unwatch" : "Watch"}
                </DropdownMenuItem>
              )}

              {/* Boost */}
              {ownerReference && !hideBoost && (
                <DropdownMenuItem onClick={() => boostRef.current?.querySelector("button")?.click()}>
                  <Zap className="h-3.5 w-3.5 mr-1.5" />
                  Boost
                </DropdownMenuItem>
              )}

              {/* Separator between public actions and power-user/admin actions */}
              {(isAdmin || hasIdentity) && <DropdownMenuSeparator />}

              {/* Add Edge */}
              {(isAdmin || hasIdentity) && (
                <DropdownMenuItem onClick={() => openAddEdge(currentNode)}>
                  <GitMerge className="h-3.5 w-3.5 mr-1.5" />
                  Add Edge
                </DropdownMenuItem>
              )}

              {/* Edit node */}
              {isAdmin && (
                // Seed the modal from the panel's live, in-sync node (currentNode),
                // not the separately-fetched fullNode — so reopening after an edit
                // always reflects the latest values (one source of truth).
                <DropdownMenuItem onClick={() => openEdit(currentNode)}>
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Edit node
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Close — always pinned */}
          <button
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Close panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div ref={scrollContentRef} className="px-4 py-4 space-y-4">
          {/* Thumbnail — only rendered when a real image exists */}
          {showThumbnail && (
            <img
              src={thumbnail}
              alt={title}
              className="w-full h-32 object-cover rounded-md"
            />
          )}

          {/* Parent breadcrumbs — shown when any incoming edge carries properties.index */}
          {edges.some((e) => e.target === currentNode.ref_id && e.properties?.index !== undefined) && (
            <ParentBreadcrumbs nodeRefId={currentNode.ref_id} schemas={schemas} />
          )}

          {/* Title */}
          <p className="text-sm font-semibold">{title}</p>

          {/* Publish / air date — omitted when no date field is present */}
          {(props.date != null || props.published_date != null) && (
            (() => {
              const rel = formatDateRelative(props.date ?? props.published_date)
              return rel ? (
                <p className="text-[11px] font-mono text-muted-foreground -mt-2">{rel}</p>
              ) : null
            })()
          )}

          {/* Description (suppressed when a rich widget already renders this field) */}
          {description && !widgetCoversDescription && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}

          {/* Stakwork project link for admins */}
          {(() => {
            const rawProjectId = fp?.project_id ?? props?.project_id
            const projectId = rawProjectId != null ? String(rawProjectId) : null 
            
            const isLinkable = isAdmin && !!projectId
            if (!isLinkable) return null
            return (
              <a
                href={`https://jobs.stakwork.com/admin/projects/${projectId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary underline underline-offset-2"
              >
                <ExternalLink className="h-3 w-3" />
                View on Stakwork
              </a>
            )
          })()}

          {/* Original tweet link — visible to all users when tweet data is present */}
          {(() => {
            const tweetId = (fp?.tweet_id ?? props?.tweet_id) as string | undefined
            // Only tweets carry a tweet_id. Episodes/articles also have a
            // source_link, so gating on source_link alone leaked this link onto
            // non-tweet nodes — require an actual tweet id.
            if (!tweetId) return null
            const tweetHandle = (fp?.twitter_handle ?? props?.twitter_handle) as string | undefined
            const tweetSourceLink = (fp?.source_link ?? props?.source_link) as string | undefined
            const tweetUrl =
              tweetSourceLink ??
              (tweetHandle ? `https://x.com/${tweetHandle}/status/${tweetId}` : null)
            if (!tweetUrl) return null
            return (
              <a
                href={tweetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary underline underline-offset-2"
              >
                <ExternalLink className="h-3 w-3" />
                View original tweet
              </a>
            )
          })()}

          {/* Deep Research — Topic nodes only */}
          {DEEP_RESEARCH_NODE_TYPES.includes(currentNode.node_type) && (
            <div className="pt-1">
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={deepResearchLoading || isDeepResearchInFlight(deepResearchStatus)}
                onClick={handleDeepResearch}
                data-testid="deep-research-button"
                title="Deep Research this topic"
              >
                {isDeepResearchInFlight(deepResearchStatus) ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Researching…
                  </>
                ) : deepResearchStatus === "COMPLETED" ? (
                  <>
                    <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
                    Re-run Research
                  </>
                ) : (deepResearchStatus === "FAILED" || deepResearchStatus === "ERROR" || deepResearchStatus === "HALTED") ? (
                  <>
                    <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
                    Retry Research
                  </>
                ) : (
                  <>
                    <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
                    Deep Research
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Preview / Loading / Unlocked / Error */}
          {unlockState === "preview" && (
            <div className="space-y-3">
              {paidProperties.length > 0 ? (
                paidProperties.map((field) => (
                  <div
                    key={field}
                    className="flex items-center gap-2 rounded-md bg-muted/30 border border-border/30 px-3 py-2"
                  >
                    <span className="text-muted-foreground text-xs">🔒</span>
                    <span className="text-xs text-muted-foreground font-mono">{field}</span>
                  </div>
                ))
              ) : (
                <>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </>
              )}
              <Button onClick={handleUnlock} size="sm" className="w-full mt-2">
                <BulletIcon className="h-3.5 w-3.5 mr-1.5" />
                {price ? `Unlock for ${price} bullets` : "Unlock Full Content"}
              </Button>
            </div>
          )}

          {unlockState === "loading" && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}

          {unlockState === "error" && (
            <div className="space-y-3">
              <p className="text-xs text-destructive">Unlock failed — tap to retry</p>
              <Button onClick={handleUnlock} size="sm" variant="outline" className="w-full">
                <BulletIcon className="h-3.5 w-3.5 mr-1.5" />
                Retry Unlock
              </Button>
            </div>
          )}

          {unlockState === "unavailable" && (
            <div className="space-y-3 py-2">
              <div className="flex items-start gap-2">
                {unavailableCategory === "in_flight" ? (
                  <Loader2 className="h-4 w-4 text-amber-400 mt-0.5 shrink-0 animate-spin" />
                ) : (
                  <X className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                )}
                <div className="space-y-1">
                  <p className="text-xs font-medium leading-snug">
                    {unavailableCategory === "in_flight"
                      ? "Still processing"
                      : "Content unavailable"}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {unavailableReason ?? "Content is not available."}
                  </p>
                </div>
              </div>
              {unavailableRetryable && (
                <Button
                  onClick={() => setProbeNonce((n) => n + 1)}
                  size="sm"
                  variant="outline"
                  className="w-full"
                >
                  <Loader2 className="h-3.5 w-3.5 mr-1.5" />
                  Check again
                </Button>
              )}
            </div>
          )}

          {unlockState === "unlocked" && fp && (
            <div className="space-y-4">
              {/* Core properties row */}
              {(() => {
                const statusBadge = getStatusBadge(fp.status)
                const sats = typeof fp.boost === "number" && fp.boost > 0
                  ? fp.boost
                  : typeof fp.num_boost === "number" && fp.num_boost > 0
                    ? fp.num_boost
                    : null
                if (!statusBadge && sats === null) return null
                return (
                  <div className="flex items-center gap-2 flex-wrap">
                    {statusBadge && (
                      <span className={`inline-flex items-center rounded-full px-1.5 py-0 h-4 text-[9px] font-medium ${statusBadge.className}`}>
                        {statusBadge.label}
                      </span>
                    )}
                    {sats !== null && (
                      <div className="flex items-center gap-1 text-[11px] font-mono text-amber-400">
                        <BulletIcon className="h-3 w-3" />
                        <span>{sats}</span>
                        <span className="text-muted-foreground">bullets</span>
                      </div>
                    )}
                  </div>
                )
              })()}
              {hasTweet && <TweetCard props={fp} />}
              {/* A tweet's attached Episode is rendered by <AttachableEmbeds>
                  below (native embed, opt-in via attachable:true) — no separate
                  MediaCard here, which previously duplicated it. */}
              {hasTwitterAccount && <TwitterAccountCard props={fp} />}
              {hasPerson && <PersonCard props={fp} />}
              {hasMedia && fullNode && <MediaCard node={fullNode} props={fp} thumbnail={thumbnail} />}
              {isImageNode && <ImageCard props={fp} />}
              {hasSummary && <SummaryBlock text={fp.summary as string} />}
              {hasArticle && <ArticleCard props={fp} />}
              {hasWebPageLink && (
                <a
                  href={linkValue}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View Source
                </a>
              )}
              {hasTranscript && (
                <TranscriptBlock
                  text={fp.transcript as string}
                  onTimestampClick={(seconds) => {
                    if (!isThisNodePlayingHere && fullNode) setPlayingNodePanel(fullNode)
                    seekTo(seconds)
                  }}
                />
              )}

              {hasTranscriptContext && (
                <TranscriptChatWidget
                  context={{
                    selectedRefId: transcriptContextRefId!,
                    nodeType: transcriptContextNodeType,
                    title: title ?? undefined,
                  } satisfies AgentChatContext}
                />
              )}

              {/* Ordered child content — shown when outgoing edges carry properties.index */}
              {edges.some((e) => e.source === currentNode.ref_id && e.properties?.index !== undefined) && (
                <OrderedChildrenView nodeRefId={currentNode.ref_id} schemas={schemas} />
              )}

              {/* Fallback: remaining properties not covered by widgets */}
              {remainingProps.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-border/30">
                  {remainingProps.map(([key, value]) => (
                    <div key={key} className="text-xs">
                      <span className="text-muted-foreground font-mono">{key}</span>
                      <div className={`mt-0.5 text-foreground ${typeof value === "string" && value.length > 150 ? "whitespace-pre-wrap break-words" : "break-all"}`}>
                        {typeof value === "string" && isUrl(value) ? (
                          <a
                            href={value}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary underline underline-offset-2"
                          >
                            {value}
                          </a>
                        ) : (
                          String(value ?? "")
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Attachables — the node's attachable neighbours rendered as native
              embeds (images, episodes…) in the content flow. No label: the
              embeds read as the node's own content. Fetched scoped, not from the
              full neighbourhood. */}
          <AttachableEmbeds nodeRefId={currentNode.ref_id} schemas={schemas} onNavigate={handleNavigate} />

          {/* Connections — always visible regardless of unlock state */}
          <div className="pt-2 border-t border-border/30">
            <ConnectionsSection nodeRefId={currentNode.ref_id} schemas={schemas} onNavigate={handleNavigate} />
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
