import type { SigEntity } from "./types"

// Radial 1-hop layout. Selected at origin; neighbors evenly spaced on
// concentric rings around it. For low-degree centers everyone fits on a
// single ring; for high-degree centers we add rings so each ring stays
// readable instead of becoming a thin, perimeter-only wreath that forces
// the user to zoom out past the LOD threshold for content cards.
//
// Ring radius is derived from the packing constraint per ring:
//   2πR ≥ 2 · sumR + N · gap → R ≥ (sumR + N·gap/2) / π
// Stable ordering by id so re-layouts (e.g. after a click switches the
// center) don't jitter.
const RING_GAP = 140

// Soft cap on neighbors per ring before we add another concentric ring.
// 12 keeps angular spacing ≥ 30° on each ring, which leaves plenty of room
// for content cards and dashed connector edges between them.
const MAX_PER_RING = 12

export function layoutRing(selected: SigEntity, neighbors: SigEntity[]): void {
  selected.x = 0
  selected.y = 0

  const N = neighbors.length
  if (N === 0) return

  if (N === 1) {
    const c = neighbors[0]
    c.x = selected.r + c.r + RING_GAP
    c.y = 0
    return
  }

  let maxR = 0
  for (const c of neighbors) {
    if (c.r > maxR) maxR = c.r
  }

  // Stable ordering so swapping the center node doesn't reshuffle siblings.
  const ordered = neighbors.slice().sort((a, b) => a.id.localeCompare(b.id))

  const numRings = Math.max(1, Math.ceil(N / MAX_PER_RING))
  const perRing = Math.ceil(N / numRings)

  // Inner ring radius: clears the selected glyph plus a neighbor + gap. For
  // a single-ring layout we also honor the per-ring packing constraint so
  // dense low-N rings (e.g. N=12 small types) still don't collide.
  const innerPack = (perRing * (2 * maxR + RING_GAP)) / (2 * Math.PI)
  const innerR = Math.max(selected.r + maxR + RING_GAP, innerPack)
  const ringSpacing = 2 * maxR + RING_GAP

  for (let k = 0; k < numRings; k++) {
    const start = k * perRing
    const end = Math.min(start + perRing, N)
    const count = end - start
    if (count === 0) continue
    const ringR = innerR + k * ringSpacing
    // Half-step rotation on alternate rings so neighbors don't line up
    // radially with their inner/outer counterparts — keeps connector edges
    // from running on top of each other.
    const phase = -Math.PI / 2 + (k % 2 === 0 ? 0 : Math.PI / count)
    for (let j = start; j < end; j++) {
      const localI = j - start
      const angle = (localI / count) * Math.PI * 2 + phase
      const c = ordered[j]
      c.x = Math.cos(angle) * ringR
      c.y = Math.sin(angle) * ringR
    }
  }
}

export function computeWorldBBox(entities: SigEntity[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const e of entities) {
    if (e.x - e.r < minX) minX = e.x - e.r
    if (e.y - e.r < minY) minY = e.y - e.r
    if (e.x + e.r > maxX) maxX = e.x + e.r
    if (e.y + e.r > maxY) maxY = e.y + e.r
  }
  if (!isFinite(minX)) return { minX: -200, minY: -200, maxX: 200, maxY: 200 }
  return { minX, minY, maxX, maxY }
}
