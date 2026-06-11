import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Graph, ViewState } from "./types";

const MARGIN = 40;
const MAX_INDICATORS = 30;
// Per-edge cap: at most this many individual indicators hug one screen edge;
// the rest collapse into a single "+N" pill so a dense neighborhood doesn't
// wallpaper the border with pips and labels.
const MAX_PER_EDGE = 6;

type EdgeSide = "top" | "bottom" | "left" | "right";
const EDGE_SIDES: readonly EdgeSide[] = ["top", "bottom", "left", "right"];

// Which border a clamped indicator position hugs. Corners stick with the
// vertical edge so labels (which extend horizontally) don't get pushed
// across the canvas.
function classifyEdge(cx: number, cy: number, w: number, h: number): EdgeSide {
  const onLeft = cx <= MARGIN + 0.5;
  const onRight = cx >= w - MARGIN - 0.5;
  const onTop = cy <= MARGIN + 0.5;
  const onBottom = cy >= h - MARGIN - 0.5;
  if (onLeft && !onTop && !onBottom) return "left";
  if (onRight && !onTop && !onBottom) return "right";
  if (onTop && !onLeft && !onRight) return "top";
  if (onBottom && !onLeft && !onRight) return "bottom";
  if (onLeft) return "left";
  if (onRight) return "right";
  if (onTop) return "top";
  return "bottom";
}

const _v3 = new THREE.Vector3();

interface Props {
  graph: Graph;
  viewState: ViewState;
  onNodeClick: (id: number) => void;
  hovered?: number | null;
}

type IndicatorDiv = HTMLDivElement & {
  __nodeId?: number;
  __targetLeft?: number;
  __targetTop?: number;
  __currentLeft?: number;
  __currentTop?: number;
  // True between the frame the indicator becomes inactive and the frame it
  // becomes active again — so we can snap-position on first appearance
  // instead of sliding from wherever it sat last time.
  __wasHidden?: boolean;
};

// How fast the indicator chases its target each frame. Higher = snappier,
// lower = calmer. Tuned to feel weighted but not laggy.
const POSITION_LERP_RATE = 5;

// Dead zone (px) for target updates. If the freshly-projected clamp position
// is within this distance of the existing target, we keep the old target —
// so tiny camera nudges don't continuously re-aim the indicator. The lerp
// only fires when there's a real change to chase.
const MIN_TARGET_CHANGE = 3;

// Throttle the projection + de-overlap pass. Camera moves at 60Hz but we
// only need to recompute indicator targets a few times per second — the lerp
// below keeps the visual motion smooth in between. Lower = calmer, fewer
// reshuffles. 0.12s ≈ ~8 ticks/sec.
const TARGET_UPDATE_INTERVAL = 0.12;

// Ease an element's displayed position toward its target (frame-rate
// independent via precomputed k). Snaps on first appearance so it doesn't
// slide in from wherever the pooled element sat last.
function chaseTarget(el: IndicatorDiv, k: number): void {
  const tL = el.__targetLeft ?? 0;
  const tT = el.__targetTop ?? 0;
  const wasHidden = el.__wasHidden ?? true;
  let cL: number;
  let cT: number;
  if (wasHidden || el.__currentLeft === undefined || el.__currentTop === undefined) {
    cL = tL;
    cT = tT;
  } else {
    cL = el.__currentLeft + (tL - el.__currentLeft) * k;
    cT = el.__currentTop + (tT - el.__currentTop) * k;
  }
  el.__currentLeft = cL;
  el.__currentTop = cT;
  el.__wasHidden = false;
  el.style.left = `${cL}px`;
  el.style.top = `${cT}px`;
}

