"use client"

import type { GraphNode } from "@/lib/graph-api"
import {
  pickString,
  DISPLAY_KEY_FALLBACKS,
  resolveNodeThumbnail,
} from "@/lib/node-display"

// Type accents — saturated enough to read as the neon border + pill chrome
// against the very dark card fill. Matches the Peaky Blinders reference
// where each entity type gets its own glow color.
const TYPE_ACCENT: Record<string, string> = {
  Person: "#5cc9d8",
  Organization: "#a78bfa",
  Location: "#6ee7b7",
  Station: "#fbbf24",
  Weapon: "#f87171",
  Item: "#5cc9d8",
  Transport: "#fb923c",
  Creature: "#f9a8d4",
  Episode: "#93c5fd",
  Chapter: "#93c5fd",
  Clip: "#93c5fd",
  Topic: "#a78bfa",
  Tweet: "#5cc9d8",
}
const DEFAULT_ACCENT = "#94a3b8"

const INK_PRIMARY = "#e8edf2"
const INK_BODY = "#c9d1d9"
const INK_DIM = "#6b7280"
const CARD_BG = "#0d1218"
const FIELD_BG = "#070b11"

const INTERNAL_KEYS = new Set([
  "ref_id", "pubkey", "owner_reference_id", "node_type",
  "date_added_to_graph", "status", "project_id",
  "name", "title", "description", "text", "transcript", "summary",
  "media_url", "link", "image_url", "thumbnail", "source_link",
  "mapX", "mapY", "mapZ",
])

function pickFields(node: GraphNode, max: number): { label: string; value: string }[] {
  const props = node.properties as Record<string, unknown> | undefined
  if (!props) return []
  const out: { label: string; value: string }[] = []
  for (const key of Object.keys(props)) {
    if (INTERNAL_KEYS.has(key)) continue
    const v = props[key]
    if (typeof v === "string" && v.length > 0) {
      out.push({ label: key, value: v.length > 60 ? v.slice(0, 60) + "…" : v })
    } else if (typeof v === "number") {
      out.push({ label: key, value: String(v) })
    }
    if (out.length >= max) break
  }
  if (out.length === 0) {
    for (const key of DISPLAY_KEY_FALLBACKS) {
      const v = props[key]
      if (typeof v === "string" && v.length > 0) {
        out.push({ label: key, value: v.length > 60 ? v.slice(0, 60) + "…" : v })
        break
      }
    }
  }
  return out
}

function pickDescription(node: GraphNode): string | null {
  const props = node.properties as Record<string, unknown> | undefined
  if (!props) return null
  return (
    pickString(props, "description") ??
    pickString(props, "summary") ??
    pickString(props, "text") ??
    pickString(props, "bio") ??
    null
  )
}

// Hard cap on the title string. Some nodes have no name/title and fall all
// the way through DISPLAY_KEY_FALLBACKS to `text`/`content`, which can be a
// whole paragraph — without a cap that renders as a giant wall of text.
const TITLE_MAX = 80

function pickTitle(node: GraphNode): string {
  const props = node.properties as Record<string, unknown> | undefined
  if (!props) return node.ref_id
  for (const key of DISPLAY_KEY_FALLBACKS) {
    const v = props[key]
    if (typeof v === "string" && v.length > 0) {
      return v.length > TITLE_MAX ? v.slice(0, TITLE_MAX).trimEnd() + "…" : v
    }
  }
  return node.ref_id
}

export interface CaseCardProps {
  node: GraphNode
  variant: "selected" | "neighbor"
  // 0..1, drives opacity during the morph. Card is unmounted by NodeMorph
  // below ~0.001 so this stays a smooth fade.
  morphProgress: number
  onClick?: () => void
}

export function CaseCard({ node, variant, morphProgress, onClick }: CaseCardProps) {
  const type = node.node_type || ""
  const accent = TYPE_ACCENT[type] ?? DEFAULT_ACCENT
  const title = pickTitle(node)
  const isSelected = variant === "selected"
  // Neighbor cards carry real detail now — hero image + a few fields — since
  // sparse relationships render as individual cards (dense ones still collapse
  // into a group). Description stays focal-only so the centerpiece remains the
  // most detailed card.
  const description = isSelected ? pickDescription(node) : null
  const fields = pickFields(node, isSelected ? 4 : 3)
  const thumbnail = resolveNodeThumbnail(node)

  const opacity = Math.max(0, Math.min(1, morphProgress))
  const widthPx = isSelected ? 300 : 240
  const heroHeight = isSelected ? 170 : 132

  return (
    <div
      onClick={onClick}
      style={{
        width: widthPx,
        opacity,
        background: CARD_BG,
        borderRadius: 8,
        // Neon-style border + outer glow in the type accent. Slightly stronger
        // on the focal card so it reads as the centerpiece without changing
        // size dramatically.
        border: `1px solid ${accent}${variant === "selected" ? "cc" : "88"}`,
        boxShadow:
          variant === "selected"
            ? `0 0 0 1px ${accent}33, 0 0 32px ${accent}33, 0 14px 36px rgba(0,0,0,0.55)`
            : `0 0 24px ${accent}1a, 0 8px 22px rgba(0,0,0,0.5)`,
        fontFamily: '"Space Grotesk", system-ui, sans-serif',
        color: INK_BODY,
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
        overflow: "hidden",
        pointerEvents: "auto",
      }}
    >
      {thumbnail && (
        <div
          style={{
            width: "100%",
            height: heroHeight,
            backgroundImage: `url(${thumbnail})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            // Subtle bottom shadow so the type pill below has separation
            // from the image edge.
            boxShadow: `inset 0 -12px 20px -10px rgba(0,0,0,0.6)`,
          }}
        />
      )}
      <div style={{ padding: 12 }}>
        {/* Type pill — pill border + text in accent, dark fill */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "3px 8px",
            border: `1px solid ${accent}`,
            borderRadius: 3,
            color: accent,
            background: `${accent}14`,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          {type || "node"}
        </div>
        {/* Title */}
        <div
          style={{
            fontSize: variant === "selected" ? 18 : 15,
            fontWeight: 600,
            lineHeight: 1.2,
            color: INK_PRIMARY,
            marginBottom: description || fields.length > 0 ? 10 : 0,
            // Never let a long fallback title (e.g. a node with only `text`)
            // grow into a tall column — clamp to 2 lines with ellipsis.
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "break-word",
          }}
        >
          {title}
        </div>
        {description && (
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.45,
              color: INK_BODY,
              marginBottom: fields.length > 0 ? 10 : 0,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {description}
          </div>
        )}
        {fields.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            {fields.map((f) => (
              <div key={f.label}>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: 1.2,
                    textTransform: "uppercase",
                    color: INK_DIM,
                    marginBottom: 3,
                  }}
                >
                  {f.label}
                </div>
                {/* Value box — dark fill with a vertical accent bar on the
                    left. Matches the Peaky reference's framed-field style. */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "stretch",
                    background: FIELD_BG,
                    borderRadius: 4,
                    overflow: "hidden",
                    border: `1px solid ${accent}33`,
                  }}
                >
                  <div
                    style={{
                      width: 3,
                      background: accent,
                      boxShadow: `0 0 6px ${accent}80`,
                    }}
                  />
                  <div
                    style={{
                      padding: "5px 10px",
                      fontSize: 11,
                      color: INK_BODY,
                      lineHeight: 1.3,
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {f.value}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
