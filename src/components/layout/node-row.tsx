"use client"

import { useState } from "react"
import { Zap, ExternalLink } from "lucide-react"
import { getSchemaIconInfo } from "@/lib/schema-icons"
import { Badge } from "@/components/ui/badge"
import { BoostButton } from "@/components/boost/boost-button"
import { pickString, DISPLAY_KEY_FALLBACKS } from "@/lib/node-display"
import { getStatusBadge } from "@/lib/node-status"
import { cn, displayNodeType } from "@/lib/utils"
import type { GraphNode } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"

// Best-effort coercion of `date` / `published_date` (unix int, unix string,
// ISO string, or Date object) into "30 APR 2026" — null when unparseable.
function formatRowDate(value: unknown): string | null {
  if (value == null) return null
  let d: Date | null = null
  if (typeof value === "number" && Number.isFinite(value)) {
    d = new Date(value < 1e11 ? value * 1000 : value)
  } else if (typeof value === "string" && value.length > 0) {
    if (/^\d+$/.test(value)) {
      const n = Number(value)
      d = new Date(n < 1e11 ? n * 1000 : n)
    } else {
      d = new Date(value)
    }
  }
  if (!d || Number.isNaN(d.getTime())) return null
  return d
    .toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
    .toUpperCase()
}

interface NodeRowProps {
  node: GraphNode
  schemas: SchemaNode[]
  onClick: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  /** Override the displayed name (e.g. with search-term highlights as React nodes) */
  nameDisplay?: React.ReactNode
  /** Extra content rendered after the type badge (e.g. match excerpt) */
  matchExcerpt?: React.ReactNode
  /** Whether to hide the boost/sats UI (e.g. for content contributors or admins) */
  hideBoost?: boolean
  /** When true, status badges with a project_id link to Stakwork admin */
  isAdmin?: boolean
}

export function NodeRow({
  node,
  schemas,
  onClick,
  onMouseEnter,
  onMouseLeave,
  nameDisplay,
  matchExcerpt,
  hideBoost = false,
  isAdmin = false,
}: NodeRowProps) {
  const [imgError, setImgError] = useState(false)

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
  const boostAmt = typeof props?.boost === "number" ? props.boost : 0
  const statusBadge = getStatusBadge(props?.status)
  const { icon: Icon, accent } = getSchemaIconInfo(schema?.icon)

  const projectId = typeof props?.project_id === "string" ? props.project_id : null
  const stakworkUrl = isAdmin && projectId && statusBadge
    ? `https://jobs.stakwork.com/admin/projects/${projectId}`
    : null

  const thumbnail = pickString(props, "image_url") ?? pickString(props, "thumbnail")
  const showThumbnail = !!thumbnail && !imgError
  const tileClasses = "h-9 w-9 shrink-0 rounded-md border"

  // Body/summary excerpt and date — surface these so rows whose title is a
  // shared field (e.g. every Tweet titled by twitter_handle "levie") still
  // differentiate visually. Skipped when an explicit matchExcerpt is provided.
  const descKey = schema?.description_key
  const snippetSource =
    (descKey && pickString(props, descKey)) ??
    pickString(props, "text") ??
    pickString(props, "summary") ??
    pickString(props, "description") ??
    pickString(props, "bio")
  const snippet =
    snippetSource && snippetSource !== name
      ? snippetSource.length > 90
        ? snippetSource.slice(0, 90).replace(/\s+\S*$/, "") + "…"
        : snippetSource
      : undefined
  const rowDate = formatRowDate(props?.date) ?? formatRowDate(props?.published_date)

  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="flex items-center gap-3 px-4 py-3 w-full text-left cursor-pointer hover:bg-sidebar-accent transition-colors group overflow-hidden"
    >
      {showThumbnail ? (
        <img
          src={thumbnail}
          alt=""
          className={`${tileClasses} object-cover border-border/40`}
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className={`${tileClasses} flex items-center justify-center`}
          style={{ backgroundColor: `${accent}15`, borderColor: `${accent}30` }}
        >
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </div>
      )}
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm text-foreground truncate min-w-0">
            {nameDisplay ?? name}
          </p>
          <Badge
            variant="outline"
            className="text-[9px] px-1.5 py-0 h-4 font-mono shrink-0"
            style={{
              borderColor: `${accent}55`,
              color: accent,
              backgroundColor: `${accent}10`,
            }}
          >
            {displayNodeType(nodeType)}
          </Badge>
          {statusBadge && (
            stakworkUrl ? (
              <a
                href={stakworkUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0 h-4 text-[9px] font-medium ${statusBadge.className}`}
              >
                {statusBadge.label}
                <ExternalLink className="h-2.5 w-2.5 ml-0.5 inline" />
              </a>
            ) : (
              <span
                className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0 h-4 text-[9px] font-medium ${statusBadge.className}`}
              >
                {statusBadge.label}
              </span>
            )
          )}
        </div>
        {matchExcerpt ?? (
          (snippet || rowDate) && (
            <div className="mt-1 flex items-baseline gap-2 min-w-0">
              {snippet && (
                <p className="text-[11px] text-muted-foreground/80 truncate">
                  {snippet}
                </p>
              )}
              {rowDate && (
                <span
                  className={cn(
                    "shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60",
                    snippet && "ml-auto"
                  )}
                >
                  {rowDate}
                </span>
              )}
            </div>
          )
        )}
      </div>
      {!hideBoost && pubkey && (
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          <BoostButton
            refId={node.ref_id}
            pubkey={pubkey}
            routeHint={routeHint}
            boostCount={boostAmt}
            className="shrink-0"
          />
        </div>
      )}
      {!hideBoost && !pubkey && boostAmt > 0 && (
        <div className="shrink-0 flex items-center gap-1 text-[11px] font-mono text-amber-400">
          <Zap className="h-3 w-3" />
          <span>{boostAmt}</span>
          <span className="text-muted-foreground">sats</span>
        </div>
      )}
    </button>
  )
}
