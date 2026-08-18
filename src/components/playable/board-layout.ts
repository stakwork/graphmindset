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
  type BoardNode,
} from "@/lib/board-dataset"

/**
 * Proximity-based "Miro board" layout for the playable explorer.
 * All coordinates are world pixels; the world origin (0,0) is the episode's
 * center.
 *
 * The chapter strip is the temporal backbone. Entity chips (Person, Topic,
 * Organization, Product, Location) are placed in the band above the strip at
 * the barycenter of the chapters that mention them — so position encodes
 * "where in the episode this thing matters" and mention edges stay short.
 * The band is sized independently of the strip: on a short episode, where the
 * anchors all collapse onto one x and encode nothing, the chips fall back to a
 * centered grid.
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
  clips: { node: BoardNode; card: CardPlacement; ms: number | null }[]
  chapters: { info: ChapterInfo; card: CardPlacement }[]
  /** Claim cards stacked under their parent chapter card. */
  claims: { node: BoardNode; card: CardPlacement; chapterId: string }[]
  /** Entity chips anchored above the chapters that mention them. */
  entities: { node: BoardNode; card: CardPlacement }[]
  hostId: string | null
  /** World bounds for fit-to-view. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  /** Y of the horizontal "bus" line feeding the chapter strip. */
  chapterBusY: number
}

const EPISODE_W = 340
const EPISODE_H = 190
/** Extra height the episode card gets at detail zoom (media summary fits). */
const EPISODE_DETAIL_GROW = 70
const SHOW_W = 190
const SHOW_H = 64
const CLIP_W = 236
const CLIP_H = 82
/** Extra height clips with media get at detail zoom (video preview fits). */
const CLIP_DETAIL_GROW = 60
const CLIP_GAP = 32
const CLIP_Y = -430
const CHAPTER_W = 196
const CHAPTER_H = 96
const CHAPTER_GAP = 22
const CLAIM_W = CHAPTER_W - 12
const CLAIM_X_INSET = 6
/** Claims are two-line cards (claim text + speaker/relation row), not chips. */
const CLAIM_H = 58
/** Extra height a claim card gets at detail zoom when it carries a
 *  triplicate (subject–predicate–object) worth showing on the card. */
const CLAIM_DETAIL_GROW = 46

function hasTriplicate(node: BoardNode): boolean {
  const p = node.properties
  return (
    typeof p.triplicate_subject === "string" &&
    p.triplicate_subject.length > 0 &&
    typeof p.triplicate_predicate === "string" &&
    p.triplicate_predicate.length > 0 &&
    typeof p.triplicate_object === "string" &&
    p.triplicate_object.length > 0
  )
}
const CLAIM_GAP = 8
const CLAIM_TOP_GAP = 14

const CHIP_W = 150
const CHIP_H = 32
const CHIP_GAP = 10
const BAND_GAP = 31 // space between the episode card bottom and the entity band
const ENTITY_ROW_PITCH = 44
const ENTITY_MAX_ROWS = 6
/** Widest the band goes when chips are laid out as a grid — keeps a short
 *  episode's band in proportion with the episode card above it. */
const ENTITY_MAX_COLS = 4
const BUS_GAP = 46 // space between the entity band and the chapter bus

function hasMedia(node: BoardNode): boolean {
  return typeof node.properties.media_url === "string" && node.properties.media_url.length > 0
}

/**
 * `detail` mirrors the board's semantic zoom: at detail level the episode and
 * media-bearing clip cards are taller, and every row below them (entity band,
 * chapter bus, strip, claims) shifts down accordingly — positions always
 * derive from actual card heights, so cards can never overlap.
 */
