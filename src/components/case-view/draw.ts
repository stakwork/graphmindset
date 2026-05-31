import type { SigEntity } from "./types"
import { C, FONT_MONO, LOD } from "./constants"
import { hexToRGB } from "./camera"
import {
  pickString,
  DISPLAY_KEY_FALLBACKS,
  resolveNodeThumbnail,
} from "@/lib/node-display"

// Module-level image cache. Each URL maps to an HTMLImageElement that may or
// may not be loaded yet — `complete && naturalWidth > 0` is the readiness
// check. The render loop runs every frame, so an image that arrives between
// frames will simply appear on the next one (no manual invalidation needed).
const imageCache = new Map<string, HTMLImageElement>()

function getCachedImage(url: string | undefined): HTMLImageElement | null {
  if (!url) return null
  let img = imageCache.get(url)
  if (!img) {
    img = new Image()
    // Intentionally NOT setting crossOrigin — most backends don't send CORS
    // headers and we'd rather paint the image into a tainted canvas than
    // fail to load it. We never need to read pixels back.
    img.src = url
    imageCache.set(url, img)
  }
  if (img.complete && img.naturalWidth > 0) return img
  return null
}

export function clear(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
}

export function drawDot(
  ctx: CanvasRenderingContext2D,
  sc: { x: number; y: number },
  color: string,
  dim: number,
) {
  ctx.fillStyle = `rgba(${hexToRGB(color)}, ${0.6 * dim})`
  ctx.beginPath()
  ctx.arc(sc.x, sc.y, 2.5, 0, Math.PI * 2)
  ctx.fill()
}

interface LeafOpts {
  selected: boolean
  hover: boolean
  dim: number
  t: number
}

