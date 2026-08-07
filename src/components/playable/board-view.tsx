"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { zoom as d3Zoom, zoomIdentity, type ZoomTransform } from "d3-zoom"
import { select as d3Select } from "d3-selection"
import {
  nodeById,
  nodeLabel,
  truncateLabel,
  typeColor,
  formatMs,
  episodeNode,
  getClaimRelations,
  getChapterMentions,
  getChapters,
  boardEdges,
} from "@/lib/board-dataset"
import {
  computeBoardLayout,
  center,
  type CardPlacement,
} from "./board-layout"
import type { ZoomApi } from "./view-types"

// Semantic zoom thresholds: below FAR the board collapses to group summaries,
// above DETAIL cards reveal descriptions / transcripts / edge labels.
const ZOOM_FAR = 0.42
const ZOOM_DETAIL = 1.25

// Edge / surface palette — the app theme's border token (oklch 0.2) is nearly
// invisible at 1px on this canvas, so the board uses brighter steps.
const EDGE_COLOR = "oklch(0.48 0.03 260)"
const EDGE_ACTIVE = "oklch(0.72 0.14 200)"
const EDGE_LABEL = "oklch(0.72 0.02 260)"
const SUPPORTS_COLOR = "#2ec4b6"
const CONTRADICTS_COLOR = "#e63946"

type Level = 0 | 1 | 2

function levelFor(k: number): Level {
  return k < ZOOM_FAR ? 0 : k > ZOOM_DETAIL ? 2 : 1
}

/** Entity nodes carry no images in the DB — for people we derive an initials
 *  avatar so Person chips read as people, not bare dots. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}

/** Muted inline video used as a visual thumbnail. pointer-events are off so it
 *  never interferes with board pan/select; preload="metadata" grabs the first
 *  frame without streaming the whole clip. */
function MediaThumb({ src, className }: { src: string; className?: string }) {
  return (
    <video
      src={src}
      muted
      playsInline
      preload="metadata"
      className={`pointer-events-none rounded border border-white/10 object-cover ${className ?? ""}`}
    />
  )
}

function mediaUrlOf(node: { properties: Record<string, unknown> }): string | null {
  const v = node.properties.media_url
  return typeof v === "string" && v.length > 0 ? v : null
}

interface BoardViewProps {
  /** Bumped when the underlying dataset is swapped — recomputes layout memos. */
  dataVersion?: number
  selectedId: string | null
  hoveredId: string | null
  /** Show all claim↔claim arcs at once; off = reveal on hover/select only. */
  showRelations: boolean
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  registerZoomApi: (api: ZoomApi | null) => void
}

