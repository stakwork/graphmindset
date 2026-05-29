// Force-directed (Fruchterman-Reingold style) layout for the case board.
// Operates in normalized 2D space — caller maps results into the plane
// perpendicular to the case-board camera direction.
//
// The focal node is anchored at origin; neighbors find positions through
// repulsion (every pair pushes apart) and attraction (edges pull together),
// with iteration cooling. A deterministic RNG seeded by the focal refId
// means re-opening the same node always yields the same layout — no
// shuffling on every entry.

export type Pos2D = { x: number; y: number }

export interface ForceLayoutInput {
  nodes: string[]
  edges: Array<{ a: string; b: string }>
  // Refid to keep pinned at (0, 0). null = no anchor.
  anchorId: string | null
  // Seed string for the RNG — pass the focal refId so layouts are stable.
  seed: string
}

export function computeCaseBoardLayout({
  nodes,
  edges,
  anchorId,
  seed,
}: ForceLayoutInput): Map<string, Pos2D> {
  const n = nodes.length
  const pos = new Map<string, Pos2D>()
  if (n === 0) return pos
  if (n === 1) {
    pos.set(nodes[0], { x: 0, y: 0 })
    return pos
  }

  // Deterministic seeded LCG so re-opens are stable.
  let s = 0
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) | 0
  s = (s >>> 0) || 1
  function rand() {
    s = (s * 1664525 + 1013904223) | 0
    return (s >>> 0) / 0xffffffff
  }

  // Initial layout: focal at origin, neighbors on a small jittered ring.
  // A tight ring start converges faster than pure-random init.
  for (let i = 0; i < n; i++) {
    const id = nodes[i]
    if (id === anchorId) {
      pos.set(id, { x: 0, y: 0 })
      continue
    }
    const angle = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.6
    const r = 1.1 + rand() * 0.4
    pos.set(id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r })
  }

  const k = 1.5 // ideal edge length in normalized space
  const iterations = 250

  for (let it = 0; it < iterations; it++) {
    const forces = new Map<string, Pos2D>()
    for (const id of nodes) forces.set(id, { x: 0, y: 0 })

    // Repulsion: every pair pushes apart with k² / d magnitude.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos.get(nodes[i])!
        const b = pos.get(nodes[j])!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 0.001
        const f = (k * k) / d
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        const fa = forces.get(nodes[i])!
        const fb = forces.get(nodes[j])!
        fa.x -= fx
        fa.y -= fy
        fb.x += fx
        fb.y += fy
      }
    }

    // Attraction along edges with d² / k magnitude.
    for (const e of edges) {
      const a = pos.get(e.a)
      const b = pos.get(e.b)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.001
      const f = (d * d) / k
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      forces.get(e.a)!.x += fx
      forces.get(e.a)!.y += fy
      forces.get(e.b)!.x -= fx
      forces.get(e.b)!.y -= fy
    }

    // Linear cooling — early iterations move freely, late iterations settle.
    const temp = Math.max(0.05, 1 - it / iterations) * 0.5
    for (const id of nodes) {
      if (id === anchorId) continue
      const p = pos.get(id)!
      const f = forces.get(id)!
      const fmag = Math.sqrt(f.x * f.x + f.y * f.y) || 0.001
      p.x += (f.x / fmag) * Math.min(fmag, temp)
      p.y += (f.y / fmag) * Math.min(fmag, temp)
    }
  }

  // Normalize so the farthest neighbor sits at radius ≈ 1. The caller
  // multiplies by world units to scale the whole board.
  let maxR = 0
  for (const id of nodes) {
    if (id === anchorId) continue
    const p = pos.get(id)!
    const r = Math.sqrt(p.x * p.x + p.y * p.y)
    if (r > maxR) maxR = r
  }
  if (maxR > 0) {
    for (const id of nodes) {
      if (id === anchorId) continue
      const p = pos.get(id)!
      p.x /= maxR
      p.y /= maxR
    }
  }

  return pos
}