export function drawLeafGlyph(
  ctx: CanvasRenderingContext2D,
  e: SigEntity,
  sc: { x: number; y: number },
  appR: number,
  opts: LeafOpts,
) {
  const { selected, hover, dim, t } = opts

  // High-LOD: render a Peaky Blinders-style content card centered on the
  // node position instead of a circle. The card carries the same chrome
  // (selection ring, hover glow) so transitions between LODs read as the
  // same primitive scaling up.
  if (appR > LOD.CARD_VISIBLE) {
    drawNodeCard(ctx, e, sc, appR, opts)
    return
  }

  const baseColor = selected ? C.selected : e.color
  const rgb = hexToRGB(baseColor)

  const pulse = selected ? 0.55 + 0.45 * Math.sin(t * 0.003) : 0
  const ringR = appR + 6 + pulse * 5

  if (pulse > 0 || hover || selected) {
    const g = ctx.createRadialGradient(sc.x, sc.y, 0, sc.x, sc.y, ringR * 2)
    g.addColorStop(0, `rgba(${rgb}, ${0.28 * (0.5 + pulse) * dim})`)
    g.addColorStop(1, `rgba(${rgb}, 0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(sc.x, sc.y, ringR * 2, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.strokeStyle = `rgba(${rgb}, ${0.5 * dim})`
  ctx.lineWidth = selected ? 2 : 1
  ctx.beginPath()
  ctx.arc(sc.x, sc.y, appR + 4, 0, Math.PI * 2)
  ctx.stroke()

  ctx.save()
  ctx.translate(sc.x, sc.y)
  ctx.fillStyle = `rgba(10, 16, 22, 0.95)`
  ctx.strokeStyle = `rgba(${rgb}, ${0.95 * dim})`
  ctx.lineWidth = selected ? 1.8 : 1.2
  ctx.beginPath()
  ctx.arc(0, 0, appR, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  if (selected) {
    ctx.fillStyle = `rgba(${rgb}, ${0.9 * dim})`
    ctx.beginPath()
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  const showLabel = appR > LOD.LABEL_VISIBLE || hover || selected
  if (showLabel) {
    const labelY = sc.y + appR + 14
    ctx.textAlign = "center"
    ctx.textBaseline = "top"
    ctx.fillStyle = `rgba(215, 230, 234, ${dim * (selected ? 1 : 0.85)})`
    ctx.font = `500 11px ${FONT_MONO}`
    const text = e.name.length > 32 ? e.name.slice(0, 32) + "…" : e.name
    ctx.fillText(text, sc.x, labelY)
    if (appR > LOD.LEAF_DETAIL) {
      ctx.fillStyle = `rgba(120, 180, 190, ${dim * 0.75})`
      ctx.font = `10px ${FONT_MONO}`
      ctx.fillText(e.kind.toUpperCase(), sc.x, labelY + 14)
    }
  }
}

const CARD_INTERNAL_KEYS = new Set([
  "ref_id", "pubkey", "owner_reference_id", "node_type",
  "date_added_to_graph", "status", "project_id",
  "name", "title", "description", "text", "transcript", "summary",
  "media_url", "link", "image_url", "thumbnail", "source_link",
  "mapX", "mapY", "mapZ",
])

function pickCardFields(e: SigEntity, max = 4): { label: string; value: string }[] {
  const props = e.node.properties as Record<string, unknown> | undefined
  if (!props) return []
  const out: { label: string; value: string }[] = []
  for (const key of Object.keys(props)) {
    if (CARD_INTERNAL_KEYS.has(key)) continue
    const v = props[key]
    if (typeof v === "string" && v.length > 0) {
      out.push({ label: key, value: v.length > 48 ? v.slice(0, 48) + "…" : v })
    } else if (typeof v === "number") {
      out.push({ label: key, value: String(v) })
    }
    if (out.length >= max) break
  }
  // Always surface a description preview if present
  if (out.length < max) {
    const desc = pickString(props, "description") ?? pickString(props, "summary")
    if (desc) out.push({ label: "about", value: desc.slice(0, 64) + (desc.length > 64 ? "…" : "") })
  }
  // Fall back: if no fields surfaced, show the title-key name
  if (out.length === 0) {
    for (const key of DISPLAY_KEY_FALLBACKS) {
      const v = props[key]
      if (typeof v === "string" && v.length > 0) {
        out.push({ label: key, value: v.length > 48 ? v.slice(0, 48) + "…" : v })
        break
      }
    }
  }
  return out
}

// Inline content card centered on the node, scaled with appR. Selected gets
// a wider card with a hero image + description; neighbors get a compact one
// with a small thumbnail (or letter avatar when no image is available).
function drawNodeCard(
  ctx: CanvasRenderingContext2D,
  e: SigEntity,
  sc: { x: number; y: number },
  appR: number,
  opts: LeafOpts,
) {
  const { selected, hover, dim, t } = opts
  const accent = selected ? C.selected : e.color
  const rgb = hexToRGB(accent)

  const maxFields = selected ? 5 : 3
  const fields = pickCardFields(e, maxFields)
  const description = selected ? pickDescription(e) : null
  const thumbnailUrl = resolveNodeThumbnail(e.node)
  const thumbnail = getCachedImage(thumbnailUrl)

  const w = selected
    ? Math.max(260, Math.min(appR * 7.5, 440))
    : Math.max(150, Math.min(appR * 5.6, 320))
  const lineH = Math.max(13, Math.min(appR * 0.45, 16))
  const headerH = Math.max(46, Math.min(appR * 1.6, 60))
  const heroH = selected ? Math.max(110, Math.min(appR * 3.2, 160)) : 0
  const descLines = description
    ? wrapText(ctx, description, w - 20, `${Math.max(11, Math.min(appR * 0.42, 12))}px ${FONT_MONO}`, 4)
    : []
  const descH = descLines.length > 0 ? descLines.length * (lineH - 1) + 8 : 0
  const bodyH = Math.max(fields.length * lineH + 14, 12) + heroH + descH
  const h = headerH + bodyH
  const x = sc.x - w / 2
  const y = sc.y - h / 2

  const pulse = selected ? 0.55 + 0.45 * Math.sin(t * 0.003) : 0
  if (pulse > 0 || hover || selected) {
    const gradR = Math.max(w, h) * 0.9
    const g = ctx.createRadialGradient(sc.x, sc.y, 0, sc.x, sc.y, gradR)
    g.addColorStop(0, `rgba(${rgb}, ${0.22 * (0.5 + pulse) * dim})`)
    g.addColorStop(1, `rgba(${rgb}, 0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(sc.x, sc.y, gradR, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.save()
  ctx.fillStyle = `rgba(10, 16, 22, ${0.94 * dim})`
  ctx.strokeStyle = `rgba(${rgb}, ${(selected ? 0.95 : hover ? 0.7 : 0.55) * dim})`
  ctx.lineWidth = selected ? 2 : hover ? 1.4 : 1
  roundRect(ctx, x, y, w, h, 6)
  ctx.fill()
  ctx.stroke()
  ctx.restore()

  const pad = 10
  const pillH = Math.max(16, Math.min(appR * 0.7, 20))
  const pillY = y + 8
  const kindText = e.kind.toUpperCase()
  ctx.font = `600 ${Math.max(9, Math.min(appR * 0.4, 11))}px ${FONT_MONO}`
  const pillW = ctx.measureText(kindText).width + 14
  ctx.fillStyle = `rgba(${rgb}, ${0.18 * dim})`
  ctx.strokeStyle = `rgba(${rgb}, ${0.55 * dim})`
  ctx.lineWidth = 1
  roundRect(ctx, x + pad, pillY, pillW, pillH, pillH / 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = `rgba(${rgb}, ${0.95 * dim})`
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  ctx.fillText(kindText, x + pad + 7, pillY + pillH / 2 + 0.5)

  const avatarR = Math.max(10, Math.min(appR * 0.45, 14))
  const avatarCX = x + w - pad - avatarR
  const avatarCY = pillY + pillH / 2
  if (thumbnail && !selected) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(avatarCX, avatarCY, avatarR, 0, Math.PI * 2)
    ctx.clip()
    drawImageCover(ctx, thumbnail, avatarCX - avatarR, avatarCY - avatarR, avatarR * 2, avatarR * 2)
    ctx.restore()
    ctx.beginPath()
    ctx.arc(avatarCX, avatarCY, avatarR, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${rgb}, ${0.7 * dim})`
    ctx.lineWidth = 1
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(avatarCX, avatarCY, avatarR, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${rgb}, ${0.22 * dim})`
    ctx.fill()
    ctx.strokeStyle = `rgba(${rgb}, ${0.7 * dim})`
    ctx.lineWidth = 1
    ctx.stroke()
    const initial = (e.name || "?").trim().charAt(0).toUpperCase()
    ctx.fillStyle = `rgba(${rgb}, ${0.95 * dim})`
    ctx.font = `700 ${Math.max(10, Math.min(appR * 0.45, 13))}px ${FONT_MONO}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(initial, avatarCX, avatarCY + 0.5)
  }

  const titleY = pillY + pillH + 4
  ctx.fillStyle = `rgba(235, 245, 248, ${(selected ? 1 : 0.95) * dim})`
  const titleSize = selected
    ? Math.max(15, Math.min(appR * 0.7, 19))
    : Math.max(12, Math.min(appR * 0.55, 15))
  ctx.font = `600 ${titleSize}px ${FONT_MONO}`
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  const titleMaxW = w - pad * 2
  ctx.fillText(truncateToWidth(ctx, e.name, titleMaxW), x + pad, titleY)

  ctx.strokeStyle = `rgba(${rgb}, ${0.18 * dim})`
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x + pad, y + headerH)
  ctx.lineTo(x + w - pad, y + headerH)
  ctx.stroke()

  let cy = y + headerH + 6

  if (selected && heroH > 0) {
    const heroX = x + pad
    const heroY = cy
    const heroW = w - pad * 2
    ctx.save()
    roundRect(ctx, heroX, heroY, heroW, heroH, 4)
    ctx.clip()
    if (thumbnail) {
      drawImageCover(ctx, thumbnail, heroX, heroY, heroW, heroH)
    } else {
      const g = ctx.createLinearGradient(heroX, heroY, heroX, heroY + heroH)
      g.addColorStop(0, `rgba(${rgb}, ${0.22 * dim})`)
      g.addColorStop(1, `rgba(${rgb}, ${0.06 * dim})`)
      ctx.fillStyle = g
      ctx.fillRect(heroX, heroY, heroW, heroH)
      ctx.fillStyle = `rgba(${rgb}, ${0.55 * dim})`
      ctx.font = `700 ${Math.min(heroH * 0.55, 64)}px ${FONT_MONO}`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      const initial = (e.name || "?").trim().charAt(0).toUpperCase()
      ctx.fillText(initial, heroX + heroW / 2, heroY + heroH / 2)
    }
    ctx.restore()
    ctx.strokeStyle = `rgba(${rgb}, ${0.35 * dim})`
    ctx.lineWidth = 1
    roundRect(ctx, heroX, heroY, heroW, heroH, 4)
    ctx.stroke()
    cy += heroH + 8
  }

  if (descLines.length > 0) {
    ctx.fillStyle = `rgba(200, 215, 220, ${0.92 * dim})`
    ctx.font = `${Math.max(11, Math.min(appR * 0.42, 12))}px ${FONT_MONO}`
    ctx.textAlign = "left"
    ctx.textBaseline = "top"
    for (const line of descLines) {
      ctx.fillText(line, x + pad, cy)
      cy += lineH - 1
    }
    cy += 6
  }

  const labelW = Math.min(80, w * 0.32)
  const valueX = x + pad + labelW
  const valueMaxW = w - pad - labelW - pad
  ctx.font = `${Math.max(9, Math.min(appR * 0.42, 11))}px ${FONT_MONO}`
  for (const f of fields) {
    ctx.fillStyle = `rgba(120, 180, 190, ${0.72 * dim})`
    ctx.textAlign = "left"
    ctx.fillText(f.label, x + pad, cy)
    ctx.fillStyle = `rgba(215, 230, 234, ${0.95 * dim})`
    ctx.fillText(truncateToWidth(ctx, f.value, valueMaxW), valueX, cy)
    cy += lineH
  }

  if (selected) {
    ctx.fillStyle = `rgba(${rgb}, ${0.9 * dim})`
    ctx.beginPath()
    ctx.arc(x + 6, y + 6, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
}

// Cover-crop: scale the image so it fills the destination rect, cropping
// whichever axis overflows (the CSS `object-fit: cover` equivalent).
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (iw === 0 || ih === 0) return
  const scale = Math.max(dw / iw, dh / ih)
  const sw = dw / scale
  const sh = dh / scale
  const sx = (iw - sw) / 2
  const sy = (ih - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
}

function pickDescription(e: SigEntity): string | null {
  const props = e.node.properties as Record<string, unknown> | undefined
  if (!props) return null
  return (
    pickString(props, "description") ??
    pickString(props, "summary") ??
    pickString(props, "text") ??
    pickString(props, "bio") ??
    null
  )
}

// Greedy word-wrap that honors the canvas's current font. Returns up to
// `maxLines` lines, ellipsising the last one if the source overruns. Sets
// the font on `ctx` because measureText reads from current state.
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  font: string,
  maxLines: number,
): string[] {
  const prev = ctx.font
  ctx.font = font
  const words = text.replace(/\s+/g, " ").trim().split(" ")
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const candidate = line ? line + " " + word : word
    if (ctx.measureText(candidate).width <= maxW) {
      line = candidate
    } else {
      if (line) lines.push(line)
      if (lines.length >= maxLines) break
      line = word
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  // If we ran out of room, ellipsise the last line.
  if (lines.length === maxLines) {
    const remainingIdx = words.indexOf(line.split(" ").pop() || "")
    if (remainingIdx !== -1 && remainingIdx < words.length - 1) {
      let truncated = lines[lines.length - 1]
      while (truncated.length > 0 && ctx.measureText(truncated + "…").width > maxW) {
        truncated = truncated.slice(0, -1)
      }
      lines[lines.length - 1] = truncated + "…"
    }
  }
  ctx.font = prev
  return lines
}

function truncateToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string {
  if (ctx.measureText(text).width <= maxW) return text
  const ellipsis = "…"
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxW) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + ellipsis
}

// Card bounding box in screen space — kept in sync with drawNodeCard so
// hit-tests can use the same rectangle the user actually clicked.
export function getNodeCardBounds(
  e: SigEntity,
  sc: { x: number; y: number },
  appR: number,
): { x: number; y: number; w: number; h: number } {
  const selected = e.isSelected
  const fieldCount = pickCardFields(e, selected ? 5 : 3).length
  const w = selected
    ? Math.max(260, Math.min(appR * 7.5, 440))
    : Math.max(150, Math.min(appR * 5.6, 320))
  const lineH = Math.max(13, Math.min(appR * 0.45, 16))
  const headerH = Math.max(46, Math.min(appR * 1.6, 60))
  const heroH = selected ? Math.max(110, Math.min(appR * 3.2, 160)) : 0
  const hasDesc = selected && pickDescription(e) !== null
  const descH = hasDesc ? 4 * (lineH - 1) + 8 : 0
  const bodyH = Math.max(fieldCount * lineH + 14, 12) + heroH + descH
  const h = headerH + bodyH
  return { x: sc.x - w / 2, y: sc.y - h / 2, w, h }
}

export function drawEdge(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  dim: number,
  label?: string,
) {
  ctx.strokeStyle = `rgba(120, 200, 220, ${0.35 * dim})`
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
  ctx.setLineDash([])

  if (label) {
    const mx = (from.x + to.x) / 2
    const my = (from.y + to.y) / 2
    ctx.fillStyle = `rgba(10, 16, 22, ${0.85 * dim})`
    ctx.font = `9px ${FONT_MONO}`
    const w = ctx.measureText(label).width + 10
    roundRect(ctx, mx - w / 2, my - 7, w, 14, 2)
    ctx.fill()
    ctx.fillStyle = `rgba(120, 200, 220, ${0.9 * dim})`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(label, mx, my)
  }
}
