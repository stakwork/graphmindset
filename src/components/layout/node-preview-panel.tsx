"use client"

import { useState, useEffect } from "react"
import { ArrowLeft, Zap, Loader2, Play, Film, ExternalLink, Heart, Repeat2, ChevronDown, ChevronUp, MessageCircle, Quote, Eye, BadgeCheck, AtSign } from "lucide-react"
import { getSchemaIconInfo } from "@/lib/schema-icons"
import { Badge } from "@/components/ui/badge"
import { BoostButton } from "@/components/boost/boost-button"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { api } from "@/lib/api"
import { payL402, getPrice } from "@/lib/sphinx"
import { isMocksEnabled, MOCK_FULL_NODES } from "@/lib/mock-data"
import { usePlayerStore } from "@/stores/player-store"
import { useUserStore } from "@/stores/user-store"
import { useModalStore } from "@/stores/modal-store"
import { cn, displayNodeType } from "@/lib/utils"
import { pickString, DISPLAY_KEY_FALLBACKS } from "@/lib/node-display"
import { getStatusBadge, isBlockedStatus } from "@/lib/node-status"
import type { GraphNode, GraphData } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"
import { ConnectionsSection } from "./connections-section"
import { formatDateAbsolute } from "@/lib/date-format"

const INTERNAL_FIELDS = new Set([
  "ref_id", "pubkey", "node_type", "date_added_to_graph", "status", "project_id",
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
  "profile_image_url", "author_id", "verified_type", "is_identity_verified",
])

function isUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  return `${m}:${s.toString().padStart(2, "0")}`
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return String(n)
}

function pickNumber(props: Record<string, unknown>, key: string): number | undefined {
  const v = props[key]
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

interface NodePreviewPanelProps {
  node: GraphNode
  onBack: () => void
  schemas: SchemaNode[]
}

type UnlockState = "preview" | "loading" | "unlocked" | "error"

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

function MediaCard({ node, props }: { node: GraphNode; props: Record<string, unknown> }) {
  const setPlayingNode = usePlayerStore((s) => s.setPlayingNode)
  const setHost = usePlayerStore((s) => s.setHost)
  const isThisNodeSelected = usePlayerStore(
    (s) => s.playingNode?.ref_id === node.ref_id
  )
  const mediaUrl = (props.media_url ?? props.link) as string | undefined
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
            style={{ marginBottom: 44 }}
          />
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => setPlayingNode({ ...node, properties: props })}
          >
            {isVideo ? (
              <Film className="h-3.5 w-3.5 mr-1.5" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-1.5" />
            )}
            {isVideo ? "Play Video" : "Play Audio"}
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

function TranscriptBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > 300
  const display = isLong && !expanded ? text.slice(0, 300) + "\u2026" : text

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Transcript</p>
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

function SummaryBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > 300
  const display = isLong && !expanded ? text.slice(0, 300) + "\u2026" : text

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
  const imageUrl =
    (props.profile_image_url as string | undefined) ??
    (props.image_url as string | undefined)
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
      {bio && <p className="text-xs leading-relaxed">{bio}</p>}
      {handle && (
        <p className="text-[10px] text-muted-foreground font-mono">@{handle}</p>
      )}
    </div>
  )
}

// --- Main component ---

