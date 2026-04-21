"use client"

import { useState, useEffect } from "react"
import { ArrowLeft, Zap, Loader2, Play, Pause, Film, ExternalLink, Heart, Repeat2, ChevronDown, ChevronUp } from "lucide-react"
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
import { pickString, DISPLAY_KEY_FALLBACKS } from "@/lib/node-display"
import type { GraphNode, GraphData } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"

const INTERNAL_FIELDS = new Set([
  "ref_id", "pubkey", "node_type", "date_added_to_graph",
  // Fields rendered by rich widgets — hide from the fallback key/value list
  "name", "title", "description", "text", "transcript", "media_url", "link",
  "image_url", "thumbnail", "source_link", "tweet_id", "author",
  "twitter_handle", "like_count", "retweet_count", "verified", "date",
  "bio", "duration", "timestamp", "channel", "show", "episode_number",
  "boost", "num_boost",
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

interface NodePreviewPanelProps {
  node: GraphNode
  onBack: () => void
  schemas: SchemaNode[]
}

type UnlockState = "preview" | "loading" | "unlocked" | "error"

// --- Rich content widgets ---

function TweetCard({ props }: { props: Record<string, unknown> }) {
  const text = props.text as string | undefined
  const author = props.author as string | undefined
  const handle = props.twitter_handle as string | undefined
  const likes = typeof props.like_count === "number" ? props.like_count : undefined
  const retweets = typeof props.retweet_count === "number" ? props.retweet_count : undefined
  const date = props.date as string | undefined

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
          {author?.[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{author ?? "Unknown"}</p>
          {handle && <p className="text-[10px] text-muted-foreground font-mono">@{handle}</p>}
        </div>
      </div>
      {text && <p className="text-sm leading-relaxed">{text}</p>}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        {likes !== undefined && (
          <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{formatNumber(likes)}</span>
        )}
        {retweets !== undefined && (
          <span className="flex items-center gap-1"><Repeat2 className="h-3 w-3" />{formatNumber(retweets)}</span>
        )}
        {date && <span>{date}</span>}
      </div>
    </div>
  )
}

function MediaCard({ node, props }: { node: GraphNode; props: Record<string, unknown> }) {
  const setPlayingNode = usePlayerStore((s) => s.setPlayingNode)
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying)
  const isThisNodePlaying = usePlayerStore(
    (s) => s.isPlaying && s.playingNode?.ref_id === node.ref_id
  )
  const mediaUrl = (props.media_url ?? props.link) as string | undefined
  const duration = typeof props.duration === "number" ? props.duration : undefined
  const show = props.show as string | undefined
  const channel = props.channel as string | undefined
  const epNum = typeof props.episode_number === "number" ? props.episode_number : undefined
  const isVideo = typeof mediaUrl === "string" && /\.(mp4|webm|mov)/i.test(mediaUrl)

  return (
    <div className="space-y-2">
      {mediaUrl ? (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => {
            if (isThisNodePlaying) {
              setIsPlaying(false)
            } else {
              setPlayingNode({ ...node, properties: props })
            }
          }}
        >
          {isVideo ? (
            <Film className="h-3.5 w-3.5 mr-1.5" />
          ) : isThisNodePlaying ? (
            <Pause className="h-3.5 w-3.5 mr-1.5" />
          ) : (
            <Play className="h-3.5 w-3.5 mr-1.5" />
          )}
          {isVideo
            ? isThisNodePlaying ? "Pause Video" : "Play Video"
            : isThisNodePlaying ? "Pause Audio" : "Play Audio"
          }
          {duration !== undefined && (
            <span className="ml-auto text-muted-foreground font-mono text-[10px]">
              {formatDuration(duration)}
            </span>
          )}
        </Button>
      ) : null}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        {(show ?? channel) && <span>{show ?? channel}</span>}
        {epNum !== undefined && <span>Ep. {epNum}</span>}
        {duration !== undefined && !mediaUrl && <span>{formatDuration(duration)}</span>}
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

function ArticleCard({ props }: { props: Record<string, unknown> }) {
  const text = props.text as string | undefined
  const sourceLink = props.source_link as string | undefined
  const author = props.author as string | undefined
  const date = props.published_date as string | undefined

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        {author && <span>{author}</span>}
        {author && date && <span>&middot;</span>}
        {date && <span>{date}</span>}
      </div>
      {text && <p className="text-xs leading-relaxed">{text}</p>}
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
    </div>
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
  const { icon: PlaceholderIcon, accent: schemaAccent } = getSchemaIconInfo(schema?.icon)
  const props = node.properties
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
        // Probe without L402: lets admin/contributor bypass return 200 directly,
        // while users with an LSAT balance get 402 + price so they can confirm the spend.
        const result = await api.get<GraphData>(
          `/v2/nodes/${node.ref_id}`,
          { Authorization: "" },
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

  // Detect property-driven content type
  const hasTweet = fp && ("tweet_id" in fp || "twitter_handle" in fp) && "text" in fp
  const hasMedia = fp && ("media_url" in fp || "link" in fp)
  const hasTranscript = fp && typeof fp.transcript === "string"
  const hasArticle = fp && ("source_link" in fp || (typeof fp.text === "string" && !hasTweet))
  const hasPerson = fp && ("bio" in fp || "twitter_handle" in fp) && !hasTweet
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
          {nodeType}
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
          {/* Thumbnail or placeholder */}
          {thumbnail ? (
            <img
              src={thumbnail}
              alt={title}
              className="w-full h-32 object-cover rounded-md"
            />
          ) : (
            <div className="w-full h-32 rounded-md bg-muted/30 border border-border/50 flex items-center justify-center">
              <PlaceholderIcon className="h-8 w-8" style={{ color: `${schemaAccent}50` }} />
            </div>
          )}

          {/* Title */}
          <p className="text-sm font-semibold">{title}</p>

          {/* Description */}
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}

          {/* Preview / Loading / Unlocked / Error */}
          {unlockState === "preview" && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Button onClick={handleUnlock} size="sm" className="w-full mt-2">
                <Zap className="h-3.5 w-3.5 mr-1.5" />
                {price != null ? `Unlock for ${price} sats` : "Unlock Full Content"}
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
                <Zap className="h-3.5 w-3.5 mr-1.5" />
                Retry Unlock
              </Button>
            </div>
          )}

          {unlockState === "unlocked" && fp && (
            <div className="space-y-4">
              {hasTweet && <TweetCard props={fp} />}
              {hasPerson && <PersonCard props={fp} />}
              {hasMedia && fullNode && <MediaCard node={fullNode} props={fp} />}
              {hasArticle && !hasTweet && <ArticleCard props={fp} />}
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
        </div>
      </ScrollArea>
    </div>
  )
}
