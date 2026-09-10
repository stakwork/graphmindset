// Minimal d3-force-style simulation used by the Neo4j-look canvas.
// Pure TypeScript, no DOM: nodes carry x/y/vx/vy, optional fx/fy pins.
// Forces per tick: link springs, many-body repulsion, soft gravity to the
// origin, and circle collision. O(n²) — fine for the few hundred nodes a
// search + neighborhood expansion produces.

export interface SimNode {
  x: number
  y: number
  vx: number
  vy: number
  /** Pinned position (drag / precompute anchor). null = free. */
  fx: number | null
  fy: number | null
  /** Collision radius. */
  r: number
  /**
   * Tether point. While set, the node is pulled back toward it every tick
   * regardless of alpha — used to keep the rest of the graph still while one
   * node is dragged. null/undefined = untethered.
   */
  anchorX?: number | null
  anchorY?: number | null
}

export interface SimLink {
  source: number
  target: number
}

export interface ForceConfig {
  linkDistance: number
  charge: number
  chargeMaxDistance: number
  gravity: number
  collidePadding: number
  /** Pull toward a node's anchor per tick (fraction of the offset). */
  anchorStrength: number
  velocityDecay: number
  alphaDecay: number
  alphaMin: number
}

export const DEFAULT_FORCE_CONFIG: ForceConfig = {
  linkDistance: 110,
  charge: -600,
  chargeMaxDistance: 500,
  gravity: 0.04,
  collidePadding: 6,
  anchorStrength: 0.35,
  velocityDecay: 0.4,
  alphaDecay: 0.0228,
  alphaMin: 0.001,
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** d3's phyllotaxis seed: a tight, non-overlapping spiral around the origin. */
export function phyllotaxisPosition(i: number, spacing: number): { x: number; y: number } {
  const radius = spacing * Math.sqrt(0.5 + i)
  const angle = i * GOLDEN_ANGLE
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
}

/** Tiny deterministic jitter so coincident nodes separate (d3 does the same). */
export function jiggle(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return (x - Math.floor(x) - 0.5) * 1e-4
}

export class ForceSimulation<N extends SimNode = SimNode> {
  nodes: N[]
  links: SimLink[]
  alpha = 1
  alphaTarget = 0
  cfg: ForceConfig
  private degree: number[] = []

  constructor(nodes: N[], links: SimLink[], cfg: Partial<ForceConfig> = {}) {
    this.nodes = nodes
    this.links = links
    this.cfg = { ...DEFAULT_FORCE_CONFIG, ...cfg }
    this.recount()
  }

  /** Call after mutating `nodes`/`links` so link bias uses fresh degrees. */
  recount() {
    const deg = new Array<number>(this.nodes.length).fill(0)
    for (const l of this.links) {
      deg[l.source]++
      deg[l.target]++
    }
    this.degree = deg
  }

  get active(): boolean {
    return this.alpha >= this.cfg.alphaMin
  }

  reheat(alpha = 1) {
    this.alpha = Math.max(this.alpha, alpha)
  }

  /** One integration step. Returns true while the simulation is still hot. */
  tick(): boolean {
    const { nodes, links, cfg } = this
    const alpha = this.alpha
    this.alpha += (this.alphaTarget - this.alpha) * cfg.alphaDecay

    // Link springs (d3 forceLink, strength 1/min(degree)).
    for (const l of links) {
      const s = nodes[l.source]
      const t = nodes[l.target]
      if (!s || !t || s === t) continue
      let dx = t.x + t.vx - s.x - s.vx || jiggle(l.source + 1)
      let dy = t.y + t.vy - s.y - s.vy || jiggle(l.target + 7)
      let len = Math.sqrt(dx * dx + dy * dy)
      const strength = 1 / Math.max(1, Math.min(this.degree[l.source], this.degree[l.target]))
      len = ((len - cfg.linkDistance) / len) * alpha * strength
      dx *= len
      dy *= len
      const bias = this.degree[l.source] / (this.degree[l.source] + this.degree[l.target])
      t.vx -= dx * bias
      t.vy -= dy * bias
      s.vx += dx * (1 - bias)
      s.vy += dy * (1 - bias)
    }

    // Many-body repulsion + collision in one pair loop.
    const maxD2 = cfg.chargeMaxDistance * cfg.chargeMaxDistance
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]
        let dx = b.x - a.x || jiggle(i * 31 + j)
        let dy = b.y - a.y || jiggle(j * 17 + i)
        let d2 = dx * dx + dy * dy
        if (d2 < maxD2) {
          const minD = (a.r + b.r) * 0.5
          if (d2 < minD * minD) d2 = minD * minD
          const w = (cfg.charge * alpha) / d2
          a.vx -= dx * w
          a.vy -= dy * w
          b.vx += dx * w
          b.vy += dy * w
        }
        // Collision (positions incl. pending velocity, like d3 forceCollide).
        const cx = b.x + b.vx - a.x - a.vx || dx
        const cy = b.y + b.vy - a.y - a.vy || dy
        const cd2 = cx * cx + cy * cy
        const rr = a.r + b.r + cfg.collidePadding
        if (cd2 < rr * rr) {
          const cd = Math.sqrt(cd2) || 1e-6
          const overlap = ((rr - cd) / cd) * 0.7
          dx = cx * overlap
          dy = cy * overlap
          const ra = b.r * b.r
          const rb = a.r * a.r
          const share = ra / (ra + rb)
          a.vx -= dx * share
          a.vy -= dy * share
          b.vx += dx * (1 - share)
          b.vy += dy * (1 - share)
        }
      }
    }

    // Gravity, anchors + integration.
    for (const n of nodes) {
      n.vx += -n.x * cfg.gravity * alpha
      n.vy += -n.y * cfg.gravity * alpha
      if (n.anchorX != null && n.anchorY != null) {
        n.vx += (n.anchorX - n.x) * cfg.anchorStrength
        n.vy += (n.anchorY - n.y) * cfg.anchorStrength
      }
      if (n.fx != null) {
        n.x = n.fx
        n.vx = 0
      } else {
        n.vx *= 1 - cfg.velocityDecay
        n.x += n.vx
      }
      if (n.fy != null) {
        n.y = n.fy
        n.vy = 0
      } else {
        n.vy *= 1 - cfg.velocityDecay
        n.y += n.vy
      }
    }

    return this.active
  }

  /** Run `count` ticks synchronously (Neo4j Browser precomputes its layout the same way). */
  precompute(count: number) {
    for (let i = 0; i < count && this.active; i++) this.tick()
  }
}

/** Precompute budget: fewer synchronous ticks for large graphs so a rebuild never freezes the UI. */
export function precomputeTicksFor(nodeCount: number): number {
  if (nodeCount <= 150) return 300
  if (nodeCount <= 400) return 150
  if (nodeCount <= 800) return 60
  return 25
}
