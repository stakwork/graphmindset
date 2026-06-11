import { useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// Center of the label box relative to the node anchor, in screen pixels.
// Default ("below"): the label baseline transform is translate(-50%, 20px),
// so without any extra offset the label center sits at (0, 20 + h/2).
export type LabelOffset = readonly [dx: number, dy: number];

const _v = new THREE.Vector3();

function candidatesFor(w: number, h: number): LabelOffset[] {
  // Keep every candidate close to the anchor — at most ~half the label's
  // own height/width offset from the dot. Far-displacement candidates
  // (e.g. 2× height below) make labels visually disown their nodes, which
  // is worse than mild residual overlap.
  const v = 20 + h / 2;     // baseline "below" — label sits below the dot
  const hx = 16 + w / 2;    // side — label sits to the side of the dot
  return [
    [0, v],
    [0, -v],
    [hx, h / 2],
    [-hx, h / 2],
    [hx * 0.9, -h / 2],
    [-hx * 0.9, -h / 2],
  ];
}

function overlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
  pad: number,
): boolean {
  return !(ax + aw + pad <= bx || bx + bw + pad <= ax || ay + ah + pad <= by || by + bh + pad <= ay);
}

interface Entry {
  id: number;
  el: HTMLDivElement;
  sx: number;
  sy: number;
  w: number;
  h: number;
  priority: number;
  dist: number;
}

// Distance-aware presentation: labels scale down and fade as their node gets
// farther from the camera, relative to the nearest labeled nodes this tick
// (self-normalizing, so it behaves the same at any zoom level). A plateau
// keeps everything within DIST_PLATEAU× the reference distance at full
// size/opacity — only clearly-distant labels attenuate, and never below the
// floors (a label that exists must stay readable). Prominent labels
// (hovered/selected/search — priority ≥ 60) are exempt entirely.
const DIST_PLATEAU = 1.6;
const DIST_FALLOFF = 2.4;
const DIST_SCALE_MIN = 0.75;
const DIST_ALPHA_MIN = 0.55;
const PROMINENT_PRIORITY = 60;

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function useLabelPlacement(opts: {
  positionsRef: MutableRefObject<Float32Array>;
  registryRef: MutableRefObject<Map<number, HTMLDivElement | null>>;
  enabled: boolean;
}) {
  const { positionsRef, registryRef, enabled } = opts;
  const { camera, size } = useThree();
  const tickAccum = useRef(0);
  // Last accepted offset per node (hysteresis).
  const lastOffset = useRef(new Map<number, LabelOffset>());

  useFrame((_, delta) => {
    if (!enabled) return;
    tickAccum.current += delta;
    if (tickAccum.current < 0.066) return;
    tickAccum.current = 0;

    const W = size.width;
    const H = size.height;
    const registry = registryRef.current;
    const positions = positionsRef.current;

    // Pass 1: project + measure (read-only DOM phase to avoid layout thrash).
    const entries: Entry[] = [];
    for (const [id, el] of registry) {
      if (!el) continue;
      const i3 = id * 3;
      if (i3 + 2 >= positions.length) continue;
      _v.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);
      const dist = _v.distanceTo(camera.position);
      _v.project(camera);
      if (_v.z > 1) continue;
      const sx = ((_v.x + 1) / 2) * W;
      const sy = ((-_v.y + 1) / 2) * H;
      if (sx < -200 || sx > W + 200 || sy < -200 || sy > H + 200) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const priority = parseFloat(el.dataset.priority ?? "0");
      entries.push({ id, el, sx, sy, w: rect.width, h: rect.height, priority, dist });
    }

    // Reference distance for scaling: a low percentile rather than the strict
    // minimum, so one node hugging the camera doesn't shrink everything else.
    let refDist = 0;
    if (entries.length > 0) {
      const dists = entries.map((e) => e.dist).sort((a, b) => a - b);
      refDist = dists[Math.floor(0.15 * (dists.length - 1))];
    }

    // Sort by priority desc; ties broken by y so labels higher on screen win.
    entries.sort((a, b) => (b.priority - a.priority) || (a.sy - b.sy));

    const placed: Placed[] = [];
    const pad = 2;

    for (const e of entries) {
      const cands = candidatesFor(e.w, e.h);

      // Hysteresis: try previous offset first if it still fits.
      const prev = lastOffset.current.get(e.id);
      let chosen: LabelOffset | null = null;
      const tryOffset = (dx: number, dy: number): boolean => {
        const x = e.sx + dx - e.w / 2;
        const y = e.sy + dy - e.h / 2;
        for (const p of placed) {
          if (overlap(x, y, e.w, e.h, p.x, p.y, p.w, p.h, pad)) return false;
        }
        return true;
      };

      if (prev && tryOffset(prev[0], prev[1])) {
        chosen = prev;
      } else {
        for (const c of cands) {
          if (tryOffset(c[0], c[1])) { chosen = c; break; }
        }
      }

      if (!chosen) chosen = cands[0]; // fallback to default

      const [dx, dy] = chosen;
      lastOffset.current.set(e.id, chosen);

      placed.push({ x: e.sx + dx - e.w / 2, y: e.sy + dy - e.h / 2, w: e.w, h: e.h });

      // Convert (dx, dy) — desired label center relative to anchor —
      // into a delta from the baseline CSS transform translate(-50%, 20px).
      // Baseline puts the label center at (0, 20 + h/2). Extra CSS shifts
      // we apply are (--lbl-ex, --lbl-ey) on top of that. So:
      //   ex = dx
      //   ey = dy - (20 + h/2)
      const ex = dx;
      const ey = dy - (20 + e.h / 2);

      // Distance attenuation: full presentation inside the plateau, easing
      // down to the floors past it.
      const ratio = refDist > 0 ? e.dist / refDist : 1;
      const t = Math.min(Math.max((ratio - DIST_PLATEAU) / DIST_FALLOFF, 0), 1);
      let scale = 1 - (1 - DIST_SCALE_MIN) * t;
      let alpha = 1 - (1 - DIST_ALPHA_MIN) * t;
      if (e.priority >= PROMINENT_PRIORITY) {
        scale = 1;
        alpha = 1;
      }

      // Write-phase: imperative, no React re-render.
      e.el.style.setProperty("--lbl-ex", `${ex.toFixed(1)}px`);
      e.el.style.setProperty("--lbl-ey", `${ey.toFixed(1)}px`);
      e.el.style.setProperty("--lbl-scale", scale.toFixed(3));
      e.el.style.setProperty("--lbl-alpha", alpha.toFixed(3));
    }

    // GC: drop hysteresis entries for nodes no longer registered.
    if (lastOffset.current.size > registry.size * 2) {
      for (const id of lastOffset.current.keys()) {
        if (!registry.has(id) || !registry.get(id)) lastOffset.current.delete(id);
      }
    }
  });
}
