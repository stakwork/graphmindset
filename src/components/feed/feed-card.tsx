"use client"

import { Heart, MessageCircle, Repeat2, Eye, Play, BadgeCheck } from "lucide-react"
import { parseTimestamp } from "@/lib/date-format"
import { pickString, resolveNodeTitle, resolveNodeThumbnail } from "@/lib/node-display"
import { getSchemaIconInfo } from "@/lib/schema-icons"
import { cn, formatCompactNumber } from "@/lib/utils"
import type { GraphNode } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"

function timeAgo(value: unknown): string | null {
  const d = parseTimestamp(value)
  if (!d) return null
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d`
  return `${Math.floor(diff / (86400 * 30))}mo`
}

function resolveBody(node: GraphNode): string | undefined {
  const p = node.properties
  return (
    pickString(p, "description") ||
    pickString(p, "summary") ||
    pickString(p, "bio") ||
    pickString(p, "claim_text") ||
    pickString(p, "text")
  )
}

interface FeedCardProps {
  node: GraphNode
  schemas: SchemaNode[]
  selected?: boolean
  onSelect?: () => void
  onHover?: (hovering: boolean) => void
}

export function FeedCard({ node, schemas, selected, onSelect, onHover }: FeedCardProps) {
  const schema = schemas.find((s) => s.type === (node.node_type ?? "Unknown"))
  const { icon: Icon, accent } = getSchemaIconInfo(schema?.icon)
  const p = node.properties || {}
  const title = resolveNodeTitle(node, schemas)
  const body = resolveBody(node)
  const thumb = resolveNodeThumbnail(node)
  const avatar = pickString(p, "image_url") || thumb
  const handle = pickString(p, "twitter_handle")
  const type = node.node_type ?? "Unknown"
  const when = timeAgo(typeof p.date === "number" ? p.date : node.date_added_to_graph)

  return (
    <article
      onClick={onSelect}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      className={cn(
        "group relative rounded-xl border bg-card/40 p-5 cursor-pointer transition-all",
        selected
          ? "border-primary/50 shadow-[0_0_30px_oklch(0.72_0.14_200/0.15)]"
          : "border-border/40 hover:border-border hover:bg-card/70"
      )}
    >
      <div className="flex items-start gap-3 mb-3">
        {avatar ? (
          <div
            className="h-10 w-10 rounded-full bg-cover bg-center shrink-0 ring-1 ring-border/60"
            style={{ backgroundImage: `url(${avatar})` }}
          />
        ) : (
          <div
            className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 ring-1 ring-border/60"
            style={{ backgroundColor: `${accent}26` }}
          >
            <Icon className="h-4 w-4" style={{ color: accent }} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{title}</span>
            {p.verified === true && <BadgeCheck className="h-3.5 w-3.5 text-primary" />}
            {handle && (
              <span className="font-mono text-[11px] text-muted-foreground">@{handle}</span>
            )}
            <span className="text-muted-foreground">·</span>
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: accent }}>
              {type}
            </span>
            {when && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="font-mono text-[10px] text-muted-foreground">{when}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="ml-[52px]">
        <CardBody node={node} title={title} body={body} thumb={thumb} accent={accent} />
      </div>

      <div className="ml-[52px] mt-4 flex items-center gap-5 font-mono text-[11px] text-muted-foreground">
        {typeof p.reply_count === "number" && (
          <span className="flex items-center gap-1.5 hover:text-foreground transition-colors">
            <MessageCircle className="h-3 w-3" />
            {formatCompactNumber(p.reply_count)}
          </span>
        )}
        {typeof p.retweet_count === "number" && (
          <span className="flex items-center gap-1.5 hover:text-chart-2 transition-colors">
            <Repeat2 className="h-3 w-3" />
            {formatCompactNumber(p.retweet_count)}
          </span>
        )}
        {typeof p.like_count === "number" && (
          <span className="flex items-center gap-1.5 hover:text-chart-5 transition-colors">
            <Heart className="h-3 w-3" />
            {formatCompactNumber(p.like_count)}
          </span>
        )}
        {typeof p.impression_count === "number" && (
          <span className="flex items-center gap-1.5">
            <Eye className="h-3 w-3" />
            {formatCompactNumber(p.impression_count)}
          </span>
        )}
        {typeof p.boost === "number" && p.boost > 0 && (
          <span className="ml-auto flex items-center gap-1 text-amber">↑ {p.boost}</span>
        )}
      </div>
    </article>
  )
}

function CardBody({
  node,
  title,
  body,
  thumb,
  accent,
}: {
  node: GraphNode
  title: string
  body: string | undefined
  thumb: string | undefined
  accent: string
}) {
  const p = node.properties || {}
  const type = node.node_type ?? "Unknown"

  if (type === "Tweet") {
    return body ? <p className="text-[15px] text-foreground/90 leading-relaxed">{body}</p> : null
  }

  if (type === "Episode" || type === "Video" || type === "Podcast") {
    const heading = pickString(p, "episode_title") || pickString(p, "name") || title
    return (
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-foreground leading-tight">{heading}</h3>
        {thumb && <MediaThumbnail thumb={thumb} props={p} />}
        {body && <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{body}</p>}
      </div>
    )
  }

  if (type === "Document") {
    return (
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-foreground leading-tight">
          {pickString(p, "title") || title}
        </h3>
        {body && <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{body}</p>}
        <div className="flex items-center gap-3 pt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {pickString(p, "author") && <span>by {pickString(p, "author")}</span>}
          {pickString(p, "content_type") && (
            <>
              <span>·</span>
              <span>{pickString(p, "content_type")}</span>
            </>
          )}
        </div>
      </div>
    )
  }

  if (type === "Claim") {
    return (
      <blockquote className="border-l-2 border-amber pl-4 -ml-1" style={{ borderColor: accent }}>
        <p className="text-[15px] italic text-foreground/90 leading-relaxed">
          &ldquo;{pickString(p, "claim_text") || body || title}&rdquo;
        </p>
        {pickString(p, "speaker_name") && (
          <footer className="mt-2 font-mono text-[11px] text-muted-foreground">
            — {pickString(p, "speaker_name")}
          </footer>
        )}
      </blockquote>
    )
  }

  return body ? <p className="text-sm text-muted-foreground leading-relaxed">{body}</p> : null
}

function MediaThumbnail({ thumb, props }: { thumb: string; props: Record<string, unknown> }) {
  const showTitle = pickString(props, "show_title") || pickString(props, "channel") || ""
  const episodeNumber = typeof props.episode_number === "number" ? props.episode_number : null
  const duration = typeof props.duration === "number" ? props.duration : null
  return (
    <div
      className="relative aspect-video rounded-lg overflow-hidden bg-cover bg-center ring-1 ring-border/40"
      style={{ backgroundImage: `url(${thumb})` }}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
      <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between">
        <div className="font-mono text-[10px] uppercase tracking-wider text-amber">
          {showTitle}
          {episodeNumber !== null && ` · #${episodeNumber}`}
        </div>
        <div className="h-9 w-9 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
          <Play className="h-3.5 w-3.5 text-white fill-white ml-0.5" />
        </div>
      </div>
      {duration !== null && (
        <div className="absolute top-2 right-2 px-2 py-0.5 rounded font-mono text-[10px] bg-black/60 text-white">
          {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, "0")}
        </div>
      )}
    </div>
  )
}