export function BoardView({
  dataVersion = 0,
  selectedId,
  hoveredId,
  showRelations,
  onSelect,
  onHover,
  registerZoomApi,
}: BoardViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const [level, setLevel] = useState<Level>(1)
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null)
  // Drag-distance guard so panning doesn't clear the selection on mouseup.
  const downAt = useRef<{ x: number; y: number } | null>(null)

  const layout = useMemo(() => {
    void dataVersion // layout reads the module dataset, swapped by the explorer
    return computeBoardLayout(level === 2)
  }, [dataVersion, level])
  // The zoom/fit effect must fit on data swap, NOT on level-driven relayout
  // (zooming past the detail threshold would otherwise bounce the view back).
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const claimCountByChapter = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of layout.claims) m.set(c.chapterId, (m.get(c.chapterId) ?? 0) + 1)
    return m
  }, [layout])
  const claimCardById = useMemo(
    () => new Map(layout.claims.map((c) => [c.card.id, c.card])),
    [layout]
  )
  const claimRelations = useMemo(() => {
    void dataVersion
    return getClaimRelations()
  }, [dataVersion])
  /** Supports/contradicts involvement per claim — shown as ▲/▼ badges on the
   *  claim cards so the relation web is visible without hovering. */
  const claimRelCounts = useMemo(() => {
    const m = new Map<string, { sup: number; con: number }>()
    const bump = (id: string, key: "sup" | "con") => {
      const r = m.get(id) ?? { sup: 0, con: 0 }
      r[key]++
      m.set(id, r)
    }
    for (const e of claimRelations.supports) {
      bump(e.source, "sup")
      bump(e.target, "sup")
    }
    for (const e of claimRelations.contradicts) {
      bump(e.source, "con")
      bump(e.target, "con")
    }
    return m
  }, [claimRelations])
  const chapterMentions = useMemo(() => {
    void dataVersion
    return getChapterMentions()
  }, [dataVersion])
  const chapterCardById = useMemo(
    () => new Map(layout.chapters.map((c) => [c.card.id, c.card])),
    [layout]
  )
  const entityChipById = useMemo(() => {
    const m = new Map<string, CardPlacement>()
    for (const e of layout.entities) m.set(e.card.id, e.card)
    return m
  }, [layout])
  // Host chip in the entity band — MADE_CLAIM lines target it.
  const hostChip = useMemo(
    () => (layout.hostId ? (entityChipById.get(layout.hostId) ?? null) : null),
    [layout, entityChipById]
  )
  const activeId = hoveredId ?? selectedId

  // Focus model: the active node + everything directly connected to it, over
  // ALL edge types. Used to light up one node's web and dim the rest — the
  // static view only draws the hierarchy, relations reveal on focus.
  const focusSet = useMemo(() => {
    if (!activeId) return null
    const set = new Set<string>([activeId])
    for (const e of boardEdges) {
      if (e.source === activeId) set.add(e.target)
      if (e.target === activeId) set.add(e.source)
    }
    return set
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boardEdges is a swapped module binding
  }, [activeId, dataVersion])
  const dimmed = (id: string) => (focusSet ? !focusSet.has(id) : false)

  useEffect(() => {
    const el = containerRef.current
    const world = worldRef.current
    if (!el || !world) return

    const apply = (t: ZoomTransform) => {
      world.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`
      setLevel((prev) => {
        const next = levelFor(t.k)
        return prev === next ? prev : next
      })
    }

    const zoom = d3Zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.08, 5])
      .on("zoom", (event: { transform: ZoomTransform }) => apply(event.transform))

    const sel = d3Select(el)
    sel.call(zoom)

    const vw = el.clientWidth
    const vh = el.clientHeight
    const { bounds } = layoutRef.current
    const bw = bounds.maxX - bounds.minX
    const bh = bounds.maxY - bounds.minY
    const k = Math.min(vw / bw, vh / bh) * 0.94
    const cx = (bounds.minX + bounds.maxX) / 2
    const cy = (bounds.minY + bounds.maxY) / 2
    const fit = zoomIdentity.translate(vw / 2 - k * cx, vh / 2 - k * cy).scale(k)
    sel.call(zoom.transform, fit)

    registerZoomApi({
      zoomIn: () => sel.transition().duration(200).call(zoom.scaleBy, 1.4),
      zoomOut: () => sel.transition().duration(200).call(zoom.scaleBy, 1 / 1.4),
      reset: () => sel.transition().duration(300).call(zoom.transform, fit),
    })
    return () => registerZoomApi(null)
  }, [dataVersion, registerZoomApi])

  const episode = layout.episode
  const episodeCenter = episode ? center(episode) : { x: 0, y: 0 }

  const cardState = (id: string) => ({
    selected: selectedId === id,
    active: activeId === id,
    dim: dimmed(id),
    halo: focusSet != null && focusSet.has(id) && id !== activeId,
  })

  const select = (id: string) => onSelect(selectedId === id ? null : id)

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden cursor-grab active:cursor-grabbing"
      onPointerDown={(e) => {
        downAt.current = { x: e.clientX, y: e.clientY }
      }}
      onClick={(e) => {
        const d = downAt.current
        const moved = d ? Math.hypot(e.clientX - d.x, e.clientY - d.y) : 0
        if (moved < 4 && e.target === containerRef.current) onSelect(null)
      }}
      onPointerMove={(e) => {
        if (hoveredId) setTipPos({ x: e.clientX, y: e.clientY })
      }}
    >
      <div ref={worldRef} className="absolute left-0 top-0 h-0 w-0 origin-top-left">
        {/* ─── Edge layer ─── */}
        <svg
          className="absolute overflow-visible pointer-events-none"
          width={1}
          height={1}
          style={{ left: 0, top: 0 }}
        >
          <defs>
            <marker id="arrow-supports" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0.5 L 8 4 L 0 7.5 z" fill={SUPPORTS_COLOR} />
            </marker>
            <marker id="arrow-contradicts" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0.5 L 8 4 L 0 7.5 z" fill={CONTRADICTS_COLOR} />
            </marker>
          </defs>

          {/* Chapter → Entity MENTIONS: hidden at rest (they'd carpet the
              board); revealed only around the focused node. */}
          {level >= 1 &&
            chapterMentions.map((e) => {
              const chapter = chapterCardById.get(e.source)
              const chip = entityChipById.get(e.target)
              if (!chapter || !chip) return null
              const highlighted = activeId === e.source || activeId === e.target
              if (!highlighted && focusSet) return null
              const cx = center(chapter).x
              const cy = chapter.y
              const ex = center(chip).x
              const ey = chip.y + chip.h
              const color = typeColor(nodeById.get(e.target)?.node_type ?? "")
              return (
                <path
                  key={`mention-${e.ref_id}`}
                  d={`M ${ex} ${ey} C ${ex} ${(cy + ey) / 2}, ${cx} ${(cy + ey) / 2}, ${cx} ${cy}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={highlighted ? 1.8 : 1}
                  opacity={highlighted ? 0.95 : 0.05}
                />
              )
            })}
          {/* Show → Episode */}
          {layout.show && episode && (
            <line
              x1={layout.show.x + layout.show.w}
              y1={center(layout.show).y}
              x2={episode.x}
              y2={center(layout.show).y}
              stroke={EDGE_COLOR}
              strokeWidth={1}
            />
          )}

          {/* Clips → Episode (curved drops) */}
          {episode &&
            layout.clips.map(({ card }) => {
              const c = center(card)
              const highlighted = activeId === card.id
              return (
                <path
                  key={card.id}
                  d={`M ${c.x} ${card.y + card.h} C ${c.x} ${card.y + card.h + 60}, ${episodeCenter.x} ${episode.y - 60}, ${episodeCenter.x} ${episode.y}`}
                  fill="none"
                  stroke={highlighted ? EDGE_ACTIVE : EDGE_COLOR}
                  strokeWidth={highlighted ? 1.8 : 1.2}
                  strokeDasharray="4 3"
                />
              )
            })}

          {/* Episode → chapter bus */}
          {episode && layout.chapters.length > 0 && (
            <g stroke={EDGE_COLOR} strokeWidth={1.2} fill="none">
              <line
                x1={episodeCenter.x}
                y1={episode.y + episode.h}
                x2={episodeCenter.x}
                y2={layout.chapterBusY}
              />
              <line
                x1={center(layout.chapters[0].card).x}
                y1={layout.chapterBusY}
                x2={center(layout.chapters[layout.chapters.length - 1].card).x}
                y2={layout.chapterBusY}
              />
              {layout.chapters.map(({ card }) => (
                <line
                  key={card.id}
                  x1={center(card).x}
                  y1={layout.chapterBusY}
                  x2={center(card).x}
                  y2={card.y}
                  stroke={activeId === card.id ? EDGE_ACTIVE : undefined}
                  strokeWidth={activeId === card.id ? 1.8 : 1.2}
                />
              ))}
              {/* sequence chevrons between chapters */}
              {layout.chapters.slice(0, -1).map(({ card }, i) => {
                const next = layout.chapters[i + 1].card
                const mx = (card.x + card.w + next.x) / 2
                const my = card.y + card.h / 2
                return (
                  <path
                    key={`chev-${card.id}`}
                    d={`M ${mx - 3} ${my - 5} L ${mx + 3} ${my} L ${mx - 3} ${my + 5}`}
                    stroke={EDGE_LABEL}
                    strokeWidth={1.4}
                  />
                )
              })}
            </g>
          )}

          {/* Claims → their chapter (short drops below the strip) */}
          {level >= 1 &&
            layout.claims.map(({ card, chapterId }) => {
              const chapterCard = layout.chapters.find((c) => c.card.id === chapterId)?.card
              if (!chapterCard) return null
              const highlighted = activeId === card.id || activeId === chapterId
              return (
                <line
                  key={`claim-edge-${card.id}`}
                  x1={center(card).x}
                  y1={chapterCard.y + chapterCard.h}
                  x2={center(card).x}
                  y2={card.y}
                  stroke={highlighted ? typeColor("Claim") : EDGE_COLOR}
                  strokeWidth={highlighted ? 1.6 : 1}
                  strokeDasharray="3 3"
                />
              )
            })}

          {/* Claim ↔ Claim: SUPPORTS (teal) / CONTRADICTS (red). Arcs nest by
              span — dip grows with distance so long relations arch over short
              ones (arc-diagram style) instead of tangling. */}
          {level >= 1 &&
            [...claimRelations.supports.map((e) => ({ e, color: SUPPORTS_COLOR, marker: "arrow-supports" })),
             ...claimRelations.contradicts.map((e) => ({ e, color: CONTRADICTS_COLOR, marker: "arrow-contradicts" })),
            ].map(({ e, color, marker }) => {
              const a = claimCardById.get(e.source)
              const b = claimCardById.get(e.target)
              if (!a || !b) return null
              const highlighted = activeId === e.source || activeId === e.target
              if (!showRelations && !highlighted) return null
              const dim = showRelations && activeId != null && claimCardById.has(activeId) && !highlighted
              const ax = center(a).x
              const bx = center(b).x
              const ay = a.y + a.h
              const by = b.y + b.h
              const dip = Math.min(36 + Math.abs(bx - ax) * 0.22, 210)
              const midX = (ax + bx) / 2
              const midY = Math.max(ay, by) + dip * 0.6
              return (
                <g key={`rel-${e.ref_id}`} opacity={dim ? 0.1 : highlighted ? 1 : 0.38}>
                  <path
                    d={`M ${ax} ${ay} C ${ax} ${ay + dip}, ${bx} ${by + dip}, ${bx} ${by}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={highlighted ? 1.8 : 1}
                    markerEnd={`url(#${marker})`}
                  />
                  {highlighted && (
                    <text
                      x={midX}
                      y={midY}
                      textAnchor="middle"
                      fontSize={9}
                      fontFamily="monospace"
                      fill={color}
                      className="uppercase"
                    >
                      {e.edge_type}
                    </text>
                  )}
                </g>
              )
            })}

          {/* MADE_CLAIM: active claim → its author chip in the Person frame */}
          {activeId &&
            claimCardById.has(activeId) &&
            hostChip &&
            claimRelations.madeBy
              .filter((e) => e.target === activeId || e.source === activeId)
              .map((e) => {
                const claimCard = claimCardById.get(e.target) ?? claimCardById.get(e.source)
                if (!claimCard) return null
                const cc = center(claimCard)
                const hc = center(hostChip)
                return (
                  <g key={`made-${e.ref_id}`}>
                    <path
                      d={`M ${cc.x} ${cc.y} C ${(cc.x + hc.x) / 2} ${cc.y}, ${(cc.x + hc.x) / 2} ${hc.y}, ${hc.x} ${hc.y}`}
                      fill="none"
                      stroke={typeColor("Person")}
                      strokeWidth={1.4}
                      strokeDasharray="5 3"
                    />
                    <text
                      x={(cc.x + hc.x) / 2}
                      y={(cc.y + hc.y) / 2 - 8}
                      textAnchor="middle"
                      fontSize={9}
                      fontFamily="monospace"
                      fill={typeColor("Person")}
                      className="uppercase"
                    >
                      made claim
                    </text>
                  </g>
                )
              })}

          {/* Active entity chip → Episode (its episode-level MENTIONS edge) */}
          {activeId &&
            episode &&
            entityChipById.has(activeId) &&
            (() => {
              const chip = entityChipById.get(activeId)!
              const cc = center(chip)
              return (
                <line
                  x1={cc.x}
                  y1={chip.y}
                  x2={episodeCenter.x}
                  y2={episode.y + episode.h}
                  stroke={typeColor(nodeById.get(activeId)?.node_type ?? "")}
                  strokeWidth={1.4}
                  strokeDasharray="5 3"
                  opacity={0.8}
                />
              )
            })()}
        </svg>

        {/* ─── Episode card ─── */}
        {episode && episodeNode && (
          <BoardCard
            card={episode}
            type="Episode"
            {...cardState(episode.id)}
            glow
            onSelect={select}
            onHover={onHover}
          >
            {mediaUrlOf(episodeNode) && (
              <div
                className={`relative -ml-3.5 -mr-2.5 -mt-2.5 mb-2 overflow-hidden rounded-t-lg ${
                  level === 2 ? "h-24" : "h-[74px]"
                }`}
              >                <video
                  src={mediaUrlOf(episodeNode)!}
                  muted
                  playsInline
                  preload="metadata"
                  className="pointer-events-none h-full w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[oklch(0.17_0.02_260)] via-transparent to-black/25" />
              </div>
            )}
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-foreground/60">
              {String(episodeNode.properties.show_title ?? "Episode")}
            </div>
            <div className="mt-1 text-[13px] font-medium leading-snug text-card-foreground">
              {nodeLabel(episodeNode)}
            </div>
            <div className="mt-1 font-mono text-[10px] text-primary">
              {formatMs((Number(episodeNode.properties.duration) || 0) * 1000)} ·{" "}
              {layout.chapters.length} chapters · {layout.clips.length} clips
            </div>
            {level === 2 && (
              <p className="mt-2 text-[10px] leading-relaxed text-foreground/70 line-clamp-4">
                {String(episodeNode.properties.summary ?? "")}
              </p>
            )}
          </BoardCard>
        )}

        {/* ─── Show card ─── */}
        {layout.show && (
          <BoardCard
            card={layout.show}
            type="Show"
            {...cardState(layout.show.id)}
            onSelect={select}
            onHover={onHover}
          >
            <div className="text-[11px] font-medium text-card-foreground truncate">
              {nodeLabel(nodeById.get(layout.show.id)!)}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-widest text-foreground/50">
              show
            </div>
          </BoardCard>
        )}

        {/* ─── Clip cards ─── */}
        {layout.clips.map(({ node, card, ms }) => {
          const media = mediaUrlOf(node)
          return (
            <BoardCard
              key={card.id}
              card={card}
              type="Clip"
              {...cardState(card.id)}
              onSelect={select}
              onHover={onHover}
            >
              <div className="text-[11px] font-medium leading-tight text-card-foreground line-clamp-2">
                {nodeLabel(node)}
              </div>
              <div className="mt-0.5 font-mono text-[9px] text-primary">
                {ms != null ? `at ${formatMs(ms)}` : ""}
              </div>
              {level === 2 && media && <MediaThumb src={media} className="mt-1 h-12 w-full" />}
              {level === 2 && (
                <p className="mt-1 text-[10px] leading-snug text-foreground/70 line-clamp-2">
                  {String(node.properties.description ?? "")}
                </p>
              )}
            </BoardCard>
          )
        })}

        {/* ─── Chapter strip ─── */}
        {layout.chapters.map(({ info, card }) => (
          <BoardCard
            key={card.id}
            card={card}
            type="Chapter"
            {...cardState(card.id)}
            onSelect={select}
            onHover={onHover}
          >
            <div className="flex items-center gap-1.5">
              <span className="rounded bg-[#3a86ff]/15 px-1 py-px font-mono text-[9px] font-semibold text-[#3a86ff]">
                {String(info.index).padStart(2, "0")}
              </span>
              <span className="font-mono text-[9px] text-primary/80">
                {formatMs(info.startMs)}–{formatMs(info.endMs)}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] font-medium leading-tight text-card-foreground line-clamp-2">
              {nodeLabel(info.node)}
            </div>
            {(claimCountByChapter.get(card.id) ?? 0) > 0 && (
              <div className="mt-0.5 font-mono text-[8px] uppercase tracking-wider text-[#ffd166]">
                {claimCountByChapter.get(card.id)} claims ↓
              </div>
            )}
            {level === 2 && (
              <p className="mt-1 text-[10px] leading-snug text-foreground/65 line-clamp-2">
                {truncateLabel(String(info.node.properties.description ?? ""), 90)}
              </p>
            )}
          </BoardCard>
        ))}

        {/* ─── Claim cards (under their chapter) ─── */}
        {level >= 1 &&
          layout.claims.map(({ node, card }) => {
            const st = cardState(card.id)
            const p = node.properties
            const text =
              (typeof p.claim_text === "string" && p.claim_text) || nodeLabel(node)
            const speaker =
              typeof p.speaker_name === "string" && p.speaker_name ? p.speaker_name : null
            const tri =
              level === 2 &&
              typeof p.triplicate_subject === "string" &&
              p.triplicate_subject &&
              typeof p.triplicate_predicate === "string" &&
              p.triplicate_predicate &&
              typeof p.triplicate_object === "string" &&
              p.triplicate_object
                ? { s: p.triplicate_subject, pr: p.triplicate_predicate, o: p.triplicate_object }
                : null
            const rel = claimRelCounts.get(card.id) ?? { sup: 0, con: 0 }
            return (
              <button
                key={card.id}
                className={`absolute flex gap-2 rounded-lg border px-2 py-1.5 text-left backdrop-blur-md transition-all duration-200 ${
                  st.selected
                    ? "border-[#ffd166] bg-[#ffd166]/15 text-card-foreground"
                    : st.active
                      ? "border-[#ffd166]/70 bg-[oklch(0.28_0.03_260)] text-card-foreground"
                      : st.halo
                        ? "border-[#ffd166]/60 bg-[oklch(0.24_0.03_80)] text-card-foreground shadow-[0_0_14px_oklch(0.8_0.15_90/0.3)]"
                        : "border-[#ffd166]/25 bg-gradient-to-b from-[#ffd166]/[0.09] to-[#ffd166]/[0.03] text-foreground/85 hover:border-[#ffd166]/60 hover:text-card-foreground"
                }`}
                style={{ left: card.x, top: card.y, width: card.w, height: card.h, opacity: st.dim ? 0.2 : 1 }}
                onClick={(e) => {
                  e.stopPropagation()
                  select(card.id)
                }}
                onMouseEnter={() => onHover(card.id)}
                onMouseLeave={() => onHover(null)}
              >
                <span className="w-[2px] shrink-0 self-stretch rounded-full bg-[#ffd166]/80" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="line-clamp-2 text-[10px] leading-snug">{text}</span>
                  {tri && (
                    <span className="mt-1 line-clamp-3 rounded border border-[#ffd166]/15 bg-black/30 px-1.5 py-1 font-mono text-[8px] leading-snug text-foreground/60">
                      <span className="text-foreground/85">{tri.s}</span>
                      <span className="text-[#ffd166]/80"> {tri.pr} </span>
                      <span className="text-foreground/85">{tri.o}</span>
                    </span>
                  )}
                  <span className="mt-auto flex items-center gap-2 pt-0.5 font-mono text-[8px]">
                    {speaker ? (
                      <span className="min-w-0 flex-1 truncate text-[#ffd166]/70">— {speaker}</span>
                    ) : (
                      <span className="flex-1" />
                    )}
                    {rel.sup > 0 && (
                      <span className="shrink-0" style={{ color: SUPPORTS_COLOR }}>
                        ▲{rel.sup}
                      </span>
                    )}
                    {rel.con > 0 && (
                      <span className="shrink-0" style={{ color: CONTRADICTS_COLOR }}>
                        ▼{rel.con}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            )
          })}

        {/* ─── Entity chips (anchored above their chapters) ─── */}
        {level >= 1 &&
          layout.entities.map(({ node, card }) => {
            const st = cardState(card.id)
            const isHost = layout.hostId === card.id
            const color = typeColor(node.node_type)
            return (
              <button
                key={card.id}
                className={`absolute flex items-center gap-1.5 rounded-full border px-2.5 text-left font-mono text-[10px] backdrop-blur-md transition-all duration-200 ${
                  st.selected
                    ? "border-primary bg-primary/20 text-card-foreground"
                    : st.active
                      ? "border-primary/70 bg-[oklch(0.28_0.03_260)] text-card-foreground"
                      : st.halo
                        ? "border-primary/50 bg-[oklch(0.25_0.025_260)] text-card-foreground shadow-[0_0_14px_oklch(0.72_0.14_200/0.25)]"
                        : "text-foreground/85 hover:-translate-y-0.5 hover:text-card-foreground"
                }`}
                style={{
                  left: card.x,
                  top: card.y,
                  width: card.w,
                  height: card.h,
                  opacity: st.dim ? 0.2 : 1,
                  // Default state: glass pill tinted with the entity's type color
                  ...(!st.selected && !st.active && !st.halo
                    ? { borderColor: `${color}55`, backgroundColor: `${color}14` }
                    : {}),
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  select(card.id)
                }}
                onMouseEnter={() => onHover(card.id)}
                onMouseLeave={() => onHover(null)}
              >
                {node.node_type === "Person" ? (
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold"
                    style={{ backgroundColor: `${color}33`, color }}
                  >
                    {initials(nodeLabel(node))}
                  </span>
                ) : (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                )}
                <span className="truncate">{truncateLabel(nodeLabel(node), 18)}</span>
                {isHost && (
                  <span className="ml-auto shrink-0 font-mono text-[8px] uppercase text-amber-300">
                    host
                  </span>
                )}
              </button>
            )
          })}
      </div>

      {/* Cursor-following hover card (screen space, outside the zoom world) */}
      {hoveredId && tipPos && nodeById.has(hoveredId) && (
        <HoverTip id={hoveredId} x={tipPos.x} y={tipPos.y} />
      )}
    </div>
  )
}

/** Rich hover card: full text for the node plus, for claims, the web of
 *  supports/contradicts relations with names — so the arcs get context. */
function HoverTip({ id, x, y }: { id: string; x: number; y: number }) {
  const node = nodeById.get(id)
  if (!node) return null
  const p = node.properties
  const body =
    (typeof p.claim_text === "string" && p.claim_text) ||
    (typeof p.description === "string" && p.description) ||
    (typeof p.summary === "string" && p.summary) ||
    null
  const speaker = typeof p.speaker_name === "string" ? p.speaker_name : null
  const media = mediaUrlOf(node)

  const rel = getClaimRelations()
  const names = (edges: { source: string; target: string }[], pick: "source" | "target") =>
    edges
      .filter((e) => (pick === "target" ? e.source === id : e.target === id))
      .map((e) => truncateLabel(nodeLabel(nodeById.get(pick === "target" ? e.target : e.source)!), 32))
  const supports = names(rel.supports, "target")
  const supportedBy = names(rel.supports, "source")
  const contradicts = names(rel.contradicts, "target")
  const contradictedBy = names(rel.contradicts, "source")

  // Chapter↔entity mention context, both directions.
  const mentions = getChapterMentions()
  const mentionsEntities = names(mentions, "target") // hovering a chapter
  const chapters = getChapters()
  const mentionedIn = mentions
    .filter((e) => e.target === id)
    .map((e) => {
      const ch = chapters.find((c) => c.node.ref_id === e.source)
      return ch ? `#${ch.index} ${truncateLabel(nodeLabel(ch.node), 24)}` : null
    })
    .filter((s): s is string => s != null)

  const W = 300
  const flipX = x > window.innerWidth - W - 40
  const flipY = y > window.innerHeight - (media ? 420 : 260)

  return (
    <div
      className="pointer-events-none fixed z-40 rounded-md border border-border bg-card/95 p-3 shadow-2xl backdrop-blur"
      style={{
        width: W,
        left: flipX ? x - W - 14 : x + 14,
        top: flipY ? y - (media ? 360 : 200) : y + 14,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: typeColor(node.node_type) }} />
        <span className="font-mono text-[8px] uppercase tracking-widest text-foreground/60">
          {node.node_type}
        </span>
        {speaker && <span className="ml-auto font-mono text-[9px] text-foreground/50">— {speaker}</span>}
      </div>
      <div className="mt-1 text-[11px] font-medium leading-snug text-card-foreground">
        {nodeLabel(node)}
      </div>
      {media && <MediaThumb src={media} className="mt-2 h-28 w-full" />}
      {body && body !== nodeLabel(node) && (
        <p className="mt-1 text-[10px] leading-snug text-foreground/65 line-clamp-3">{body}</p>
      )}
      {(supports.length > 0 || supportedBy.length > 0 || contradicts.length > 0 || contradictedBy.length > 0 || mentionsEntities.length > 0 || mentionedIn.length > 0) && (
        <div className="mt-2 flex flex-col gap-1 border-t border-border/60 pt-1.5 font-mono text-[9px] leading-snug">
          {supports.length > 0 && <RelationRow color={SUPPORTS_COLOR} label="supports" items={supports} />}
          {supportedBy.length > 0 && <RelationRow color={SUPPORTS_COLOR} label="supported by" items={supportedBy} />}
          {contradicts.length > 0 && <RelationRow color={CONTRADICTS_COLOR} label="contradicts" items={contradicts} />}
          {contradictedBy.length > 0 && <RelationRow color={CONTRADICTS_COLOR} label="contradicted by" items={contradictedBy} />}
          {mentionsEntities.length > 0 && <RelationRow color={EDGE_LABEL} label="mentions" items={mentionsEntities} />}
          {mentionedIn.length > 0 && <RelationRow color={EDGE_LABEL} label="mentioned in" items={mentionedIn} />}
        </div>
      )}
    </div>
  )
}

function RelationRow({ color, label, items }: { color: string; label: string; items: string[] }) {
  return (
    <div className="flex gap-1.5">
      <span className="shrink-0 uppercase tracking-wider" style={{ color }}>
        {label}
      </span>
      <span className="text-foreground/70">{items.join(" · ")}</span>
    </div>
  )
}

interface BoardCardProps {
  card: CardPlacement
  type: string
  selected: boolean
  active: boolean
  /** Faded — outside the focused node's web. */
  dim?: boolean
  /** In the focused node's web (but not the focus itself). */
  halo?: boolean
  glow?: boolean
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  children: React.ReactNode
}

function BoardCard({
  card,
  type,
  selected,
  active,
  dim,
  halo,
  glow,
  onSelect,
  onHover,
  children,
}: BoardCardProps) {
  return (
    <button
      className={`group absolute rounded-lg border p-2.5 pl-3.5 text-left transition-all duration-200 backdrop-blur-md bg-[linear-gradient(155deg,oklch(0.24_0.03_260)_0%,oklch(0.15_0.018_260)_100%)] shadow-[0_10px_28px_oklch(0_0_0/0.4)] ${
        selected
          ? "border-primary shadow-[0_0_28px_oklch(0.72_0.14_200/0.4)]"
          : active
            ? "border-primary/70"
            : halo
              ? "border-primary/50 shadow-[0_0_18px_oklch(0.72_0.14_200/0.28)]"
              : "border-[oklch(0.38_0.03_260)] hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-[0_14px_32px_oklch(0_0_0/0.5)]"
      } ${glow ? "shadow-[0_0_48px_oklch(0.72_0.14_200/0.2)]" : ""}`}
      style={{ left: card.x, top: card.y, width: card.w, height: card.h, opacity: dim ? 0.2 : 1 }}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(card.id)
      }}
      onMouseEnter={() => onHover(card.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Type accent bar — color-codes the card's left edge */}
      <span
        className="pointer-events-none absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-full opacity-80"
        style={{ backgroundColor: typeColor(type) }}
      />
      <span className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/50 px-1.5 py-0.5 backdrop-blur-sm">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: typeColor(type) }} />
        <span className="font-mono text-[8px] uppercase tracking-widest text-foreground/60">
          {type}
        </span>
      </span>
      <span className="pointer-events-none block h-full overflow-hidden">{children}</span>
    </button>
  )
}
