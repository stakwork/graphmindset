import type { SigEntity } from "./types"

// Radial 1-hop layout. Selected at origin; neighbors evenly spaced around it
// on a ring whose radius is derived from the packing constraint
//   2πR ≥ 2 · sumR + N · gap → R ≥ (sumR + N·gap/2) / π
// so neighbor radii + a configurable gap always fit. Stable ordering by id so
// re-layouts (e.g. after a click switches the center) don't jitter.
const RING_GAP = 80

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
  let sumR = 0
  for (const c of neighbors) {
    if (c.r > maxR) maxR = c.r
    sumR += c.r
  }
  const Rpack = (sumR + (N * RING_GAP) / 2) / Math.PI
  const ringR = Math.max(selected.r + maxR + RING_GAP, Rpack)

  const ordered = neighbors.slice().sort((a, b) => a.id.localeCompare(b.id))
  ordered.forEach((c, i) => {
    const angle = (i / N) * Math.PI * 2 - Math.PI / 2
    c.x = Math.cos(angle) * ringR
    c.y = Math.sin(angle) * ringR
  })
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