export function OffscreenIndicators({ graph, viewState, onNodeClick, hovered = null }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const indicatorsRef = useRef<HTMLDivElement[]>([]);
  const pillsRef = useRef<Record<EdgeSide, IndicatorDiv> | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  const hoveredRef = useRef(hovered);
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);
  useEffect(() => {
    hoveredRef.current = hovered;
  }, [hovered]);
  const { camera, size, gl } = useThree();

  useEffect(() => {
    // Mount on the Canvas's parent so indicators stay within the graph area
    const canvasParent = gl.domElement.parentElement;
    const container = document.createElement("div");
    Object.assign(container.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "10",
      overflow: "hidden",
    });
    (canvasParent ?? document.body).appendChild(container);
    containerRef.current = container;

    const indicators: HTMLDivElement[] = [];
    for (let i = 0; i < MAX_INDICATORS; i++) {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "absolute",
        display: "none",
        pointerEvents: "auto",
        cursor: "pointer",
      });
      el.addEventListener("click", () => {
        const nid = (el as IndicatorDiv).__nodeId;
        if (nid !== undefined) onNodeClickRef.current(nid);
      });
      el.addEventListener("mouseenter", () => {
        const pip = el.children[0] as HTMLElement;
        const diamond = pip?.children[0] as HTMLElement;
        const label = el.children[2] as HTMLElement;
        if (diamond) {
          diamond.style.background = "rgba(255, 200, 100, 0.95)";
          diamond.style.boxShadow = "0 0 8px rgba(255, 200, 100, 0.8), 0 0 16px rgba(255, 200, 100, 0.3)";
        }
        if (label) label.style.color = "rgba(255, 200, 100, 0.95)";
      });
      el.addEventListener("mouseleave", () => {
        const pip = el.children[0] as HTMLElement;
        const diamond = pip?.children[0] as HTMLElement;
        const label = el.children[2] as HTMLElement;
        if (diamond) {
          diamond.style.background = "rgba(77, 217, 232, 0.9)";
          diamond.style.boxShadow = "0 0 6px rgba(77, 217, 232, 0.6), 0 0 12px rgba(77, 217, 232, 0.2)";
        }
        if (label) label.style.color = "rgba(77, 217, 232, 0.85)";
      });

      // Diamond pip
      const pip = document.createElement("div");
      Object.assign(pip.style, {
        position: "absolute",
        width: "8px",
        height: "8px",
        left: "-4px",
        top: "-4px",
      });

      const diamond = document.createElement("div");
      Object.assign(diamond.style, {
        position: "absolute",
        inset: "0",
        background: "rgba(77, 217, 232, 0.9)",
        transform: "rotate(45deg)",
        borderRadius: "1px",
        boxShadow: "0 0 6px rgba(77, 217, 232, 0.6), 0 0 12px rgba(77, 217, 232, 0.2)",
      });
      pip.appendChild(diamond);

      const ring = document.createElement("div");
      Object.assign(ring.style, {
        position: "absolute",
        inset: "-4px",
        border: "1px solid rgba(77, 217, 232, 0.25)",
        borderRadius: "50%",
      });
      pip.appendChild(ring);

      el.appendChild(pip);

      // Trail line (rotated independently)
      const trail = document.createElement("div");
      Object.assign(trail.style, {
        position: "absolute",
        height: "1px",
        background: "linear-gradient(90deg, rgba(77, 217, 232, 0.4), transparent)",
        transformOrigin: "left center",
        width: "20px",
        left: "0",
        top: "0",
      });
      el.appendChild(trail);

      // Label (positioned independently, always readable)
      const label = document.createElement("div");
      Object.assign(label.style, {
        position: "absolute",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "11px",
        fontWeight: "500",
        letterSpacing: "0.5px",
        color: "rgba(77, 217, 232, 0.85)",
        whiteSpace: "nowrap",
        maxWidth: "120px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        textShadow: "0 0 8px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,1)",
        display: "flex",
        flexDirection: "column",
      });
      const nameSpan = document.createElement("span");
      label.appendChild(nameSpan);
      const edgeSpan = document.createElement("span");
      Object.assign(edgeSpan.style, {
        fontSize: "9px",
        color: "rgba(77, 217, 232, 0.85)",
        display: "none",
      });
      label.appendChild(edgeSpan);
      el.appendChild(label);

      container.appendChild(el);
      indicators.push(el);
    }
    indicatorsRef.current = indicators;

    // One "+N" overflow pill per screen edge for indicators beyond the
    // per-edge cap. Passive count cue — not clickable.
    const pills = {} as Record<EdgeSide, IndicatorDiv>;
    for (const edge of EDGE_SIDES) {
      const pill = document.createElement("div") as IndicatorDiv;
      Object.assign(pill.style, {
        position: "absolute",
        display: "none",
        pointerEvents: "none",
        transform: "translate(-50%, -50%)",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "10px",
        fontWeight: "600",
        letterSpacing: "0.5px",
        color: "rgba(77, 217, 232, 0.9)",
        background: "rgba(8, 18, 24, 0.78)",
        border: "1px solid rgba(77, 217, 232, 0.35)",
        borderRadius: "999px",
        padding: "1px 7px",
        whiteSpace: "nowrap",
        boxShadow: "0 0 8px rgba(77, 217, 232, 0.15)",
      });
      container.appendChild(pill);
      pills[edge] = pill;
    }
    pillsRef.current = pills;

    return () => {
      container.parentElement?.removeChild(container);
      containerRef.current = null;
      indicatorsRef.current = [];
      pillsRef.current = null;
    };
  }, []);

  const targetTickAccum = useRef(0);
  const activeCountRef = useRef(0);

  useFrame((_, delta) => {
    const indicators = indicatorsRef.current as IndicatorDiv[];
    if (!indicators.length) return;

    const pills = pillsRef.current;
    const hidePills = () => {
      if (!pills) return;
      for (const edge of EDGE_SIDES) {
        if (pills[edge].style.display !== "none") {
          pills[edge].style.display = "none";
          pills[edge].__wasHidden = true;
        }
      }
    };
    const chasePills = (k: number) => {
      if (!pills) return;
      for (const edge of EDGE_SIDES) {
        if (pills[edge].style.display !== "none") chaseTarget(pills[edge], k);
      }
    };

    // Mode flips off → hide everything immediately, regardless of throttle.
    if (viewState.mode !== "subgraph") {
      if (activeCountRef.current > 0) {
        for (let i = 0; i < MAX_INDICATORS; i++) {
          if (indicators[i].style.display !== "none") {
            indicators[i].style.display = "none";
            indicators[i].__wasHidden = true;
          }
        }
        activeCountRef.current = 0;
      }
      hidePills();
      return;
    }

    targetTickAccum.current += delta;
    const updateTargets = targetTickAccum.current >= TARGET_UPDATE_INTERVAL;

    if (!updateTargets) {
      // Lerp-only frame — chase last-computed targets without reprojecting.
      const count = activeCountRef.current;
      if (count > 0) {
        const k = 1 - Math.exp(-POSITION_LERP_RATE * delta);
        for (let i = 0; i < count; i++) chaseTarget(indicators[i], k);
        chasePills(k);
      }
      return;
    }

    targetTickAccum.current = 0;

    // Throttled tick: hide everything first; the loop below will re-mark
    // active indicators as visible.
    for (let i = 0; i < MAX_INDICATORS; i++) {
      if (indicators[i].style.display !== "none") {
        indicators[i].style.display = "none";
        indicators[i].__wasHidden = true;
      }
    }
    hidePills();

    const w = size.width;
    const h = size.height;
    const selectedId = viewState.selectedNodeId;
    const depthMap = viewState.depthMap;

    // Phase 1: project every depth-1 node and collect offscreen candidates.
    interface Cand {
      nodeId: number;
      clampX: number;
      clampY: number;
      angle: number;
      dx: number;
      edge: EdgeSide;
    }
    const cands: Cand[] = [];
    for (const [nodeId, depth] of depthMap) {
      if (depth !== 1 || nodeId === selectedId) continue;

      const node = graph.nodes[nodeId];
      if (!node) continue;

      _v3.set(node.position.x, node.position.y, node.position.z);
      _v3.project(camera);

      const sx = ((_v3.x + 1) / 2) * w;
      const sy = ((-_v3.y + 1) / 2) * h;

      if (_v3.z > 1) continue;

      const onScreen =
        sx >= MARGIN && sx <= w - MARGIN &&
        sy >= MARGIN && sy <= h - MARGIN;
      if (onScreen) continue;

      const cx = w / 2;
      const cy = h / 2;
      const dx = sx - cx;
      const dy = sy - cy;
      const angle = Math.atan2(dy, dx);

      const edgeX = w / 2 - MARGIN;
      const edgeY = h / 2 - MARGIN;
      const absCos = Math.abs(Math.cos(angle));
      const absSin = Math.abs(Math.sin(angle));

      let clampX: number, clampY: number;
      if (edgeX * absSin <= edgeY * absCos) {
        clampX = cx + Math.sign(dx) * edgeX;
        clampY = cy + Math.tan(angle) * Math.sign(dx) * edgeX;
      } else {
        clampX = cx + (Math.sign(dy) * edgeY) / Math.tan(angle);
        clampY = cy + Math.sign(dy) * edgeY;
      }

      clampX = Math.max(MARGIN, Math.min(w - MARGIN, clampX));
      clampY = Math.max(MARGIN, Math.min(h - MARGIN, clampY));

      cands.push({ nodeId, clampX, clampY, angle, dx, edge: classifyEdge(clampX, clampY, w, h) });
    }

    // Phase 2: per-edge cap. Membership is stable (sorted by node id) so the
    // set of individually-shown nodes doesn't churn while the camera orbits;
    // everything past the cap is tallied into that edge's "+N" pill.
    cands.sort((a, b) => a.nodeId - b.nodeId);
    const overflowCount: Record<EdgeSide, number> = { top: 0, bottom: 0, left: 0, right: 0 };
    const overflowTangentSum: Record<EdgeSide, number> = { top: 0, bottom: 0, left: 0, right: 0 };
    const perEdgeShown: Record<EdgeSide, number> = { top: 0, bottom: 0, left: 0, right: 0 };
    const shown: Cand[] = [];
    for (const c of cands) {
      if (perEdgeShown[c.edge] < MAX_PER_EDGE && shown.length < MAX_INDICATORS) {
        perEdgeShown[c.edge]++;
        shown.push(c);
      } else {
        overflowCount[c.edge]++;
        overflowTangentSum[c.edge] += c.edge === "top" || c.edge === "bottom" ? c.clampX : c.clampY;
      }
    }

    // Phase 3: drive the indicator pool from the capped list.
    let count = 0;
    for (const { nodeId, clampX, clampY, angle, dx } of shown) {
      const node = graph.nodes[nodeId];
      const el = indicators[count];
      // Indicator pool slots get reassigned to different nodes as the view
      // changes. When that happens, snap so the lerp doesn't slide from the
      // old node's position into the new one's.
      if (el.__nodeId !== nodeId) {
        el.__wasHidden = true;
        el.__nodeId = nodeId;
      }
      el.style.display = "block";
      // Dead-zone gate: only commit a new target if the newly-projected clamp
      // is meaningfully different from the existing target (or the indicator
      // just became active). This keeps the indicator visually still under
      // slow / tiny camera motion.
      const prevTx = el.__targetLeft;
      const prevTy = el.__targetTop;
      const targetStale = el.__wasHidden
        || prevTx === undefined
        || prevTy === undefined
        || Math.abs(clampX - prevTx) >= MIN_TARGET_CHANGE
        || Math.abs(clampY - prevTy) >= MIN_TARGET_CHANGE;
      const targetX = targetStale ? clampX : prevTx!;
      const targetY = targetStale ? clampY : prevTy!;
      // Write target position to style so the bbox measurement in the
      // de-overlap pass below sees the target (not a previous lerped frame).
      // Browser layout flushes synchronously, but paint happens after the
      // final lerp write below — so the user never sees this intermediate.
      el.style.left = `${targetX}px`;
      el.style.top = `${targetY}px`;
      el.__targetLeft = targetX;
      el.__targetTop = targetY;

      // Rotate trail to point outward (toward the off-screen node)
      const trailEl = el.children[1] as HTMLElement;
      const rotDeg = (angle * 180) / Math.PI;
      trailEl.style.transform = `rotate(${rotDeg}deg)`;

      // Position label on the inward side (toward screen center)
      const labelEl = el.children[2] as HTMLElement;
      const nameSpan = labelEl.children[0] as HTMLElement;
      const edgeSpan = labelEl.children[1] as HTMLElement;
      nameSpan.textContent = node.label;

      // Relation type only — show the edge label from the anchor node
      // (hovered takes priority, otherwise the selected node) to this offscreen node.
      const anchor = hoveredRef.current ?? selectedId;
      if (anchor !== null && anchor !== nodeId) {
        const parts: string[] = [];
        for (const e of graph.edges) {
          if (!e.label) continue;
          const involves = (e.src === anchor && e.dst === nodeId) || (e.dst === anchor && e.src === nodeId);
          if (!involves) continue;
          parts.push(e.label);
        }
        if (parts.length > 0) {
          edgeSpan.textContent = parts.join("  ·  ");
          edgeSpan.style.display = "block";
        } else {
          edgeSpan.textContent = "";
          edgeSpan.style.display = "none";
        }
      } else {
        edgeSpan.textContent = "";
        edgeSpan.style.display = "none";
      }

      // Determine which edge we're on and offset label inward
      const onRight = clampX > w - MARGIN - 5;
      const onLeft = clampX < MARGIN + 5;
      const onBottom = clampY > h - MARGIN - 5;
      const onTop = clampY < MARGIN + 5;

      if (onRight) {
        labelEl.style.right = "14px";
        labelEl.style.left = "auto";
        labelEl.style.textAlign = "right";
        labelEl.style.alignItems = "flex-end";
      } else if (onLeft) {
        labelEl.style.left = "14px";
        labelEl.style.right = "auto";
        labelEl.style.textAlign = "left";
        labelEl.style.alignItems = "flex-start";
      } else {
        // Horizontal center — offset based on angle
        if (dx > 0) {
          labelEl.style.right = "14px";
          labelEl.style.left = "auto";
          labelEl.style.textAlign = "right";
          labelEl.style.alignItems = "flex-end";
        } else {
          labelEl.style.left = "14px";
          labelEl.style.right = "auto";
          labelEl.style.textAlign = "left";
          labelEl.style.alignItems = "flex-start";
        }
      }

      if (onTop) {
        labelEl.style.top = "10px";
        labelEl.style.bottom = "auto";
      } else if (onBottom) {
        labelEl.style.bottom = "10px";
        labelEl.style.top = "auto";
      } else {
        labelEl.style.top = "-5px";
        labelEl.style.bottom = "auto";
      }

      count++;
    }

    // Phase 4: overflow pills — one per edge, sitting at the mean tangent
    // position of the indicators it absorbed (a directional hint, not just
    // a count in a corner).
    if (pills) {
      for (const edge of EDGE_SIDES) {
        const pill = pills[edge];
        const n = overflowCount[edge];
        if (n === 0) continue; // already hidden by the top-of-tick reset
        const horizontal = edge === "top" || edge === "bottom";
        const mean = overflowTangentSum[edge] / n;
        const tx = horizontal
          ? Math.max(MARGIN, Math.min(w - MARGIN, mean))
          : edge === "left" ? MARGIN : w - MARGIN;
        const ty = horizontal
          ? edge === "top" ? MARGIN : h - MARGIN
          : Math.max(MARGIN, Math.min(h - MARGIN, mean));
        pill.textContent = `+${n}`;
        pill.style.display = "block";
        const prevTx = pill.__targetLeft;
        const prevTy = pill.__targetTop;
        const targetStale = pill.__wasHidden
          || prevTx === undefined
          || prevTy === undefined
          || Math.abs(tx - prevTx) >= MIN_TARGET_CHANGE
          || Math.abs(ty - prevTy) >= MIN_TARGET_CHANGE;
        const targetX = targetStale ? tx : prevTx!;
        const targetY = targetStale ? ty : prevTy!;
        pill.style.left = `${targetX}px`;
        pill.style.top = `${targetY}px`;
        pill.__targetLeft = targetX;
        pill.__targetTop = targetY;
      }
    }

    // De-overlap pass: indicators clamped to the same edge can stack on top of
    // each other (e.g. two left-edge indicators with their relation labels
    // colliding). Group active indicators by which edge they hug, sort along
    // the edge tangent, and greedily push later boxes outward until they no
    // longer overlap their predecessor. Pills join their edge's group so a
    // "+N" never sits on top of a pip's label.
    if (count > 1 || (pills && EDGE_SIDES.some((e) => overflowCount[e] > 0))) {
      interface Active {
        el: IndicatorDiv;
        cx: number;
        cy: number;
        edge: "top" | "bottom" | "left" | "right";
        t0: number;
        t1: number;
      }
      const groups: Record<Active["edge"], Active[]> = {
        top: [], bottom: [], left: [], right: [],
      };
      for (let i = 0; i < count; i++) {
        const el = indicators[i];
        const cx = el.__targetLeft ?? 0;
        const cy = el.__targetTop ?? 0;
        const edge = classifyEdge(cx, cy, w, h);
        // The indicator div itself is 0×0 (children are all position:absolute,
        // so they don't contribute to its content box). Measure the label
        // child directly and union with the pip's 8px extent around the
        // anchor — this is the indicator's actual visual footprint.
        const anchorRect = el.getBoundingClientRect();
        const labelEl = el.children[2] as HTMLElement;
        const labelRect = labelEl.getBoundingClientRect();
        const ax = anchorRect.left;
        const ay = anchorRect.top;
        const bboxLeft = Math.min(ax - 4, labelRect.left);
        const bboxRight = Math.max(ax + 4, labelRect.right);
        const bboxTop = Math.min(ay - 4, labelRect.top);
        const bboxBottom = Math.max(ay + 4, labelRect.bottom);
        const horizontal = edge === "top" || edge === "bottom";
        const t0 = horizontal ? bboxLeft : bboxTop;
        const t1 = horizontal ? bboxRight : bboxBottom;
        groups[edge].push({ el, cx, cy, edge, t0, t1 });
      }

      // Pills participate too — measured directly (they're real boxes).
      if (pills) {
        for (const edge of EDGE_SIDES) {
          const pill = pills[edge];
          if (pill.style.display === "none") continue;
          const r = pill.getBoundingClientRect();
          const horizontal = edge === "top" || edge === "bottom";
          groups[edge].push({
            el: pill,
            cx: pill.__targetLeft ?? 0,
            cy: pill.__targetTop ?? 0,
            edge,
            t0: horizontal ? r.left : r.top,
            t1: horizontal ? r.right : r.bottom,
          });
        }
      }

      const GAP = 4;
      for (const edge of ["top", "bottom", "left", "right"] as const) {
        const arr = groups[edge];
        if (arr.length < 2) continue;
        arr.sort((a, b) => a.t0 - b.t0);
        const horizontal = edge === "top" || edge === "bottom";
        const maxC = horizontal ? w - MARGIN : h - MARGIN;
        for (let i = 1; i < arr.length; i++) {
          const prev = arr[i - 1];
          const curr = arr[i];
          const need = (prev.t1 + GAP) - curr.t0;
          if (need <= 0) continue;
          if (horizontal) {
            const newCx = Math.min(curr.cx + need, maxC);
            const delta = newCx - curr.cx;
            if (delta <= 0) continue;
            curr.el.style.left = `${newCx}px`;
            curr.el.__targetLeft = newCx;
            curr.cx = newCx;
            curr.t0 += delta;
            curr.t1 += delta;
          } else {
            const newCy = Math.min(curr.cy + need, maxC);
            const delta = newCy - curr.cy;
            if (delta <= 0) continue;
            curr.el.style.top = `${newCy}px`;
            curr.el.__targetTop = newCy;
            curr.cy = newCy;
            curr.t0 += delta;
            curr.t1 += delta;
          }
        }
      }
    }

    activeCountRef.current = count;

    // Smooth chase: ease each indicator's *displayed* position toward its
    // target. Lerp is computed from delta-time so the speed is frame-rate
    // independent. On first appearance (or after being hidden), the indicator
    // snaps to its target so it doesn't slide in from wherever it sat last.
    const k = 1 - Math.exp(-POSITION_LERP_RATE * delta);
    for (let i = 0; i < count; i++) chaseTarget(indicators[i], k);
    chasePills(k);
  });

  return null;
}
