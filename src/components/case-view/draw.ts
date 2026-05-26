import type { SigEntity } from "./types"
import { C, FONT_MONO, LOD } from "./constants"
import { hexToRGB } from "./camera"
import { pickString, DISPLAY_KEY_FALLBACKS } from "@/lib/node-display"

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

  // small inner dot for selected, so the center reads as a target
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

  if (appR > LOD.LEAF_DEEP) {
    drawLeafDeepCard(ctx, e, sc, appR, dim)
  }
}

const CARD_INTERNAL_KEYS = new Set([
  "ref_id", "pubkey", "owner_reference_id", "node_type",
  "date_added_to_graph", "status", "project_id",
  "name", "title", "description", "text", "transcript", "summary",
  "media_url", "link", "image_url", "thumbnail", "source_link",
  "mapX", "mapY", "mapZ",
])

function pickCardFields(e: SigEntity): { label: string; value: string }[] {
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
    if (out.length >= 4) break
  }
  // Always surface a description preview if present
  if (out.length < 4) {
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

function drawLeafDeepCard(
  ctx: CanvasRenderingContext2D,
  e: SigEntity,
  sc: { x: number; y: number },
  appR: number,
  dim: number,
) {
  const fields = pickCardFields(e)
  const w = 220
  const lineH = 14
  const headerH = 38
  const bodyH = Math.max(fields.length * lineH + 10, 10)
  const h = headerH + bodyH
  const x = sc.x + appR + 18
  const y = sc.y - h / 2

  // connector
  ctx.strokeStyle = `rgba(74, 224, 210, ${0.4 * dim})`
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(sc.x + appR + 4, sc.y)
  ctx.lineTo(x, y + h / 2)
  ctx.stroke()

  ctx.fillStyle = C.panel
  ctx.strokeStyle = C.panelBorder
  ctx.lineWidth = 1
  roundRect(ctx, x, y, w, h, 4)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = `rgba(74, 224, 210, ${0.92 * dim})`
  ctx.font = `600 12px ${FONT_MONO}`
  ctx.textAlign = "left"
  ctx.textBaseline = "top"
  ctx.fillText(e.name.slice(0, 26), x + 10, y + 8)

  ctx.fillStyle = `rgba(120, 180, 190, ${0.85 * dim})`
  ctx.font = `10px ${FONT_MONO}`
  ctx.fillText(e.kind.toUpperCase(), x + 10, y + 24)

  let cy = y + headerH
  ctx.font = `10px ${FONT_MONO}`
  for (const f of fields) {
    ctx.fillStyle = `rgba(120, 180, 190, ${0.7 * dim})`
    ctx.fillText(f.label, x + 10, cy)
    ctx.fillStyle = `rgba(215, 230, 234, ${0.92 * dim})`
    ctx.fillText(f.value, x + 80, cy)
    cy += lineH
  }
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
    const text = label
    ctx.font = `9px ${FONT_MONO}`
    const w = ctx.measureText(text).width + 10
    roundRect(ctx, mx - w / 2, my - 7, w, 14, 2)
    ctx.fill()
    ctx.fillStyle = `rgba(120, 200, 220, ${0.9 * dim})`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(text, mx, my)
  }
}