export function NodePreviewPanel({ node, onBack, schemas }: NodePreviewPanelProps) {
  const [unlockState, setUnlockState] = useState<UnlockState>("loading")
  const [fullNode, setFullNode] = useState<GraphNode | null>(null)
  const [price, setPrice] = useState<number | null>(null)
  const refreshBalance = useUserStore((s) => s.refreshBalance)
  const userPubKey = useUserStore((s) => s.pubKey)
  const userRouteHint = useUserStore((s) => s.routeHint)
  const isAdmin = useUserStore((s) => s.isAdmin)
  const openModal = useModalStore((s) => s.open)

  const nodeType = node.node_type ?? "Unknown"
  const schema = schemas.find((s) => s.type === nodeType)
  const paidProperties = schema?.paid_properties ?? []
  const { icon: PlaceholderIcon, accent: schemaAccent } = getSchemaIconInfo(schema?.icon)
  const props = node.properties
  const nodeIsBlocked = isBlockedStatus(props?.status)
  const pubkey = typeof props?.pubkey === "string" ? props.pubkey : undefined
  const routeHint = typeof props?.route_hint === "string" ? props.route_hint : undefined
  const boostAmt = typeof props?.boost === "number" ? props.boost : 0

  const userFullPubkey = userPubKey && userRouteHint ? `${userPubKey}_${userRouteHint}` : userPubKey
  const isContributor = !!pubkey && pubkey === userFullPubkey
  const hideBoost = isAdmin || isContributor

  let title = pickString(props, schema?.title_key) ?? pickString(props, schema?.index)
  if (!title) {
    for (const key of DISPLAY_KEY_FALLBACKS) {
      title = pickString(props, key)
      if (title) break
    }
  }
  if (!title) title = node.ref_id

  const rawDesc = pickString(props, schema?.description_key)
    ?? pickString(props, "description")
  const description = rawDesc && rawDesc.length > 160
    ? rawDesc.slice(0, 160) + "\u2026"
    : rawDesc

  const thumbnail = (props?.image_url ?? props?.thumbnail) as string | undefined
  // Hide the static thumbnail when this node is the one currently playing —
  // the inline MediaPlayer card (rendered by MediaCard below) already shows
  // the video frame, so both together would be a duplicate.
  const isThisNodePlayingHere = usePlayerStore(
    (s) => s.playingNode?.ref_id === node.ref_id
  )
  const showThumbnail = !!thumbnail && !isThisNodePlayingHere

  async function handleUnlock() {
    setUnlockState("loading")
    try {
      const result = await api.get<GraphData>(`/v2/nodes/${node.ref_id}`)
      const unlocked = result.nodes?.[0] ?? null
      setFullNode(unlocked)
      setUnlockState("unlocked")
      refreshBalance()
    } catch (err) {
      if (err instanceof Response && err.status === 402) {
        try {
          await payL402(() => {})
          const result = await api.get<GraphData>(`/v2/nodes/${node.ref_id}`)
          const unlocked = result.nodes?.[0] ?? null
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
    const controller = new AbortController()

    setUnlockState("loading")
    setFullNode(null)
    setPrice(null)

    async function probe() {
      if (isMocksEnabled()) {
        await new Promise((r) => setTimeout(r, 300))
        if (controller.signal.aborted) return
        const mock = MOCK_FULL_NODES[node.ref_id]
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
          `/v2/nodes/${node.ref_id}?preview=1`,
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
          const p = await getPrice(`v2/nodes/${node.ref_id}`, "get", controller.signal)
          if (controller.signal.aborted) return
          setPrice(p || null)
          setUnlockState("preview")
        } else {
          setUnlockState("error")
        }
      }
    }

    probe()
    return () => controller.abort()
  }, [node.ref_id, refreshBalance])

  const fp = fullNode?.properties

  // Detect property-driven content type. Rules are mutually exclusive — a node
  // with overlapping shapes (e.g. Episode has media_url AND source_link, or a
  // Person with a twitter_handle) only renders one rich widget.
  //   bio wins over twitter_handle → Person, not TwitterAccount.
  //   media_url wins over source_link → MediaCard, not ArticleCard.
  const hasTweet = !!fp && "tweet_id" in fp && "text" in fp
  const hasMedia = !!fp && ("media_url" in fp || "link" in fp)
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
          onClick={onBack}
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
        {pubkey && !hideBoost && (
          <div className="ml-auto">
            <BoostButton
              refId={node.ref_id}
              pubkey={pubkey}
              routeHint={routeHint}
              boostCount={boostAmt}
            />
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-4 space-y-4">
          {/* Thumbnail or placeholder (skipped when MediaCard is already
              rendering the video frame for this node) */}
          {showThumbnail ? (
            <img
              src={thumbnail}
              alt={title}
              className="w-full h-32 object-cover rounded-md"
            />
          ) : isThisNodePlayingHere ? null : (
            <div className="w-full h-32 rounded-md bg-muted/30 border border-border/50 flex items-center justify-center">
              <PlaceholderIcon className="h-8 w-8" style={{ color: `${schemaAccent}50` }} />
            </div>
          )}

          {/* Title */}
          <p className="text-sm font-semibold">{title}</p>

          {/* Description (suppressed when a rich widget already renders this field) */}
          {description && !widgetCoversDescription && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}

          {/* Stakwork project link for admins */}
          {(() => {
            const projectId = typeof props?.project_id === "string" ? props.project_id : null
            const status = typeof props?.status === "string" ? props.status : null
            const isLinkable =
              isAdmin &&
              projectId &&
              status &&
              ["in_progress", "processing", "halted", "error", "failed"].includes(status)
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
              {nodeIsBlocked ? (
                <p className="text-xs text-muted-foreground">Content unavailable — check status above.</p>
              ) : (
                <Button onClick={handleUnlock} size="sm" className="w-full mt-2">
                  <Zap className="h-3.5 w-3.5 mr-1.5" />
                  {price != null ? `Unlock for ${price} sats` : "Unlock Full Content"}
                </Button>
              )}
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
                <Zap className="h-3.5 w-3.5 mr-1.5" />
                Retry Unlock
              </Button>
            </div>
          )}

          {unlockState === "unlocked" && fp && (
            <div className="space-y-4">
              {/* Core properties row */}
              {(() => {
                const statusBadge = getStatusBadge(fp.status)
                const dateStr = typeof fp.date_added_to_graph === "string" && fp.date_added_to_graph
                  ? new Date(fp.date_added_to_graph).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : null
                const sats = typeof fp.boost === "number" && fp.boost > 0
                  ? fp.boost
                  : typeof fp.num_boost === "number" && fp.num_boost > 0
                  ? fp.num_boost
                  : null
                if (!statusBadge && !dateStr && sats === null) return null
                return (
                  <div className="flex items-center gap-2 flex-wrap">
                    {statusBadge && (
                      <span className={`inline-flex items-center rounded-full px-1.5 py-0 h-4 text-[9px] font-medium ${statusBadge.className}`}>
                        {statusBadge.label}
                      </span>
                    )}
                    {dateStr && (
                      <span className="text-[11px] font-mono text-muted-foreground">{dateStr}</span>
                    )}
                    {sats !== null && (
                      <div className="flex items-center gap-1 text-[11px] font-mono text-amber-400">
                        <Zap className="h-3 w-3" />
                        <span>{sats}</span>
                        <span className="text-muted-foreground">sats</span>
                      </div>
                    )}
                  </div>
                )
              })()}
              {hasTweet && <TweetCard props={fp} />}
              {hasTwitterAccount && <TwitterAccountCard props={fp} />}
              {hasPerson && <PersonCard props={fp} />}
              {hasMedia && fullNode && <MediaCard node={fullNode} props={fp} />}
              {hasSummary && <SummaryBlock text={fp.summary as string} />}
              {hasArticle && <ArticleCard props={fp} />}
              {hasTranscript && <TranscriptBlock text={fp.transcript as string} />}

              {/* Fallback: remaining properties not covered by widgets */}
              {remainingProps.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-border/30">
                  {remainingProps.map(([key, value]) => (
                    <div key={key} className="text-xs">
                      <span className="text-muted-foreground font-mono">{key}</span>
                      <div className="mt-0.5 text-foreground break-all">
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
          {/* Connections — always visible regardless of unlock state */}
          <div className="pt-2 border-t border-border/30">
            <ConnectionsSection nodeRefId={node.ref_id} schemas={schemas} />
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
