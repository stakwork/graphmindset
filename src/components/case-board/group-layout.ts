// Radial placement for case-board groups (EVE-style hub & spokes). The focal
// node sits at the origin; each group gets an evenly spaced angular slot on a
// ring around it. Deterministic — seeded by the focal refId so re-opening the
// same node always arranges the groups the same way.

export type Pos2D = { x: number; y: number }

// One case-board group: neighbors of the focal sharing a node_type. `key` is a
// stable id used for layout + connector projection; `edgeLabel` is the dominant
// relationship to the focal, shown on the bundled connector + group header.
export interface CaseGroupDef {
  key: string
  type: string
  memberRefIds: string[]
  edgeLabel: string
}

export interface GroupLayoutInput {
  // Group identifiers, in stable order. One ring slot is produced per key.
  groupKeys: string[]
  // Seed string — pass the focal refId so the layout is stable across re-opens.
  seed: string
  // Ring radius in normalized units (focal at origin). Caller multiplies by
  // world units to scale the whole board. Default 1.
  radius?: number
  // Angle (radians) of the first slot. Default -90° = straight up.
  startAngle?: number
}

export function computeGroupLayout({
  groupKeys,
  seed,
  radius = 1,
  startAngle = -Math.PI / 2,
}: GroupLayoutInput): Map<string, Pos2D> {
  const n = groupKeys.length
  const map = new Map<string, Pos2D>()
  if (n === 0) return map

  // Deterministic seeded LCG for a small organic jitter on each angle.
  let s = 0
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) | 0
  s = (s >>> 0) || 1
  const rand = () => {
    s = (s * 1664525 + 1013904223) | 0
    return (s >>> 0) / 0xffffffff
  }

  // A single group reads best parked above the focal rather than dead-center.
  if (n === 1) {
    map.set(groupKeys[0], {
      x: Math.cos(startAngle) * radius,
      y: Math.sin(startAngle) * radius,
    })
    return map
  }

  for (let i = 0; i < n; i++) {
    const angle = startAngle + (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.12
    map.set(groupKeys[i], {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    })
  }
  return map
}

// Column layout — focal in the center, groups stacked vertically in a left and
// a right column (like the reference board). Positions are in "spread units"
// (caller multiplies by CASE_BOARD_SPREAD): 1.0 ≈ the column offset distance.
// Each group's vertical footprint is estimated from its member count so the
// stack packs tightly without overlap. Members beyond ROW_CAP don't add height
// (the container scrolls / shows "+N more").
export interface ColumnLayoutInput {
  groups: { key: string; memberCount: number }[]
  // Horizontal distance of each column from the focal, in spread units.
  columnX?: number
}

// Tuned against the resting zoom (≈ px-per-spread-unit). Bump ROW/HEADER if
// groups overlap vertically; bump columnX if columns crowd the focal card.
const HEADER_UNITS = 0.1
const ROW_UNITS = 0.085
const GAP_UNITS = 0.12
// The card scrolls internally past this many rows, so its on-screen height —
// and thus its layout slot — is capped here (matches LIST_MAX_HEIGHT).
const VISIBLE_ROWS = 7

export function computeColumnLayout({
  groups,
  columnX = 0.95,
}: ColumnLayoutInput): Map<string, Pos2D> {
  const map = new Map<string, Pos2D>()
  if (groups.length === 0) return map

  // Slot height tracks the visible (capped) row count — tall groups scroll
  // internally rather than pushing the column open.
  const heightOf = (count: number) =>
    HEADER_UNITS + Math.min(count, VISIBLE_ROWS) * ROW_UNITS

  // Greedily balance groups (tallest first) across two columns so neither
  // side runs much longer than the other.
  const sorted = [...groups].sort((a, b) => b.memberCount - a.memberCount)
  const columns: { x: number; items: { key: string; h: number }[]; total: number }[] = [
    { x: columnX, items: [], total: 0 }, // right
    { x: -columnX, items: [], total: 0 }, // left
  ]
  for (const g of sorted) {
    const h = heightOf(g.memberCount)
    const col = columns[0].total <= columns[1].total ? columns[0] : columns[1]
    col.items.push({ key: g.key, h })
    col.total += h + GAP_UNITS
  }

  for (const col of columns) {
    const stackHeight = col.total - GAP_UNITS
    // y axis points up on screen, so start at the top (+half) and walk down.
    let y = stackHeight / 2
    for (const item of col.items) {
      map.set(item.key, { x: col.x, y: y - item.h / 2 })
      y -= item.h + GAP_UNITS
    }
  }
  return map
}

