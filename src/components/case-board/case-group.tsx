"use client"

import type { GraphNode } from "@/lib/graph-api"
import { DISPLAY_KEY_FALLBACKS, capTitle, resolveNodeThumbnail } from "@/lib/node-display"
import {
  accentFor,
  INK_PRIMARY,
  INK_BODY,
  INK_DIM,
  CARD_BG,
} from "./card-style"

function titleOf(node: GraphNode): string {
  const props = node.properties as Record<string, unknown> | undefined
  if (props) {
    for (const k of DISPLAY_KEY_FALLBACKS) {
      const v = props[k]
      if (typeof v === "string" && v.length > 0) return capTitle(v, 48)
    }
  }
  return node.ref_id
}

// Short trailing meta for a member row — a timestamp / duration / date if the
// node carries one, else nothing. Keeps the list scannable like the reference.
const META_KEYS = ["timestamp", "start", "start_time", "time", "duration", "date", "year"]
function metaOf(node: GraphNode): string | null {
  const props = node.properties as Record<string, unknown> | undefined
  if (!props) return null
  for (const k of META_KEYS) {
    const v = props[k]
    if (typeof v === "string" && v.length > 0 && v.length <= 12) return v
    if (typeof v === "number") return String(v)
  }
  return null
}

// One compact member card — a single thumbnail + title (+ optional meta).
// Reused as the deck's face card (collapsed) and as every tile in the spread
// (expanded). Kept lean so a popped-out group of N reads as N clean cards
// rather than N full property panels.
const MEMBER_W = 168
const MEMBER_HERO_H = 88

function MemberCard({
  node,
  accent,
  onClick,
}: {
  node: GraphNode
  accent: string
  // Omitted for the deck face card (the deck click unstacks instead).
  onClick?: () => void
}) {
  const thumb = resolveNodeThumbnail(node)
  const title = titleOf(node)
  const meta = metaOf(node)
  return (
    <div
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation()
              onClick()
            }
          : undefined
      }
      style={{
        width: MEMBER_W,
        background: CARD_BG,
        border: `1px solid ${accent}66`,
        borderRadius: 8,
        overflow: "hidden",
        cursor: onClick ? "pointer" : "default",
        boxShadow: `0 0 16px ${accent}14, 0 6px 16px rgba(0,0,0,0.45)`,
      }}
    >
      <div
        style={{
          height: MEMBER_HERO_H,
          background: thumb
            ? `center / cover no-repeat url(${thumb})`
            : `${accent}1a`,
          display: thumb ? undefined : "flex",
          alignItems: "center",
          justifyContent: "center",
          color: accent,
          fontSize: 26,
          fontWeight: 700,
          boxShadow: `inset 0 -12px 20px -10px rgba(0,0,0,0.6)`,
        }}
      >
        {!thumb && (title[0]?.toUpperCase() || "•")}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div
          title={title}
          style={{
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.25,
            color: INK_PRIMARY,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "break-word",
          }}
        >
          {title}
        </div>
        {meta && (
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              color: INK_DIM,
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {meta}
          </div>
        )}
      </div>
    </div>
  )
}

// Width the expanded spread wraps at — three member tiles per row.
const SPREAD_COLS = 3
const SPREAD_GAP = 12
const SPREAD_MAX_W = SPREAD_COLS * MEMBER_W + (SPREAD_COLS - 1) * SPREAD_GAP
// Hard cap on tiles rendered in the spread so a 200-member group can't blow the
// board out. The rest collapse into a "+N more" chip.
const SPREAD_CAP = 24
// How many cards peek behind the deck's face card, and their per-layer offset.
const DECK_LAYERS = 3
const DECK_OFFSET = 7

export interface CaseGroupProps {
  // node_type — drives the label + accent.
  type: string
  members: GraphNode[]
  // Whether the group is unstacked (members spread as tiles) vs stacked (deck).
  expanded: boolean
  morphProgress: number
  onToggle: () => void
  onMemberClick: (refId: string) => void
}

