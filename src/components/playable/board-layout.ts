import {
  episodeNode,
  showNode,
  getChapters,
  getClips,
  getEntitiesByType,
  getHost,
  getClaimsByChapter,
  getChapterMentions,
  parseTimestampMs,
  type ChapterInfo,
  type PlayableNode,
} from "@/lib/playable-mock"

/**
 * Proximity-based "Miro board" layout for the playable explorer.
 * All coordinates are world pixels; the world origin (0,0) is the episode's
 * center.
 *
 * The chapter strip is the temporal backbone. Entity chips (Person, Topic,
 * Organization, Product, Location) are placed in the band above the strip at
 * the barycenter of the chapters that mention them — so position encodes
 * "where in the episode this thing matters" and mention edges stay short.
 */

export interface CardPlacement {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface BoardLayout {
  episode: CardPlacement | null
  show: CardPlacement | null
  clips: { node: PlayableNode; card: CardPlacement; ms: number | null }[]
  chapters: { info: ChapterInfo; card: CardPlacement }[]
  /** Claim chips stacked under their parent chapter card. */
  claims: { node: PlayableNode; card: CardPlacement; chapterId: string }[]
  /** Entity chips anchored above the chapters that mention them. */
  entities: { node: PlayableNode; card: CardPlacement }[]
  hostId: string | null
  /** World bounds for fit-to-view. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  /** Y of the horizontal "bus" line feeding the chapter strip. */
  chapterBusY: number
}

const EPISODE_W = 340
const EPISODE_H = 190
const SHOW_W = 190
const SHOW_H = 64
const CLIP_W = 236
const CLIP_H = 82
const CLIP_GAP = 32
const CLIP_Y = -430
const CHAPTER_W = 196
const CHAPTER_H = 96
const CHAPTER_GAP = 22
const CLAIM_W = CHAPTER_W - 16
const CLAIM_X_INSET = 8
const CLAIM_H = 30
const CLAIM_GAP = 8
const CLAIM_TOP_GAP = 14

const CHIP_W = 150
const CHIP_H = 32
const CHIP_GAP = 10
const ENTITY_BAND_TOP = 96
const ENTITY_ROW_PITCH = 44
const ENTITY_MAX_ROWS = 6
const BUS_GAP = 46 // space between the entity band and the chapter bus

export function computeBoardLayout(): BoardLayout {
  const episode: CardPlacement | null = episodeNode
    ? {
        id: episodeNode.ref_id,
        x: -EPISODE_W / 2,
        y: -EPISODE_H / 2 - 30,
        w: EPISODE_W,
        h: EPISODE_H,
      }
    : null

  const show: CardPlacement | null = showNode
    ? { id: showNode.ref_id, x: -EPISODE_W / 2 - SHOW_W - 70, y: -EPISODE_H / 2 - 30, w: SHOW_W, h: SHOW_H }
    : null

  const clipNodes = getClips()
  const clipsTotal = clipNodes.length * CLIP_W + (clipNodes.length - 1) * CLIP_GAP
  const clips = clipNodes.map((node, i) => ({
    node,
    card: {
      id: node.ref_id,
      x: -clipsTotal / 2 + i * (CLIP_W + CLIP_GAP),
      y: CLIP_Y,
      w: CLIP_W,
      h: CLIP_H,
    },
    ms: parseTimestampMs(node.properties.timestamp),
  }))

  const chapterInfos = getChapters()
  const chaptersTotal = chapterInfos.length * CHAPTER_W + (chapterInfos.length - 1) * CHAPTER_GAP
  const stripMin = -chaptersTotal / 2
  const stripMax = chaptersTotal / 2

  // Chapters are placed AFTER the entity band, whose height depends on how
  // many rows the chips need — so compute entities first, then shift the
  // strip down accordingly (see below).

  // ─── Entity anchors: barycenter of mentioning chapters ─────────────────
  const chapterX = (refId: string): number | null => {
    const i = chapterInfos.findIndex((c) => c.node.ref_id === refId)
    if (i === -1) return null
    return stripMin + i * (CHAPTER_W + CHAPTER_GAP) + CHAPTER_W / 2
  }
  const xsByEntity = new Map<string, number[]>()
  for (const e of getChapterMentions()) {
    const x = chapterX(e.source)
    if (x == null) continue
    const xs = xsByEntity.get(e.target) ?? []
    xs.push(x)
    xsByEntity.set(e.target, xs)
  }

  const byType = getEntitiesByType()
  const allEntities = [...byType.values()].flat()
  const anchored = allEntities
    .map((node) => {
      const xs = xsByEntity.get(node.ref_id)
      const anchor = xs ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
      return { node, anchor }
    })
    .sort((a, b) => a.anchor - b.anchor)

  // ─── Greedy row packing: first row where the chip doesn't overlap ──────
  const rows: { x: number }[][] = []
  const fits = (row: { x: number }[], x: number) =>
    row.every((c) => x + CHIP_W + CHIP_GAP <= c.x || c.x + CHIP_W + CHIP_GAP <= x)
  const entities: BoardLayout["entities"] = []
  for (const { node, anchor } of anchored) {
    const x = Math.min(Math.max(anchor - CHIP_W / 2, stripMin), stripMax - CHIP_W)
    let rowIdx = rows.findIndex((row) => fits(row, x))
    if (rowIdx === -1 && rows.length < ENTITY_MAX_ROWS) {
      rows.push([])
      rowIdx = rows.length - 1
    }
    if (rowIdx === -1) {
      // Band full — tack onto the shortest row, right of its last chip.
      rowIdx = rows.reduce((min, row, i) => (row.length < rows[min].length ? i : min), 0)
      const last = rows[rowIdx].reduce((max, c) => Math.max(max, c.x), stripMin)
      const fx = Math.min(last + CHIP_W + CHIP_GAP, stripMax - CHIP_W)
      rows[rowIdx].push({ x: fx })
      entities.push({
        node,
        card: { id: node.ref_id, x: fx, y: ENTITY_BAND_TOP + rowIdx * ENTITY_ROW_PITCH, w: CHIP_W, h: CHIP_H },
      })
      continue
    }
    rows[rowIdx].push({ x })
    entities.push({
      node,
      card: { id: node.ref_id, x, y: ENTITY_BAND_TOP + rowIdx * ENTITY_ROW_PITCH, w: CHIP_W, h: CHIP_H },
    })
  }

  const bandBottom = ENTITY_BAND_TOP + Math.max(rows.length, 1) * ENTITY_ROW_PITCH
  const busY = bandBottom + BUS_GAP
  const chapterY = busY + 40

  const chapters = chapterInfos.map((info, i) => ({
    info,
    card: {
      id: info.node.ref_id,
      x: stripMin + i * (CHAPTER_W + CHAPTER_GAP),
      y: chapterY,
      w: CHAPTER_W,
      h: CHAPTER_H,
    },
  }))

  // Claims stack under their parent chapter card, inset from the card's width.
  const claimsByChapter = getClaimsByChapter()
  const claims: BoardLayout["claims"] = []
  for (const { card } of chapters) {
    const chapterClaims = claimsByChapter.get(card.id) ?? []
    chapterClaims.forEach((node, i) => {
      claims.push({
        node,
        chapterId: card.id,
        card: {
          id: node.ref_id,
          x: card.x + CLAIM_X_INSET,
          y: card.y + card.h + CLAIM_TOP_GAP + i * (CLAIM_H + CLAIM_GAP),
          w: CLAIM_W,
          h: CLAIM_H,
        },
      })
    })
  }

  const hostId = getHost()?.ref_id ?? null

  const all = [
    ...(episode ? [episode] : []),
    ...(show ? [show] : []),
    ...clips.map((c) => c.card),
    ...chapters.map((c) => c.card),
    ...claims.map((c) => c.card),
    ...entities.map((c) => c.card),
  ]
  const bounds = {
    minX: Math.min(...all.map((c) => c.x)) - 60,
    minY: Math.min(...all.map((c) => c.y)) - 60,
    maxX: Math.max(...all.map((c) => c.x + c.w)) + 60,
    maxY: Math.max(...all.map((c) => c.y + c.h)) + 60,
  }

  return { episode, show, clips, chapters, claims, entities, hostId, bounds, chapterBusY: busY }
}

/** Center point of a card. */
export function center(c: CardPlacement): { x: number; y: number } {
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 }
}
