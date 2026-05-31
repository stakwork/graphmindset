export interface Cam {
  x: number
  y: number
  scale: number
}

export function smoothstep(x: number, a: number, b: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function worldToScreen(
  wx: number,
  wy: number,
  cam: Cam,
  w: number,
  h: number,
) {
  return {
    x: (wx - cam.x) * cam.scale + w / 2,
    y: (wy - cam.y) * cam.scale + h / 2,
  }
}

export function screenToWorld(
  sx: number,
  sy: number,
  cam: Cam,
  w: number,
  h: number,
) {
  return {
    x: (sx - w / 2) / cam.scale + cam.x,
    y: (sy - h / 2) / cam.scale + cam.y,
  }
}

export function hexToRGB(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}