// A labeled group container with two states:
//   • stacked  (collapsed) — a deck/pile preview; click to unstack
//   • unstacked (expanded) — members spread as individual tiles inside the
//     container, which grows to fit them; the board re-packs around the new
//     measured size. Click the header to re-stack.
export function CaseGroup({
  type,
  members,
  expanded,
  morphProgress,
  onToggle,
  onMemberClick,
}: CaseGroupProps) {
  const accent = accentFor(type)
  const opacity = Math.max(0, Math.min(1, morphProgress))
  const count = members.length

  return (
    <div
      style={{
        opacity,
        fontFamily: '"Space Grotesk", system-ui, sans-serif',
        userSelect: "none",
        pointerEvents: "auto",
        // Translucent accent-tinted "lasso" so the spread reads as one group;
        // matches the reference's group container without a hard fill.
        background: `${accent}0f`,
        border: `1px solid ${accent}40`,
        borderRadius: 16,
        boxShadow: `0 0 22px ${accent}14, 0 10px 28px rgba(0,0,0,0.45)`,
        overflow: "hidden",
        width: expanded ? "fit-content" : undefined,
        maxWidth: expanded ? SPREAD_MAX_W + 20 : undefined,
      }}
    >
      {/* Header — type · count, plus a stack/unstack affordance. */}
      <Header
        type={type}
        accent={accent}
        count={count}
        expanded={expanded}
        onToggle={onToggle}
      />

      {expanded ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: SPREAD_GAP,
            padding: 10,
            maxWidth: SPREAD_MAX_W + 20,
          }}
        >
          {members.slice(0, SPREAD_CAP).map((m) => (
            <MemberCard
              key={m.ref_id}
              node={m}
              accent={accent}
              onClick={() => onMemberClick(m.ref_id)}
            />
          ))}
          {count > SPREAD_CAP && (
            <div
              style={{
                width: MEMBER_W,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: INK_DIM,
                fontSize: 13,
                fontWeight: 600,
                border: `1px dashed ${accent}55`,
                borderRadius: 8,
              }}
            >
              +{count - SPREAD_CAP} more
            </div>
          )}
        </div>
      ) : (
        <Deck members={members} accent={accent} onToggle={onToggle} />
      )}
    </div>
  )
}

function Header({
  type,
  accent,
  count,
  expanded,
  onToggle,
}: {
  type: string
  accent: string
  count: number
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div
      onClick={onToggle}
      title={expanded ? "Stack group" : "Unstack group"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          color: accent,
        }}
      >
        {type || "node"}
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 18,
          height: 18,
          padding: "0 5px",
          borderRadius: 9,
          background: accent,
          color: "#0a0e15",
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        {count}
      </span>
      <span
        aria-hidden
        style={{
          marginLeft: "auto",
          fontSize: 13,
          lineHeight: 1,
          color: accent,
          fontWeight: 700,
        }}
      >
        {expanded ? "⊟ stack" : "⊞ unstack"}
      </span>
    </div>
  )
}

// The stacked preview: a face card with a few offset "backs" peeking behind it,
// and the members' metas fanned below so the group's range stays visible while
// collapsed. The whole thing unstacks on click.
function Deck({
  members,
  accent,
  onToggle,
}: {
  members: GraphNode[]
  accent: string
  onToggle: () => void
}) {
  const layers = Math.min(members.length - 1, DECK_LAYERS)
  const metas = members
    .map(metaOf)
    .filter((m): m is string => !!m)
    .slice(0, 5)
  return (
    <div onClick={onToggle} style={{ padding: 12, cursor: "pointer" }}>
      <div
        style={{
          position: "relative",
          width: MEMBER_W + layers * DECK_OFFSET,
          height: MEMBER_HERO_H + 60 + layers * DECK_OFFSET,
        }}
      >
        {/* Backs — plain offset card shapes peeking down-right. */}
        {Array.from({ length: layers }).map((_, i) => {
          const off = (layers - i) * DECK_OFFSET
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: off,
                top: off,
                width: MEMBER_W,
                height: MEMBER_HERO_H + 60,
                background: CARD_BG,
                border: `1px solid ${accent}44`,
                borderRadius: 8,
                boxShadow: `0 4px 12px rgba(0,0,0,0.4)`,
              }}
            />
          )
        })}
        {/* Face card — frontmost, display-only (the deck click unstacks). */}
        <div style={{ position: "absolute", left: 0, top: 0 }}>
          <MemberCard node={members[0]} accent={accent} />
        </div>
      </div>
      {metas.length > 0 && (
        <div
          style={{
            marginTop: 8,
            display: "flex",
            flexWrap: "wrap",
            gap: "2px 8px",
            fontSize: 10,
            color: INK_BODY,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {metas.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
          {members.length > metas.length && metas.length === 5 && (
            <span style={{ color: INK_DIM }}>…</span>
          )}
        </div>
      )}
    </div>
  )
}