export function computeBoardLayout(detail = false): BoardLayout {
  const episodeH = detail ? EPISODE_H + EPISODE_DETAIL_GROW : EPISODE_H
  const episode: CardPlacement | null = episodeNode
    ? {
        id: episodeNode.ref_id,
        x: -EPISODE_W / 2,
        y: -EPISODE_H / 2 - 30,
        w: EPISODE_W,
        h: episodeH,
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
      h: detail && hasMedia(node) ? CLIP_H + CLIP_DETAIL_GROW : CLIP_H,
    },
    ms: parseTimestampMs(node.properties.timestamp),
  }))

  const chapterInfos = getChapters()
  const chaptersTotal = chapterInfos.length * CHAPTER_W + (chapterInfos.length - 1) * CHAPTER_GAP
  const stripMin = -chaptersTotal / 2

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

  // The band hangs below the episode card — its top derives from the card's
  // actual (possibly detail-grown) bottom, so the two never collide.
  const entityBandTop = episode ? episode.y + episode.h + BAND_GAP : 96

  // ─── Entity band geometry ─────────────────────────────────────────────
  // Anchoring encodes "where in the episode this thing matters" only when the
  // anchors actually differ. With a single chapter — or no mention edges —
  // every anchor collapses onto the same x and the axis means nothing, so lay
  // the chips out as a centered grid instead of pretending it's temporal.
  const anchors = anchored.map((a) => a.anchor)
  const anchorSpread = anchors.length ? Math.max(...anchors) - Math.min(...anchors) : 0
  const degenerate = anchorSpread < CHIP_W + CHIP_GAP

  // The band gets its OWN width rather than borrowing the chapter strip's. A
  // short episode has a narrow strip — one chapter is 196px, narrower than a
  // single 150px chip — which would clamp every chip to the same x, leave the
  // row packer unable to ever share a row, and collapse the band into a
  // vertical column.
  const bandCols = Math.max(
    1,
    degenerate ? Math.min(anchored.length, ENTITY_MAX_COLS) : 0,
    Math.ceil(anchored.length / ENTITY_MAX_ROWS)
  )
  const bandW = Math.max(chaptersTotal, EPISODE_W, bandCols * (CHIP_W + CHIP_GAP) - CHIP_GAP)
  const bandMin = -bandW / 2
  const bandMax = bandW / 2

  const entities: BoardLayout["entities"] = []
  let bandRows: number

  if (degenerate) {
    // ─── Degenerate anchors: centered grid ──────────────────────────────
    const perRow = bandCols
    bandRows = Math.ceil(anchored.length / perRow)
    anchored.forEach(({ node }, i) => {
      const row = Math.floor(i / perRow)
      const col = i % perRow
      const inRow = Math.min(perRow, anchored.length - row * perRow)
      const rowW = inRow * CHIP_W + (inRow - 1) * CHIP_GAP
      entities.push({
        node,
        card: {
          id: node.ref_id,
          x: -rowW / 2 + col * (CHIP_W + CHIP_GAP),
          y: entityBandTop + row * ENTITY_ROW_PITCH,
          w: CHIP_W,
          h: CHIP_H,
        },
      })
    })
  } else {
    // ─── Greedy row packing: first row where the chip doesn't overlap ────
    const rows: { x: number }[][] = []
    const fits = (row: { x: number }[], x: number) =>
      row.every((c) => x + CHIP_W + CHIP_GAP <= c.x || c.x + CHIP_W + CHIP_GAP <= x)
    for (const { node, anchor } of anchored) {
      const x = Math.min(Math.max(anchor - CHIP_W / 2, bandMin), bandMax - CHIP_W)
      let rowIdx = rows.findIndex((row) => fits(row, x))
      if (rowIdx === -1 && rows.length < ENTITY_MAX_ROWS) {
        rows.push([])
        rowIdx = rows.length - 1
      }
      if (rowIdx === -1) {
        // Band full — extend the shortest row past its last chip. Never clamp
        // back inside the band: a clamped x lands on top of a chip that is
        // already there, which reads as one pill drawn over another.
        rowIdx = rows.reduce((min, row, i) => (row.length < rows[min].length ? i : min), 0)
        const last = rows[rowIdx].reduce((max, c) => Math.max(max, c.x), bandMin)
        const fx = last + CHIP_W + CHIP_GAP
        rows[rowIdx].push({ x: fx })
        entities.push({
          node,
          card: { id: node.ref_id, x: fx, y: entityBandTop + rowIdx * ENTITY_ROW_PITCH, w: CHIP_W, h: CHIP_H },
        })
        continue
      }
      rows[rowIdx].push({ x })
      entities.push({
        node,
        card: { id: node.ref_id, x, y: entityBandTop + rowIdx * ENTITY_ROW_PITCH, w: CHIP_W, h: CHIP_H },
      })
    }
    bandRows = rows.length
  }

  const bandBottom = entityBandTop + Math.max(bandRows, 1) * ENTITY_ROW_PITCH
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
  // Heights vary (detail zoom grows triplicate-bearing cards), so stack with a
  // running Y instead of a fixed pitch.
  const claimsByChapter = getClaimsByChapter()
  const claims: BoardLayout["claims"] = []
  for (const { card } of chapters) {
    const chapterClaims = claimsByChapter.get(card.id) ?? []
    let claimY = card.y + card.h + CLAIM_TOP_GAP
    for (const node of chapterClaims) {
      const h = detail && hasTriplicate(node) ? CLAIM_H + CLAIM_DETAIL_GROW : CLAIM_H
      claims.push({
        node,
        chapterId: card.id,
        card: { id: node.ref_id, x: card.x + CLAIM_X_INSET, y: claimY, w: CLAIM_W, h },
      })
      claimY += h + CLAIM_GAP
    }
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