// Balanced 2D packing — items distributed around the focal on all sides
// (top/bottom/left/right) with no overlap, like the reference board.
//
// Collision is RECTANGLE-aware (AABB), not circular. Cards are boxes with very
// different aspect ratios — a Person card with a description is tall, a group
// card is wide and short — and a single collision radius can't represent that,
// so tall cards overlapped their neighbors. Each item carries half-width (hw)
// and half-height (hh) in spread units; overlaps are resolved by the minimum
// translation along the least-penetrated axis.
export interface BalancedItem {
  id: string
  hw: number
  hh: number
}

export interface BalancedLayoutInput {
  items: BalancedItem[]
  // Half-extents of the focal card (items stay outside this box).
  focalHalf: { hw: number; hh: number }
  seed: string
  // Extra breathing room between boxes, in spread units.
  gap?: number
}

// Resolve an AABB overlap between boxes centered at a and b with the given
// half-extents + gap. Returns the push to apply to b (negate for a), or null
// if they don't overlap. Pushes along the axis of least penetration so cards
// slide apart the short way instead of jumping.
function aabbPush(
  ax: number, ay: number, ahw: number, ahh: number,
  bx: number, by: number, bhw: number, bhh: number,
  gap: number,
): { x: number; y: number } | null {
  const dx = bx - ax
  const dy = by - ay
  const ox = ahw + bhw + gap - Math.abs(dx) // x overlap
  const oy = ahh + bhh + gap - Math.abs(dy) // y overlap
  if (ox <= 0 || oy <= 0) return null
  if (ox < oy) {
    const dir = dx === 0 ? 1 : Math.sign(dx)
    return { x: dir * ox, y: 0 }
  }
  const dir = dy === 0 ? 1 : Math.sign(dy)
  return { x: 0, y: dir * oy }
}

export function computeBalancedLayout({
  items,
  focalHalf,
  seed,
  gap = 0.06,
}: BalancedLayoutInput): Map<string, Pos2D> {
  const n = items.length
  const map = new Map<string, Pos2D>()
  if (n === 0) return map

  let s = 0
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) | 0
  s = (s >>> 0) || 1
  const rand = () => {
    s = (s * 1664525 + 1013904223) | 0
    return (s >>> 0) / 0xffffffff
  }

  // Even angular start, seeded radius from each item's diagonal so the first
  // frame already roughly surrounds the focal.
  const pos = items.map((it, i) => {
    const ang = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.2
    const reach =
      Math.max(focalHalf.hw, focalHalf.hh) + Math.max(it.hw, it.hh) + gap + 0.1
    return { x: Math.cos(ang) * reach, y: Math.sin(ang) * reach }
  })

  for (let iter = 0; iter < 500; iter++) {
    // Gentle inward pull so items hug the focal instead of drifting out.
    for (const p of pos) {
      p.x *= 0.985
      p.y *= 0.985
    }
    // Keep every item's box clear of the focal box (only the item moves).
    for (let i = 0; i < n; i++) {
      const p = pos[i]
      const push = aabbPush(
        0, 0, focalHalf.hw, focalHalf.hh,
        p.x, p.y, items[i].hw, items[i].hh,
        gap,
      )
      if (push) {
        p.x += push.x
        p.y += push.y
      }
    }
    // Separate overlapping item pairs (split the push between both).
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos[i]
        const b = pos[j]
        const push = aabbPush(
          a.x, a.y, items[i].hw, items[i].hh,
          b.x, b.y, items[j].hw, items[j].hh,
          gap,
        )
        if (push) {
          a.x -= push.x / 2
          a.y -= push.y / 2
          b.x += push.x / 2
          b.y += push.y / 2
        }
      }
    }
  }

  for (let i = 0; i < n; i++) map.set(items[i].id, pos[i])
  return map
}
