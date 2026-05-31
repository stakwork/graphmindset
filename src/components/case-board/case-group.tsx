"use client"

import type { GraphNode } from "@/lib/graph-api"
import { DISPLAY_KEY_FALLBACKS, capTitle, resolveNodeThumbnail } from "@/lib/node-display"
import { accentFor, INK_PRIMARY, INK_DIM, CARD_BG, FIELD_BG } from "./card-style"
import { boardScrollLock } from "./board-scroll-lock"

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

const GROUP_WIDTH = 256
// Card shows ~7 rows then scrolls internally — keeps a 50-member group from
// becoming a giant card while every member stays reachable.
const LIST_MAX_HEIGHT = 360

export interface CaseGroupProps {
  // node_type — drives the label + accent.
  type: string
  members: GraphNode[]
  // Relationship to the focal (dominant edge_type) — shown in the header.
  edgeLabel?: string
  // Whether the body (member list) is shown. Default open; the header toggle
  // collapses to the header only.
  expanded: boolean
  morphProgress: number
  onToggle: () => void
  onMemberClick: (refId: string) => void
}

// A labeled group container: header (type · count + collapse toggle) over a
// vertical list of member rows. Members past ROW_CAP collapse into a "+N more"
// footer so tall types (e.g. 10 topics) don't run off the board.
export function CaseGroup({
  type,
  members,
  edgeLabel,
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
        width: GROUP_WIDTH,
        opacity,
        fontFamily: '"Space Grotesk", system-ui, sans-serif',
        userSelect: "none",
        pointerEvents: "auto",
        background: CARD_BG,
        border: `1px solid ${accent}55`,
        borderRadius: 12,
        boxShadow: `0 0 22px ${accent}1f, 0 10px 28px rgba(0,0,0,0.5)`,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: `${accent}14`,
          borderBottom: expanded ? `1px solid ${accent}26` : "none",
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
        {edgeLabel && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 9,
              color: INK_DIM,
              fontFamily: "ui-monospace, monospace",
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            {edgeLabel}
          </span>
        )}
        <span
          style={{
            marginLeft: edgeLabel ? 8 : "auto",
            fontSize: 14,
            lineHeight: 1,
            color: accent,
            width: 12,
            textAlign: "center",
          }}
        >
          {expanded ? "−" : "+"}
        </span>
      </div>

      {/* Body */}
      {expanded && (
        <div
          // Suppress board zoom while scrolling the list (only when it can
          // actually scroll), so the wheel scrolls the rows instead.
          onPointerEnter={(e) => {
            boardScrollLock.locked =
              e.currentTarget.scrollHeight > e.currentTarget.clientHeight
          }}
          onPointerLeave={() => {
            boardScrollLock.locked = false
          }}
          onWheel={(e) => {
            if (e.currentTarget.scrollHeight > e.currentTarget.clientHeight) {
              e.stopPropagation()
            }
          }}
          style={{
            padding: 6,
            display: "grid",
            gap: 5,
            maxHeight: LIST_MAX_HEIGHT,
            overflowY: "auto",
            // Pin X to hidden — leaving it default makes CSS promote overflow-x
            // to auto whenever overflow-y is auto, which shows a stray
            // horizontal scrollbar on the slightest content overflow.
            overflowX: "hidden",
          }}
        >
          {members.map((m) => (
            <MemberRow
              key={m.ref_id}
              node={m}
              accent={accent}
              onClick={() => onMemberClick(m.ref_id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MemberRow({
  node,
  accent,
  onClick,
}: {
  node: GraphNode
  accent: string
  onClick: () => void
}) {
  const thumb = resolveNodeThumbnail(node)
  const title = titleOf(node)
  const meta = metaOf(node)
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        background: FIELD_BG,
        border: `1px solid ${accent}26`,
        borderRadius: 7,
        cursor: "pointer",
      }}
    >
      {/* Leading badge — thumbnail if present, else first letter. */}
      <div
        style={{
          flex: "0 0 auto",
          width: 26,
          height: 26,
          borderRadius: 6,
          background: thumb ? `center / cover url(${thumb})` : `${accent}22`,
          border: `1px solid ${accent}40`,
          color: accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          overflow: "hidden",
        }}
      >
        {!thumb && (title[0]?.toUpperCase() || "•")}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12.5,
          color: INK_PRIMARY,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {title}
      </div>
      {meta && (
        <div
          style={{
            flex: "0 0 auto",
            fontSize: 10,
            color: INK_DIM,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {meta}
        </div>
      )}
    </div>
  )
}
