// =======================================
// GraphView.tsx (FULL COPY-PASTE VERSION)
// Fixes scaling mismatch by:
// 1) Forcing selected node depth = 0 everywhere (sizes + labels)
// 2) Strong depth-driven scaling (hub > ring > leaves)
// 3) Shader fades crisp ring for tiny nodes so leaves look like soft dots
// 4) Labels follow animated positions (no teleport)
// 5) Reuses edge buffers (no per-frame Float32Array allocations)
// =======================================

import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { VIRTUAL_CENTER } from "./extract";
import type { Graph, GraphEdge, ViewState } from "./types";
import { edgeKey, isStructuralEdge } from "./types";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { PulseLayer } from "./PulseLayer";
import { useLabelPlacement } from "./useLabelPlacement";
import { getSchemaIcon } from "@/lib/schema-icons";

export interface Pulse {
  src: number;
  dst: number;
  progress: number; // 0→1
}

interface GraphViewProps {
  graph: Graph;
  viewState: ViewState;
  onNodeClick: (id: number) => void;
  onHoverChange?: (id: number | null) => void;
  minimap?: boolean;
  whiteboardNodeId?: number | null;
  onEnterWhiteboard?: (id: number) => void;
  onExitWhiteboard?: () => void;
  onDetailNavigate?: (id: number) => void;
  searchMatches?: Set<number> | null;
  /** Subset of searchMatches (top-N by score) allowed to show a text label.
   *  Caps label pile-up when a query returns many hits; non-labeled matches
   *  keep their glyph spotlight and reveal their label on hover. */
  searchLabelMatches?: Set<number> | null;
  /** Top-3 ranked search hits, by descending score. Value 0 = best hit (gold),
   *  1-2 = cool-blue runners-up. Amplifies size, color, and label prominence. */
  topMatchRanks?: Map<number, number> | null;
  /** Active search query — when set, only the matching substring of a search-hit's
   *  label is highlighted; the rest of the label uses the base match color. */
  searchTerm?: string;
  pulses?: Pulse[];
  /** Recently added node IDs → timestamp (for streaming highlight) */
  recentNodes?: Map<number, number>;
  /** Cluster proxy node ID that is currently expanded in place */
  expandedClusterId?: number | null;
  /** Bumps only on a full layout rebuild (new dataset / schema). Lets the snap
   *  effect tell a rebuild (snap everything) from an in-place append (animate
   *  existing nodes to their new spots, fly new ones in from their parent). */
  layoutGeneration?: number;
  /** External hovered node instance index (from sidebar hover) */
  externalHoveredId?: number | null;
  /** External selected node instance index (from sidebar click) */
  externalSelectedId?: number | null;
  /** Called when the user clicks directly in the graph (before onNodeClick) */
  onGraphClick?: () => void;
  /** Optional schema-driven icon name per node type (lowercase node_type →
   *  schema icon string like "EpisodeIcon"). Resolved through schema-icons
   *  to a Lucide component for the type pill. */
  nodeTypeIcons?: Record<string, string>;
  /** Called when the user clicks the ✕ close button anchored to the selected
   *  node — typically wired to the same handler as the "Reset view" pill. */
  onResetView?: () => void;
  /** When true (e.g. while the user is dragging/rotating the camera), pointer
   *  hover is ignored so nodes sweeping under a stationary cursor don't fire
   *  hover effects. Any existing hover is cleared on the rising edge. */
  suppressHover?: boolean;
}

const tmpObj = new THREE.Object3D();
const tmpColor = new THREE.Color();

// Bind a typed array to a geometry attribute, recreating the BufferAttribute
// only when the backing array was swapped for a bigger one. A fresh attribute
// object makes three.js allocate a brand-new GPU buffer, so calling
// `setAttribute(new BufferAttribute(...))` per frame churns VBOs and garbage;
// when the array is unchanged a needsUpdate flag re-uploads in place.
function syncAttribute(
  geom: THREE.BufferGeometry,
  name: string,
  array: Float32Array,
  itemSize: number,
) {
  const existing = geom.getAttribute(name) as THREE.BufferAttribute | undefined;
  if (existing && existing.array === array) {
    existing.needsUpdate = true;
  } else {
    const attr = new THREE.BufferAttribute(array, itemSize);
    attr.needsUpdate = true;
    geom.setAttribute(name, attr);
  }
}

// --------- Billboard glow shader (tiny nodes become dim blobs) ---------
const glowVertexShader = /* glsl */ `
  attribute float instanceProgress;
  attribute float instanceAlpha;
  attribute float instanceShape;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vScale;
  varying float vProgress;
  varying float vAlpha;
  varying float vShape;

  void main() {
    vUv = uv;
    vProgress = instanceProgress;
    vAlpha = instanceAlpha;
    vShape = instanceShape;

    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = vec3(1.0);
    #endif

    // instance translation and scale
    vec3 instancePos = vec3(instanceMatrix[3]);
    float scaleX = length(vec3(instanceMatrix[0]));
    vScale = scaleX;

    // Billboard: offset in camera-local XY (screen-space constant size)
    vec3 localOffset = (position * scaleX);
    vec4 mvPosition = modelViewMatrix * vec4(instancePos, 1.0);
    float screenScale = -mvPosition.z / projectionMatrix[1][1];
    mvPosition.xy += localOffset.xy * screenScale * 0.08;

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const glowFragmentShader = /* glsl */ `
  // Cluster proxies (_cluster / _group nodes, flagged via instanceShape) render
  // as the "Orbit" glyph from Cluster Node Explorations.html: 5 small dots
  // scattered on a faint dashed orbit, with a small outlined core. Reads as
  // "satellites bound to a center" — a cluster of related items.
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vScale;
  varying float vProgress;
  varying float vAlpha;
  varying float vShape;

  // Distance from point p to the line segment a→b.
  float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  void main() {
    vec2 coord = (vUv - 0.5) * 2.0;
    float r = length(coord);
    bool isCluster = vShape >= 0.5;

    float centerDot = 1.0 - smoothstep(0.06, 0.15, r);
    float ringDist = abs(r - 0.55);
    float ring = smoothstep(0.11, 0.0, ringDist);
    float ringGlow = exp(-ringDist * ringDist * 30.0) * 0.6;
    float outerGlow = exp(-2.5 * max(r - 0.55, 0.0)) * 0.2;
    float innerFill = (1.0 - smoothstep(0.0, 0.55, r)) * 0.04;

    if (isCluster) {
      // Orbit — 5 dots scattered on a faint dashed ring at r≈0.59, with a
      // small outlined core. Angles match the design's [10°, 70°, 135°, 210°,
      // 285°] for the same recognisable silhouette.
      vec2 d0 = vec2( 0.581,  0.103);   //  10°
      vec2 d1 = vec2( 0.202,  0.554);   //  70°
      vec2 d2 = vec2(-0.417,  0.417);   // 135°
      vec2 d3 = vec2(-0.511, -0.295);   // 210°
      vec2 d4 = vec2( 0.153, -0.570);   // 285°

      float dotMin = length(coord - d0);
      dotMin = min(dotMin, length(coord - d1));
      dotMin = min(dotMin, length(coord - d2));
      dotMin = min(dotMin, length(coord - d3));
      dotMin = min(dotMin, length(coord - d4));
      float dots = 1.0 - smoothstep(0.065, 0.100, dotMin);
      float dotsGlow = exp(-dotMin * dotMin * 320.0) * 0.55;

      // Dashed orbit ring at r ≈ 0.59. ~22 dashes around at ~22% duty cycle.
      float orbitDist = abs(r - 0.59);
      float angle = atan(coord.y, coord.x);
      float dashes = 22.0;
      float seg = fract(angle / 6.28318530718 * dashes + 0.5);
      float dashMask = smoothstep(0.30, 0.18, seg);
      float orbit = smoothstep(0.014, 0.004, orbitDist) * 0.75 * dashMask;
      float orbitGlow = exp(-orbitDist * orbitDist * 1400.0) * 0.25 * dashMask;

      // Core: small outlined ring + filled center dot.
      float coreRingDist = abs(r - 0.145);
      float coreRing = smoothstep(0.022, 0.006, coreRingDist) * 0.90;
      float coreFill = 1.0 - smoothstep(0.045, 0.065, r);

      // Strong soft halo — gives the cluster a clear cyan "body" that fades
      // outward past the orbit. This is what reads as "presence" against
      // the black canvas in the design reference (Cluster Node Expl. #06).
      float halo      = (1.0 - smoothstep(0.0, 1.00, r)) * 0.50;
      float haloCore  = (1.0 - smoothstep(0.0, 0.40, r)) * 0.35;

      centerDot = max(
        max(max(dots, coreFill), max(orbit, coreRing)),
        max(halo, haloCore)
      );
      ring = 0.0;
      ringGlow = dotsGlow + orbitGlow;
      outerGlow = 0.0;
      innerFill = 0.0;
    }

    // Hide ring + all ring effects for bare nodes (progress == -2.0 sentinel)
    float showRing = vProgress < -1.5 ? 0.0 : 1.0;
    ring *= showRing;
    ringGlow *= showRing;
    outerGlow *= showRing;
    innerFill *= showRing;

    // Glow only on selected node (large scale)
    float s = clamp((vScale - 0.5) / 0.1, 0.0, 1.0);
    ringGlow *= s;
    outerGlow *= s;
    innerFill *= s;
    centerDot *= 0.8;

    float alpha = centerDot + ring + ringGlow + outerGlow + innerFill;
    if (alpha < 0.01) discard;

    float brightness = centerDot + ring + ringGlow * 0.7 + outerGlow * 0.4 + innerFill;
    // 1.0 cap (was 1.6) — past 1.0, color * brightness saturates the dominant
    // channel and pushes the orb toward white. The original cyan tolerated 1.6
    // because its R channel was low; warm/violet colors lose hue.
    brightness = min(brightness, 1.0);

    vec3 color = vColor;

    // Radial sweep fill for executing nodes (progress >= 0)
    if (vProgress >= 0.0) {
      // Angle from top (12 o'clock), clockwise 0..1
      float a = atan(coord.x, coord.y);
      float fill = a < 0.0 ? (a + 6.28318) / 6.28318 : a / 6.28318;

      float inFill = smoothstep(0.0, 0.015, vProgress - fill);

      // Bright edge at the progress boundary
      float edgeDist = abs(fill - vProgress);
      float edgeBright = exp(-edgeDist * edgeDist * 6000.0) * 0.8;

      vec3 fillColor = vec3(0.2, 1.0, 0.4);
      vec3 dimColor = color * 0.15;
      color = mix(dimColor, fillColor, inFill) + fillColor * edgeBright;
    }

    gl_FragColor = vec4(color * brightness, alpha * vAlpha);
  }
`;

// Per-type RGB palette for node coloring. Lowercase node_type keys; unknown
// types fall back to NODE_DEFAULT_COLOR which keeps the original cyan.
type RGB = { r: number; g: number; b: number };
const NODE_DEFAULT_COLOR: RGB = { r: 0.45, g: 0.85, b: 0.95 };
const NODE_TYPE_COLORS: Record<string, RGB> = {
  episode: { r: 0.96, g: 0.71, b: 0.38 },
  show: { r: 0.36, g: 0.84, b: 1.0 },
  chapter: { r: 0.49, g: 0.83, b: 0.66 },
  claim: { r: 0.91, g: 0.47, b: 0.66 },
  person: { r: 0.65, g: 0.55, b: 0.98 },
  topic: { r: 0.4, g: 0.85, b: 0.97 },
  organization: { r: 1.0, g: 0.58, b: 0.27 },
  place: { r: 0.49, g: 0.83, b: 0.66 },
  product: { r: 0.99, g: 0.83, b: 0.30 },
  section: { r: 0.62, g: 0.75, b: 0.82 },
  document: { r: 0.55, g: 0.71, b: 0.85 },
  tweet: { r: 0.36, g: 0.84, b: 1.0 },
  video: { r: 0.86, g: 0.40, b: 0.40 },
};
function colorForNodeType(t?: string): RGB {
  if (!t) return NODE_DEFAULT_COLOR;
  return NODE_TYPE_COLORS[t.toLowerCase()] ?? NODE_DEFAULT_COLOR;
}

// Per-edge-type color for the focus-highlight overlay. When a node is hovered
// or selected, its edges colorize by type so the chip "MENTIONS × 24" and the
// 24 orange edges that belong to it read as one visual bundle.
const EDGE_DEFAULT_COLOR: RGB = { r: 1.0, g: 0.45, b: 0.5 };
const EDGE_TYPE_COLORS: Record<string, RGB> = {
  HAS: { r: 0.49, g: 0.83, b: 0.66 },
  HAS_CLAIM: { r: 0.91, g: 0.47, b: 0.66 },
  MENTIONS: { r: 0.96, g: 0.71, b: 0.38 },
  MENTIONED: { r: 0.96, g: 0.71, b: 0.38 },
  MENTIONED_IN: { r: 1.0, g: 0.58, b: 0.27 },
  IS_HOST: { r: 0.65, g: 0.55, b: 0.98 },
  IS_GUEST: { r: 0.55, g: 0.45, b: 0.95 },
  IS_SPEAKER: { r: 0.45, g: 0.40, b: 0.92 },
  SOURCE: { r: 0.91, g: 0.47, b: 0.66 },
  MADE_CLAIM: { r: 0.99, g: 0.83, b: 0.30 },
  RELATED_TO: { r: 0.62, g: 0.75, b: 0.82 },
};
function colorForEdgeType(t?: string): RGB {
  if (!t) return EDGE_DEFAULT_COLOR;
  return EDGE_TYPE_COLORS[t.toUpperCase()] ?? EDGE_DEFAULT_COLOR;
}

// Ring chord polygon (Feature 5) — muted dark-cyan-grey so the perimeter reads
// as a group outline rather than a real edge between members.
const RING_EDGE_TYPE = "__ring__";
const RING_COLOR: RGB = { r: 0.42, g: 0.55, b: 0.58 };
const RING_ALPHA = 0.26;
const RING_MIN_MEMBERS = 5;

// Node move/scale/color easing rate (per second). Nodes close this fraction of
// the remaining distance to their target each second, frame-rate independent:
// t = 1 - exp(-delta * rate). Higher = snappier; ~6 ≈ settles in ~0.5s. This is
// the single knob for how fast repositioning + fly-in animations feel.
const NODE_EASE_RATE = 6;
function rgbToCss(c: RGB, alpha = 1): string {
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
}

// --------- Edge glow material (matches ring style) ---------
const edgeGlowVertexShader = /* glsl */ `
  attribute float alpha;
  uniform float opacity;
  varying float vOpacity;

  void main() {
    vOpacity = opacity * alpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const edgeGlowFragmentShader = /* glsl */ `
  uniform vec3 color;
  varying float vOpacity;

  void main() {
    gl_FragColor = vec4(color * 1.2, vOpacity);
  }
`;

// Highlight overlay reads color from a per-vertex attribute so each focused
// edge can colorize by its edge type instead of all turning the same red.
const edgeHighlightVertexShader = /* glsl */ `
  attribute float alpha;
  attribute vec3 vertexColor;
  uniform float opacity;
  varying float vOpacity;
  varying vec3 vColor;

  void main() {
    vOpacity = opacity * alpha;
    vColor = vertexColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const edgeHighlightFragmentShader = /* glsl */ `
  varying float vOpacity;
  varying vec3 vColor;

  void main() {
    gl_FragColor = vec4(vColor * 1.3, vOpacity);
  }
`;

// --------- Helpers for custom sphere raycast ---------
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _sphere = new THREE.Sphere();
const _hitPoint = new THREE.Vector3();


const SHOW_HELPERS = false;

interface LaneInfo {
  lane: number;
  total: number;
}

/** Assign each edge a lane index in [-(N-1)/2 .. (N-1)/2] within its node-pair group. */
function computeLaneInfo(edges: GraphEdge[]): Map<GraphEdge, LaneInfo> {
  const counts = new Map<string, number>();
  for (const e of edges) {
    const k = edgeKey(e.src, e.dst);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const result = new Map<GraphEdge, LaneInfo>();
  for (const e of edges) {
    const k = edgeKey(e.src, e.dst);
    const total = counts.get(k) ?? 1;
    const idx = seen.get(k) ?? 0;
    seen.set(k, idx + 1);
    result.set(e, { lane: idx - (total - 1) / 2, total });
  }
  return result;
}

/** Quadratic Bézier control point for a cross-edge, including lane offset. */
function computeBezierControl(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  lane: number
): { cx: number; cy: number; cz: number; edgeLen: number; perpX: number; perpZ: number } {
  const mx = (ax + bx) * 0.5;
  const my = (ay + by) * 0.5;
  const mz = (az + bz) * 0.5;
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const edgeLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const midDist = Math.sqrt(mx * mx + mz * mz);
  const curveFactor = midDist > 0.01 ? Math.min(0.3, edgeLen / (midDist * 3)) : 0;

  // Perpendicular to the chord in the XZ plane (Y-up world).
  const chordXZ = Math.sqrt(dx * dx + dz * dz);
  let perpX = 0, perpZ = 0;
  if (chordXZ > 0.001) {
    perpX = -dz / chordXZ;
    perpZ = dx / chordXZ;
  }
  // Spread amount: stays subtle, scales with edge length so close pairs separate cleanly.
  const laneSpread = Math.min(2.5, 0.6 + edgeLen * 0.12);
  const offsetMag = lane * laneSpread;

  const cx = mx * (1 - curveFactor) + perpX * offsetMag;
  const cy = my + Math.min(3, edgeLen * 0.1);
  const cz = mz * (1 - curveFactor) + perpZ * offsetMag;
  return { cx, cy, cz, edgeLen, perpX, perpZ };
}

/** Sample a quadratic Bézier at parameter t. */
function sampleBezier(
  ax: number, ay: number, az: number,
  cx: number, cy: number, cz: number,
  bx: number, by: number, bz: number,
  t: number
): { x: number; y: number; z: number } {
  const omt = 1 - t;
  return {
    x: omt * omt * ax + 2 * omt * t * cx + t * t * bx,
    y: omt * omt * ay + 2 * omt * t * cy + t * t * by,
    z: omt * omt * az + 2 * omt * t * cz + t * t * bz,
  };
}

// Splits `label` around case-insensitive occurrences of `term` and bolds the
// matching substrings so the user can see which part of the label triggered
// the search hit. Color is inherited from the parent label style.
function renderHighlightedLabel(label: string, term: string): React.ReactNode {
  if (!term) return label;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = label.split(new RegExp(`(${escaped})`, "gi"));
  const matchRe = new RegExp(`^${escaped}$`, "i");
  return parts.map((part, i) =>
    matchRe.test(part)
      ? <strong key={i} style={{ fontWeight: 800 }}>{part}</strong>
      : <span key={i}>{part}</span>
  );
}


export function GraphView({ graph, viewState, onNodeClick, onHoverChange, minimap, whiteboardNodeId, onExitWhiteboard, onDetailNavigate, searchMatches, searchLabelMatches, topMatchRanks, searchTerm, pulses, recentNodes, expandedClusterId, layoutGeneration = 0, externalHoveredId, externalSelectedId, onGraphClick, nodeTypeIcons, onResetView, suppressHover }: GraphViewProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const linesRef = useRef<THREE.LineSegments>(null);
  const highlightLinesRef = useRef<THREE.LineSegments>(null);
  const trailLinesRef = useRef<THREE.LineSegments>(null);
  const crossLinesRef = useRef<THREE.LineSegments>(null);

  const [hovered, setHovered] = useState<number | null>(null);
  const detailPanelOpacity = useRef(0);
  const wbNodeId = whiteboardNodeId ?? null;

  // Reset → overview: clear hovered too so highlight edges / focus styling
  // from the previously focused node disappear with the rest of the state.
  useEffect(() => {
    if (viewState.mode === "overview") {
      setHovered(null);
    }
  }, [viewState.mode]);


  // Approach indicator state (node id + 0-1 progress for "zoom to inspect" hint)
  const approachRef = useRef<{ nodeId: number; progress: number }>({ nodeId: -1, progress: 0 });
  const [approachState, setApproachState] = useState<{ nodeId: number; progress: number }>({ nodeId: -1, progress: 0 });

  const nodeCount = graph.nodes.length;

  // Capacity rounds up to next 1000 — mesh is recreated only at these boundaries
  const meshCapacity = Math.ceil(Math.max(nodeCount, 1) / 1000) * 1000;
  // Track nodeCount and graph for the custom raycast closure (via refs so always current)
  const nodeCountRef = useRef(nodeCount);
  nodeCountRef.current = nodeCount;
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const expandedClusterRef = useRef(expandedClusterId);
  expandedClusterRef.current = expandedClusterId;
  const externalHoveredRef = useRef<number | null>(null);
  externalHoveredRef.current = externalHoveredId ?? null;
  const externalSelectedRef = useRef<number | null>(null);
  externalSelectedRef.current = externalSelectedId ?? null;

  // Hover/label-rule adjacency uses graph.adj only — the real edges. Folding
  // in extraEdges (cluster-absorbed) would promote every absorbed member to a
  // direct hover-neighbor, producing label storms ("Clip × 7" label + every
  // clip's label visible). The cluster proxy itself is the 1-hop stand-in.
  const hoveredRelated = useMemo<Set<number> | null>(() => {
    if (hovered === null) return null;
    return new Set(graph.adj[hovered]);
  }, [hovered, graph.adj]);

  useEffect(() => {
    onHoverChange?.(hovered);
  }, [hovered, onHoverChange]);


  // Current animated state — grow buffers when nodeCount increases
  const currentPos = useRef(new Float32Array(nodeCount * 3));
  const currentScale = useRef(new Float32Array(nodeCount));
  const currentColor = useRef(new Float32Array(nodeCount * 3));
  const currentAlpha = useRef(new Float32Array(nodeCount));

  // Per-instance progress for executing nodes (-1 = inactive, 0..1 = progress)
  const progressArray = useRef(new Float32Array(nodeCount).fill(-1));
  const progressAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
  const alphaAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);

  // Per-instance shape selector — encodes both "is this a cluster?" and
  // "which cluster glyph?" in one float so the fragment shader can branch
  // per-instance without a uniform. Values: 0=regular, 1=Concentric,
  // 2=Hex Sat, 3=Petal, 4=Constellation, 5=Star.
  const shapeArray = useRef(new Float32Array(nodeCount));
  const shapeAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);

  // Labels follow animation (updated at low fps)
  const [labelPos, setLabelPos] = useState(() => new Float32Array(nodeCount * 3));
  const labelAccum = useRef(0);

  // Smart label placement: each visible label registers its DOM node via ref
  // callback below. useLabelPlacement runs a ~15 Hz greedy de-overlap pass —
  // it projects every entry to screen, sorts by priority, and writes the
  // chosen offset back as CSS variables (--lbl-ex / --lbl-ey). Hysteresis is
  // built in so the chosen slot is sticky across ticks.
  const labelRegistryRef = useRef<Map<number, HTMLDivElement | null>>(new Map());
  useLabelPlacement({
    positionsRef: currentPos,
    registryRef: labelRegistryRef,
    enabled: !minimap,
  });

  // Resize buffers when nodeCount grows (streaming support)
  const prevNodeCount = useRef(nodeCount);
  const buffersGrewRef = useRef(false);
  if (nodeCount > prevNodeCount.current) {
    const grow = <T extends Float32Array>(old: T, perNode: number, fillVal?: number): T => {
      const next = new Float32Array(nodeCount * perNode) as unknown as T;
      next.set(old.subarray(0, Math.min(old.length, nodeCount * perNode)));
      if (fillVal !== undefined) {
        for (let i = prevNodeCount.current * perNode; i < nodeCount * perNode; i++) {
          (next as Float32Array)[i] = fillVal;
        }
      }
      return next;
    };
    currentPos.current = grow(currentPos.current, 3);
    currentScale.current = grow(currentScale.current, 1);
    currentColor.current = grow(currentColor.current, 3);
    currentAlpha.current = grow(currentAlpha.current, 1, 1);
    progressArray.current = grow(progressArray.current, 1, -1);
    shapeArray.current = grow(shapeArray.current, 1, 0);
    buffersGrewRef.current = true;

    prevNodeCount.current = nodeCount;
  }

  // Reuse edge buffers (avoid per-frame allocations) — grow as needed
  const edgePosRef = useRef<Float32Array>(new Float32Array(Math.max(1, graph.edges.length) * 6));
  const edgeAlphaRef = useRef<Float32Array>(new Float32Array(Math.max(1, graph.edges.length) * 2));
  const hlEdgePosRef = useRef<Float32Array>(new Float32Array(Math.max(1, graph.edges.length) * 6));
  const hlEdgeAlphaRef = useRef<Float32Array>(new Float32Array(Math.max(1, graph.edges.length) * 2));
  const hlEdgeColorRef = useRef<Float32Array>(new Float32Array(Math.max(1, graph.edges.length) * 6));
  const trailEdgePosRef = useRef<Float32Array>(new Float32Array(64 * 6));
  const trailEdgeAlphaRef = useRef<Float32Array>(new Float32Array(64 * 2));
  // Cross-edge Bézier buffers (8 segments per edge)
  const crossEdgePosRef = useRef<Float32Array>(new Float32Array(256 * 6));
  const crossEdgeAlphaRef = useRef<Float32Array>(new Float32Array(256 * 2));
  // Per-node pulse intensity scratch buffer — only touched while pulses run
  const pulseIntensityRef = useRef<Float32Array>(new Float32Array(0));

  // Grow edge buffers when edge count increases
  const edgeCount = graph.edges.length;
  if (edgeCount * 6 > edgePosRef.current.length) {
    edgePosRef.current = new Float32Array(edgeCount * 6);
    edgeAlphaRef.current = new Float32Array(edgeCount * 2);
    hlEdgePosRef.current = new Float32Array(edgeCount * 6);
    hlEdgeAlphaRef.current = new Float32Array(edgeCount * 2);
  }
  const orbitLinesRef = useRef<THREE.LineSegments>(null);
  const orbitPosRef = useRef<Float32Array>(new Float32Array(512 * 6));
  const orbitAlphaRef = useRef<Float32Array>(new Float32Array(512 * 2));

  // Visible nodes set (subgraph mode)
  const visibleNodes = useMemo(() => {
    if (viewState.mode === "overview") return null;
    return new Set(viewState.visibleNodeIds);
  }, [viewState]);

  // Targets: positions/scales/colors
  const targets = useMemo(() => {
    const positions = new Float32Array(nodeCount * 3);
    const scales = new Float32Array(nodeCount);
    const colors = new Float32Array(nodeCount * 3);
    const alphas = new Float32Array(nodeCount);

    // Always use fixed positions from the graph — no repositioning on selection
    for (let i = 0; i < nodeCount; i++) {
      const node = graph.nodes[i];
      const i3 = i * 3;

      positions[i3] = node.position.x;
      positions[i3 + 1] = node.position.y;
      positions[i3 + 2] = node.position.z;
    }

    // Selected node = big with glow; everything else = same small point
    const SELECTED_SCALE = 0.6;
    const NODE_SCALE = 0.4;

    // Alpha drops per depth from selected; siblings denser than the rest
    const alphaByDepth = (d: number) =>
      d === 0 ? 1.0 : d === 1 ? 0.85 : d === 2 ? 0.35 : 0.15;

    // Base color for all nodes — alpha controls depth fading via color multiply
    const BASE_R = 0.45, BASE_G = 0.85, BASE_B = 0.95;
    // Build cloud member set — cloud dots render small until proxy is selected
    const cloudMembers = new Set<number>();
    const regions = graph.unstructuredRegions;
    if (regions) {
      for (const region of regions) {
        for (const mid of region.memberIds) cloudMembers.add(mid);
      }
    }

    // Collapsed cloud dot scale (small but visible)
    const CLOUD_DOT_SCALE = 0.15;

    if (viewState.mode === "overview") {
      const depthMap = graph.initialDepthMap;
      for (let i = 0; i < nodeCount; i++) {
        const i3 = i * 3;

        const depth = depthMap?.get(i) ?? 0;

        // Hide proxy glyph when its cluster is expanded (label stays via label layer)
        if (i === expandedClusterId) {
          scales[i] = 0; alphas[i] = 0;
          colors[i3] = 0; colors[i3 + 1] = 0; colors[i3 + 2] = 0;
          continue;
        }

        if (cloudMembers.has(i)) {
          scales[i] = CLOUD_DOT_SCALE;
          const a = 0.4;
          colors[i3] = BASE_R * a; colors[i3 + 1] = BASE_G * a; colors[i3 + 2] = BASE_B * a;
          alphas[i] = a;
        } else {
          const w = graph.nodes[i].weight ?? 0;
          const baseScale = depth === 0 ? SELECTED_SCALE : NODE_SCALE;
          scales[i] = baseScale * (1 + 0.5 * w);
          const baseA = alphaByDepth(depth);
          const a = baseA + (1.0 - baseA) * w * 0.6;
          const c = colorForNodeType(graph.nodes[i].nodeType);
          colors[i3] = c.r * a; colors[i3 + 1] = c.g * a; colors[i3 + 2] = c.b * a;
          alphas[i] = a;
        }
      }
    } else {
      const selectedId = viewState.selectedNodeId;
      const visibleSet = new Set(viewState.visibleNodeIds);

      for (let i = 0; i < nodeCount; i++) {
        const i3 = i * 3;

        if (!visibleSet.has(i)) {
          scales[i] = 0; colors[i3] = 0; colors[i3 + 1] = 0; colors[i3 + 2] = 0; alphas[i] = 0;
          continue;
        }

        // Hide proxy glyph when its cluster is expanded
        if (i === expandedClusterId) {
          scales[i] = 0; alphas[i] = 0;
          colors[i3] = 0; colors[i3 + 1] = 0; colors[i3 + 2] = 0;
          continue;
        }

        const relDepth = i === selectedId ? 0 : (viewState.depthMap.get(i) ?? 999);

        if (cloudMembers.has(i)) {
          scales[i] = CLOUD_DOT_SCALE;
          const a = 0.4;
          colors[i3] = BASE_R * a; colors[i3 + 1] = BASE_G * a; colors[i3 + 2] = BASE_B * a;
          alphas[i] = a;
        } else {
          const w = graph.nodes[i].weight ?? 0;
          const baseScale = relDepth === 0 ? SELECTED_SCALE : NODE_SCALE;
          scales[i] = baseScale * (1 + 0.5 * w);
          const baseA = relDepth === -1 ? 0.3 : alphaByDepth(relDepth);
          const a = baseA + (1.0 - baseA) * w * 0.6;
          const c = colorForNodeType(graph.nodes[i].nodeType);
          colors[i3] = c.r * a; colors[i3 + 1] = c.g * a; colors[i3 + 2] = c.b * a;
          alphas[i] = a;
        }
      }
    }

    return { positions, scales, colors, alphas };
  }, [graph, viewState, nodeCount, expandedClusterId]);

  const { treeEdges, crossEdges, targetEdges, edgeLaneInfo } = useMemo(() => {
    // Hide edges touching cloud members of COLLAPSED clusters.
    // Expanded cluster's members get their edges shown.
    const cloudSet = new Set<number>();
    if (graph.unstructuredRegions) {
      for (const region of graph.unstructuredRegions) {
        if (region.proxyNodeId === expandedClusterId) continue; // expanded — show edges
        for (const mid of region.memberIds) cloudSet.add(mid);
      }
    }
    const collapsedSet = cloudSet;

    // Drop spokes: edges OUT of a synthetic proxy (`_group`/`_cluster` →
    // member) re-pollute the render with the same N lines the cluster was
    // supposed to absorb. Edges INTO a proxy (`Episode → cluster_proxy`) are
    // the canonical relation and must stay.
    const isSpoke = (e: GraphEdge) => {
      const srcType = graph.nodes[e.src]?.nodeType;
      return srcType === "_group" || srcType === "_cluster";
    };

    let allEdges: GraphEdge[];
    if (viewState.mode === "overview") {
      // In overview, only show structural edges — hide cross-edges to reduce clutter
      allEdges = graph.edges.filter((e) => {
        if (collapsedSet.has(e.src) || collapsedSet.has(e.dst)) return false;
        if (isSpoke(e)) return false;
        return isStructuralEdge(e);
      });
    } else {
      const visibleSet = new Set(viewState.visibleNodeIds);
      const sel = viewState.selectedNodeId;
      const tes = graph.treeEdgeSet;
      allEdges = graph.edges.filter((e) => {
        if (collapsedSet.has(e.src) || collapsedSet.has(e.dst)) return false;
        if (!visibleSet.has(e.src) || !visibleSet.has(e.dst)) return false;
        if (isSpoke(e)) return false;
        if (e.src === sel || e.dst === sel) return true;
        return tes ? tes.has(edgeKey(e.src, e.dst)) : true;
      });
    }

    const tes = graph.treeEdgeSet;

    if (!tes || tes.size === 0) {
      const lanes = computeLaneInfo(allEdges);
      return { treeEdges: allEdges, crossEdges: [] as GraphEdge[], targetEdges: allEdges, edgeLaneInfo: lanes };
    }

    const tree: GraphEdge[] = [];
    const cross: GraphEdge[] = [];
    // Collect raw cross-edge keys (from original graph edges not in tree)
    const rawCrossKeys = new Set<string>();
    for (const e of graph.edges) {
      if (!tes.has(edgeKey(e.src, e.dst))) {
        rawCrossKeys.add(edgeKey(e.src, e.dst));
      }
    }
    // Classify: ring-chain synthetic edges are NOT in rawCrossKeys → treated as tree
    for (const e of allEdges) {
      if (rawCrossKeys.has(edgeKey(e.src, e.dst))) {
        cross.push(e);
      } else {
        tree.push(e);
      }
    }
    // Only compute lanes for cross-edges — straight tree edges don't curve.
    const lanes = computeLaneInfo(cross);
    return { treeEdges: tree, crossEdges: cross, targetEdges: allEdges, edgeLaneInfo: lanes };
  }, [graph, viewState, expandedClusterId]);

  const selectedId = viewState.mode === "subgraph" ? viewState.selectedNodeId : null;
  const navigationHistory = viewState.mode === "subgraph" ? viewState.navigationHistory : [];



  const highlightedEdges = useMemo(() => {
    // Source from graph.edges (not targetEdges) so cross-edges touching the
    // hovered/selected node surface here even when the subgraph-mode filter
    // strips them out of the base render. Skip extraEdges (cluster-absorbed
    // originals) — pulling them in re-pollutes the hover view with the N
    // spokes the cluster was supposed to replace. Drop spokes too: hovering
    // a member shouldn't trace the proxy→member spoke.
    const visibleSet = viewState.mode === "subgraph"
      ? new Set(viewState.visibleNodeIds)
      : null;
    const hasFocus = hovered !== null || selectedId !== null;
    const real = !hasFocus
      ? []
      : graph.edges.filter((e) => {
          const touches =
            e.src === hovered || e.dst === hovered ||
            e.src === selectedId || e.dst === selectedId;
          if (!touches) return false;
          const srcType = graph.nodes[e.src]?.nodeType;
          if (srcType === "_group" || srcType === "_cluster") {
            // Spokes are dropped by default — for large clusters the ring chord
            // polygon below handles them. For a small cluster (<RING_MIN_MEMBERS)
            // the ring would degenerate to a triangle/line, so we instead show
            // the spokes themselves — but only when the proxy itself is the focus.
            const isFocusedProxy = e.src === hovered || e.src === selectedId;
            if (!isFocusedProxy) return false;
            const visibleMembers = (graph.outAdj?.[e.src] ?? []).filter(
              (m) => !visibleSet || visibleSet.has(m),
            );
            if (visibleMembers.length >= RING_MIN_MEMBERS) return false;
          }
          if (visibleSet && (!visibleSet.has(e.src) || !visibleSet.has(e.dst))) return false;
          return true;
        });

    // Ring chord polygon (Feature 5): connect members in angular order around
    // every cluster/group proxy with ≥ RING_MIN_MEMBERS members so the cluster
    // reads as a perimeter. Always rendered for `_group` proxies (members are
    // real laid-out roots/orphans). For `_cluster` proxies, members stay
    // collapsed/invisible at a tiny offset until the proxy is expanded, so we
    // only draw the ring while expanded — otherwise the perimeter degenerates
    // into a tight stack of dots at the proxy center.
    const ring: GraphEdge[] = [];
    for (let proxyId = 0; proxyId < graph.nodes.length; proxyId++) {
      const nodeType = graph.nodes[proxyId]?.nodeType;
      if (nodeType !== "_group" && nodeType !== "_cluster") continue;
      if (nodeType === "_cluster" && proxyId !== expandedClusterId) continue;
      const members = (graph.outAdj?.[proxyId] ?? []).filter(
        (m) => !visibleSet || visibleSet.has(m),
      );
      if (members.length < RING_MIN_MEMBERS) continue;
      const p = graph.nodes[proxyId].position;
      const sorted = members
        .slice()
        .sort(
          (a, b) =>
            Math.atan2(graph.nodes[a].position.z - p.z, graph.nodes[a].position.x - p.x) -
            Math.atan2(graph.nodes[b].position.z - p.z, graph.nodes[b].position.x - p.x),
        );
      for (let i = 0; i < sorted.length; i++) {
        ring.push({
          src: sorted[i],
          dst: sorted[(i + 1) % sorted.length],
          type: RING_EDGE_TYPE,
        });
      }
    }

    return ring.length > 0 ? [...real, ...ring] : real;
  }, [hovered, selectedId, graph.edges, graph.nodes, graph.outAdj, viewState, expandedClusterId]);

  // For each neighbor of the focused node, the set of edge types connecting
  // it to the focused node. Lets the label render show "via MENTIONS" etc.
  // right under the node, so the edge-to-node link is unambiguous.
  const edgeTypesByNeighbor = useMemo(() => {
    const m = new Map<number, Set<string>>();
    if (highlightedEdges.length === 0) return m;
    const focusIds = new Set<number>();
    if (hovered !== null) focusIds.add(hovered);
    if (selectedId !== null) focusIds.add(selectedId);
    for (const e of highlightedEdges) {
      const label = e.label;
      if (!label) continue;
      const other = focusIds.has(e.src) ? e.dst : e.src;
      let s = m.get(other);
      if (!s) { s = new Set<string>(); m.set(other, s); }
      s.add(label);
    }
    return m;
  }, [highlightedEdges, hovered, selectedId]);

  // Snap all animation state to targets on mount and when graph structure changes
  const prevGraphRef = useRef(graph);
  const prevSnapNodeCount = useRef(nodeCount);
  const prevLayoutGen = useRef(layoutGeneration);
  const didMount = useRef(false);
  useEffect(() => {
    const isMount = !didMount.current;
    didMount.current = true;
    // A rebuild (new dataset/schema) bumps layoutGeneration → snap everything,
    // since node identities are reassigned and animating them is meaningless.
    const isRebuild = layoutGeneration !== prevLayoutGen.current;
    prevLayoutGen.current = layoutGeneration;
    const oldCount = prevSnapNodeCount.current;
    const nodeCountGrew = nodeCount > oldCount;
    prevGraphRef.current = graph;
    prevSnapNodeCount.current = nodeCount;

    const snapAll = isMount || isRebuild;

    if (!snapAll && !nodeCountGrew && currentPos.current.length >= nodeCount * 3) {
      return; // just targets changed → let useFrame lerp existing nodes there
    }

    if (snapAll) {
      for (let i = 0; i < nodeCount; i++) {
        const i3 = i * 3;
        currentPos.current[i3] = targets.positions[i3];
        currentPos.current[i3 + 1] = targets.positions[i3 + 1];
        currentPos.current[i3 + 2] = targets.positions[i3 + 2];
        currentScale.current[i] = targets.scales[i];
        currentColor.current[i3] = targets.colors[i3];
        currentColor.current[i3 + 1] = targets.colors[i3 + 1];
        currentColor.current[i3 + 2] = targets.colors[i3 + 2];
        currentAlpha.current[i] = targets.alphas[i];
      }
      setLabelPos(new Float32Array(currentPos.current));
      return;
    }

    // In-place append: existing nodes [0, oldCount) keep their current values so
    // useFrame animates them to their new targets. New nodes [oldCount, ...) are
    // seeded at their PARENT's position with scale/alpha 0, so the same lerp
    // flies them out to their ring spot while they grow + fade in.
    const startFor = (i: number): [number, number, number] => {
      const parent = graph.inAdj[i]?.[0];
      const ref =
        parent !== undefined && parent < nodeCount
          ? parent
          : viewState.mode === "subgraph"
            ? viewState.selectedNodeId
            : undefined;
      if (ref === undefined || ref >= nodeCount) return [0, 0, 0];
      const r3 = ref * 3;
      // Parent that already exists on screen → fly from where it currently is;
      // a freshly-added parent (e.g. a new proxy) → fly from its final spot.
      const src = ref < oldCount ? currentPos.current : targets.positions;
      return [src[r3], src[r3 + 1], src[r3 + 2]];
    };
    for (let i = oldCount; i < nodeCount; i++) {
      const i3 = i * 3;
      const [sx, sy, sz] = startFor(i);
      currentPos.current[i3] = sx;
      currentPos.current[i3 + 1] = sy;
      currentPos.current[i3 + 2] = sz;
      currentScale.current[i] = 0;
      currentColor.current[i3] = 0;
      currentColor.current[i3 + 1] = 0;
      currentColor.current[i3 + 2] = 0;
      currentAlpha.current[i] = 0;
    }
  }, [graph, targets, nodeCount, layoutGeneration, viewState]);

  // Attach per-instance progress attribute (runs on mesh recreation AND buffer growth)
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const attr = new THREE.InstancedBufferAttribute(progressArray.current, 1);
    mesh.geometry.setAttribute("instanceProgress", attr);
    progressAttrRef.current = attr;
    const alphaAttr = new THREE.InstancedBufferAttribute(currentAlpha.current, 1);
    mesh.geometry.setAttribute("instanceAlpha", alphaAttr);
    alphaAttrRef.current = alphaAttr;
    const shapeAttr = new THREE.InstancedBufferAttribute(shapeArray.current, 1);
    mesh.geometry.setAttribute("instanceShape", shapeAttr);
    shapeAttrRef.current = shapeAttr;
  }, [meshCapacity, nodeCount]);

  // Populate per-instance shape from nodeType — cluster/group proxies render
  // as the Orbit glyph; everything else stays the default sphere + ring.
  useEffect(() => {
    const arr = shapeArray.current;
    for (let i = 0; i < nodeCount; i++) {
      const t = graph.nodes[i]?.nodeType;
      arr[i] = t === "_cluster" || t === "_group" ? 1 : 0;
    }
    if (shapeAttrRef.current) shapeAttrRef.current.needsUpdate = true;
  }, [graph, nodeCount]);

  // Custom sphere raycast — defined once as a stable function that reads refs.
  // Assigned to mesh in useEffect and re-assigned whenever the mesh changes.
  const raycastFn = useRef<THREE.Mesh["raycast"] | null>(null);
  if (!raycastFn.current) {
    let _raycastLogTimer = 0;
    raycastFn.current = function customRaycast(this: THREE.InstancedMesh, raycaster, intersects) {
      const count = Math.min(nodeCountRef.current, this.instanceMatrix.count);
      const g = graphRef.current;
      const nodes = g.nodes;
      const alphas = currentAlpha.current;

      const clouds = new Set<number>();
      const proxyRadius = new Map<number, number>();
      const expCluster = expandedClusterRef.current;
      if (g.unstructuredRegions) {
        for (const r of g.unstructuredRegions) {
          if (r.proxyNodeId === expCluster) continue;
          for (const mid of r.memberIds) clouds.add(mid);
          proxyRadius.set(r.proxyNodeId, Math.max(r.radius, 3));
        }
      }
      let _skippedCloud = 0, _skippedAlpha = 0, _skippedScale = 0, _tested = 0, _hit = 0;
      for (let i = 0; i < count; i++) {
        if (clouds.has(i)) { _skippedCloud++; continue; }
        if (alphas[i] < 0.02) { _skippedAlpha++; continue; }

        this.getMatrixAt(i, _mat4);
        _mat4.decompose(_pos, _quat, _scale);
        if (_scale.x < 0.01) { _skippedScale++; continue; }

        _sphere.center.copy(_pos);

        const pr = proxyRadius.get(i);
        if (pr !== undefined) {
          _sphere.radius = pr;
        } else {
          const camDist = raycaster.ray.origin.distanceTo(_pos);
          const baseScale = nodes[i]?.icon ? _scale.x / 0.3 : _scale.x;
          _sphere.radius = baseScale * camDist * 0.08;
        }

        _tested++;
        if (raycaster.ray.intersectSphere(_sphere, _hitPoint)) {
          const distance = raycaster.ray.origin.distanceTo(_hitPoint);
          if (distance >= raycaster.near && distance <= raycaster.far) {
            _hit++;
            intersects.push({
              distance,
              point: _hitPoint.clone(),
              instanceId: i,
              object: this,
            } as THREE.Intersection);
          }
        }
      }
      const now = Date.now();
      if (now - _raycastLogTimer > 2000) {
        _raycastLogTimer = now;
        console.log(`[GV] raycast: count=${count} tested=${_tested} hit=${_hit} cloud=${_skippedCloud} alpha=${_skippedAlpha} scale=${_skippedScale}`);
      }
    };
  }

  // Attach custom raycast + pre-populate matrices whenever mesh is (re)created
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // Pre-populate instance matrices so raycasting works before first useFrame
    const count = Math.min(nodeCountRef.current, mesh.instanceMatrix.count);
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      tmpObj.position.set(
        currentPos.current[i3] || 0,
        currentPos.current[i3 + 1] || 0,
        currentPos.current[i3 + 2] || 0,
      );
      tmpObj.scale.setScalar(currentScale.current[i] || 0.001);
      tmpObj.updateMatrix();
      mesh.setMatrixAt(i, tmpObj.matrix);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.raycast = raycastFn.current!;
  }, [meshCapacity]);


  useFrame(({ camera, pointer }, delta) => {
    const mesh = meshRef.current;
    const lines = linesRef.current;
    if (!mesh) return;

    // Only render active instances — cap to actual mesh allocation (meshCapacity state)
    // meshCapacityRef.current may be updated before the mesh is recreated with new capacity
    mesh.count = Math.min(nodeCount, meshCapacity);

    // Re-attach buffer attributes after buffers grew (useFrame runs before effects)
    if (buffersGrewRef.current) {
      buffersGrewRef.current = false;
      const pAttr = new THREE.InstancedBufferAttribute(progressArray.current, 1);
      mesh.geometry.setAttribute("instanceProgress", pAttr);
      progressAttrRef.current = pAttr;
      const aAttr = new THREE.InstancedBufferAttribute(currentAlpha.current, 1);
      mesh.geometry.setAttribute("instanceAlpha", aAttr);
      alphaAttrRef.current = aAttr;
      const sAttr = new THREE.InstancedBufferAttribute(shapeArray.current, 1);
      mesh.geometry.setAttribute("instanceShape", sAttr);
      shapeAttrRef.current = sAttr;
    }

    const now = Date.now();

    // Build per-node pulse intensity (0 = none, 1 = full). Null when no pulses
    // are running so the idle path skips the buffer entirely.
    let pulseIntensity: Float32Array | null = null;
    if (pulses && pulses.length > 0) {
      if (pulseIntensityRef.current.length < nodeCount) {
        pulseIntensityRef.current = new Float32Array(nodeCount);
      }
      pulseIntensity = pulseIntensityRef.current;
      pulseIntensity.fill(0, 0, nodeCount);
      for (const p of pulses) {
        // Sharp flash: source peaks fast then fades, destination peaks at arrival
        const srcI = p.progress < 0.3 ? 1 : Math.max(0, 1 - (p.progress - 0.3) / 0.3);
        const dstI = p.progress < 0.5 ? 0 : Math.min(1, (p.progress - 0.5) / 0.2);
        pulseIntensity[p.src] = Math.max(pulseIntensity[p.src], srcI);
        pulseIntensity[p.dst] = Math.max(pulseIntensity[p.dst], dstI);
      }
    }

    // Frame-rate-independent ease-out toward target: close NODE_EASE_RATE of the
    // remaining distance per second. Predictable glide, no dependence on a global
    // transition clock (which made appends snap-or-rush depending on timing).
    const t = 1 - Math.exp(-delta * NODE_EASE_RATE);

    // Expand cluster members when their proxy is explicitly expanded
    const selectedProxyMembers = new Set<number>();
    const regions = graph.unstructuredRegions;
    if (regions && expandedClusterId != null) {
      for (const region of regions) {
        if (region.proxyNodeId === expandedClusterId) {
          for (const mid of region.memberIds) selectedProxyMembers.add(mid);
        }
      }
    }

    // Animate nodes
    for (let i = 0; i < nodeCount; i++) {
      const i3 = i * 3;

      // Animate position (always lerp to target)
      currentPos.current[i3] += (targets.positions[i3] - currentPos.current[i3]) * t;
      currentPos.current[i3 + 1] += (targets.positions[i3 + 1] - currentPos.current[i3 + 1]) * t;
      currentPos.current[i3 + 2] += (targets.positions[i3 + 2] - currentPos.current[i3 + 2]) * t;

      currentScale.current[i] += (targets.scales[i] - currentScale.current[i]) * t;

      currentColor.current[i3] += (targets.colors[i3] - currentColor.current[i3]) * t;
      currentColor.current[i3 + 1] += (targets.colors[i3 + 1] - currentColor.current[i3 + 1]) * t;
      currentColor.current[i3 + 2] += (targets.colors[i3 + 2] - currentColor.current[i3 + 2]) * t;

      currentAlpha.current[i] += (targets.alphas[i] - currentAlpha.current[i]) * t;

      // Update per-instance progress for shader
      // -2 sentinel = unstructured node → shader hides ring
      const isUnstructured = graph.unstructuredNodeIds?.has(i) ?? false;
      const isRelatedToSelected = hoveredRelated?.has(i) ?? false;
      const isProxySelected = selectedProxyMembers.has(i);
      const isUnstructuredBare = isUnstructured
        && !isProxySelected
        && i !== hovered
        && !isRelatedToSelected
        && !(viewState.mode === "subgraph" && i === viewState.selectedNodeId);
      const nodeProgress = graph.nodes[i].progress;
      if (isUnstructuredBare) {
        progressArray.current[i] = -2;
      } else if (graph.nodes[i].loaderId && nodeProgress != null && nodeProgress >= 0) {
        // Animated spinner for loadable nodes that are actively loading
        progressArray.current[i] = (now * 0.001) % 1;
      } else if (nodeProgress != null && nodeProgress > 0) {
        progressArray.current[i] = nodeProgress;
      } else {
        progressArray.current[i] = -1;
      }

      // When proxy is selected, upgrade cloud dots to regular visible nodes
      if (isUnstructured && isProxySelected && targets.scales[i] < 0.2) {
        currentScale.current[i] += (0.4 - currentScale.current[i]) * t;
        const a = 0.8;
        currentColor.current[i3] += (0.45 * a - currentColor.current[i3]) * t;
        currentColor.current[i3 + 1] += (0.85 * a - currentColor.current[i3 + 1]) * t;
        currentColor.current[i3 + 2] += (0.95 * a - currentColor.current[i3 + 2]) * t;
        currentAlpha.current[i] += (a - currentAlpha.current[i]) * t;
      }

      let s = graph.nodes[i].icon ? Math.max(currentScale.current[i] * 0.3, 0.001) : Math.max(currentScale.current[i], 0.001);

      // Boost glow when camera is approaching this node
      if (approachRef.current.nodeId === i && approachRef.current.progress > 0) {
        s *= 1 + 0.5 * approachRef.current.progress;
      }

      // Shrink whiteboard node glow so the panel is readable
      if (wbNodeId !== null && i === wbNodeId) {
        s *= 0.01;
      }

      // Top-3 search hits get amplified size so bloom turns them into halos.
      const isTopHit = topMatchRanks?.has(i) ?? false;
      if (isTopHit) {
        s *= topMatchRanks!.get(i) === 0 ? 1.9 : 1.55;
      }

      tmpObj.position.set(
        currentPos.current[i3],
        currentPos.current[i3 + 1],
        currentPos.current[i3 + 2]
      );
      tmpObj.scale.setScalar(s);
      tmpObj.updateMatrix();
      mesh.setMatrixAt(i, tmpObj.matrix);

      const extHov = externalHoveredRef.current;
      const extSelNode = externalSelectedRef.current;
      const extHovAdj = extHov !== null ? (graph.adj[extHov] ?? []) : null;
      const isPrimaryHighlight =
        i === hovered ||
        (extHov !== null && i === extHov) ||
        (extSelNode !== null && i === extSelNode);
      const isNeighborHighlight =
        (hoveredRelated && hoveredRelated.has(i)) ||
        (extHovAdj && (extHovAdj as number[]).includes(i));
      if (isPrimaryHighlight) {
        tmpColor.setRGB(0.4, 1.3, 1.8);
      } else if (isNeighborHighlight) {
        tmpColor.setRGB(0.18, 0.55, 0.8);
      } else if (graph.nodes[i].status === "executing") {
        tmpColor.setRGB(0.2, 1.0, 0.4);
      } else {
        tmpColor.setRGB(
          currentColor.current[i3],
          currentColor.current[i3 + 1],
          currentColor.current[i3 + 2],
        );
      }

      // When a highlight is active, dim everything that isn't part of it so
      // the selection pops by contrast.
      const anyHighlightActive =
        hovered !== null || extHov !== null || extSelNode !== null;
      if (anyHighlightActive && !isPrimaryHighlight && !isNeighborHighlight) {
        tmpColor.multiplyScalar(0.35);
      }

      // Search dim: non-matches dim so the hits read by contrast. The focus
      // highlight (primary/neighbor) is exempt so hovering/selecting still
      // pops, and the dim layers with the focus dim above so non-focus
      // non-matches end up *more* recessive on hover, not less.
      if (searchMatches && searchMatches.size > 0) {
        if (!searchMatches.has(i) && !isPrimaryHighlight && !isNeighborHighlight) {
          tmpColor.multiplyScalar(0.15);
        }
      }

      // Top-3 hit color brightening — push past 1.0 so the bloom pass turns
      // each into a halo. Best hit (rank 0) gets a stronger boost.
      if (isTopHit) {
        tmpColor.multiplyScalar(topMatchRanks!.get(i) === 0 ? 1.9 : 1.55);
      }

      // Recently-added node highlight (streaming): bright green-white flash fading over 3s
      if (recentNodes && recentNodes.has(i)) {
        const addedAt = recentNodes.get(i)!;
        const age = (now - addedAt) / 3000; // 0→1 over 3 seconds
        const intensity = Math.max(0, 1 - age);
        const flash = intensity * intensity; // ease-out
        tmpColor.r += (0.4 - tmpColor.r) * flash;
        tmpColor.g += (1.5 - tmpColor.g) * flash;
        tmpColor.b += (0.8 - tmpColor.b) * flash;
        s *= 1 + 0.8 * flash;
      }

      // Dim non-whiteboard nodes when detail panel is open
      if (wbNodeId !== null && i !== wbNodeId) {
        tmpColor.multiplyScalar(0.2);
      }

      // Pulse: hot white flash with scale burst
      const pi = pulseIntensity ? pulseIntensity[i] : 0;
      if (pi > 0) {
        const flash = pi * pi; // sharper falloff
        tmpColor.r += (1.5 - tmpColor.r) * flash;
        tmpColor.g += (1.5 - tmpColor.g) * flash;
        tmpColor.b += (1.8 - tmpColor.b) * flash;
        s *= 1 + 1.2 * flash;
      }

      mesh.setColorAt(i, tmpColor);
    }

    // Semantic zoom disabled for performance
    approachRef.current = { nodeId: -1, progress: 0 };

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (progressAttrRef.current) progressAttrRef.current.needsUpdate = true;
    if (alphaAttrRef.current) alphaAttrRef.current.needsUpdate = true;

    // Tree edges (straight lines — reuse buffer)
    if (lines) {
      const edgeCount = treeEdges.length;
      let pos = edgePosRef.current;
      if (pos.length < edgeCount * 6) {
        pos = new Float32Array(edgeCount * 6);
        edgePosRef.current = pos;
      }
      let eAlpha = edgeAlphaRef.current;
      if (eAlpha.length < edgeCount * 2) {
        eAlpha = new Float32Array(edgeCount * 2);
        edgeAlphaRef.current = eAlpha;
      }

      for (let i = 0; i < edgeCount; i++) {
        const e = treeEdges[i];
        const s3 = e.src * 3;
        const d3 = e.dst * 3;
        const base = i * 6;
        pos[base] = currentPos.current[s3];
        pos[base + 1] = currentPos.current[s3 + 1];
        pos[base + 2] = currentPos.current[s3 + 2];
        pos[base + 3] = currentPos.current[d3];
        pos[base + 4] = currentPos.current[d3 + 1];
        pos[base + 5] = currentPos.current[d3 + 2];
        const ab = i * 2;
        eAlpha[ab] = currentAlpha.current[e.src];
        eAlpha[ab + 1] = currentAlpha.current[e.dst];
      }

      const geom = lines.geometry as THREE.BufferGeometry;
      syncAttribute(geom, "position", pos, 3);
      syncAttribute(geom, "alpha", eAlpha, 1);
      geom.setDrawRange(0, edgeCount * 2);
    }

    // Cross-edges (Bézier curves — 8 line segments per edge)
    const crossLines = crossLinesRef.current;
    if (crossLines) {
      const SUBDIVS = 8;
      const crossCount = crossEdges.length;
      const segCount = crossCount * SUBDIVS;
      let cPos = crossEdgePosRef.current;
      if (cPos.length < segCount * 6) {
        cPos = new Float32Array(segCount * 6);
        crossEdgePosRef.current = cPos;
      }
      let cAlpha = crossEdgeAlphaRef.current;
      if (cAlpha.length < segCount * 2) {
        cAlpha = new Float32Array(segCount * 2);
        crossEdgeAlphaRef.current = cAlpha;
      }

      for (let i = 0; i < crossCount; i++) {
        const e = crossEdges[i];
        const s3 = e.src * 3;
        const d3 = e.dst * 3;
        const ax = currentPos.current[s3], ay = currentPos.current[s3 + 1], az = currentPos.current[s3 + 2];
        const bx = currentPos.current[d3], by = currentPos.current[d3 + 1], bz = currentPos.current[d3 + 2];

        // Control point: midpoint with curvature proportional to edge length, plus
        // a perpendicular lane offset so parallel edges fan out into distinct curves.
        const lane = edgeLaneInfo.get(e)?.lane ?? 0;
        const { cx, cy, cz, edgeLen } = computeBezierControl(ax, ay, az, bx, by, bz, lane);

        // Progressive disclosure: bright on hover, dim otherwise
        const nodeAlpha = Math.min(currentAlpha.current[e.src], currentAlpha.current[e.dst]);
        const isHoverEdge = (e.src === hovered || e.dst === hovered);
        const isSelectedEdge = (e.src === selectedId || e.dst === selectedId);
        const interactionFactor = isHoverEdge ? 1.0 : isSelectedEdge ? 0.4 : 0.15;
        const alpha = nodeAlpha * interactionFactor;
        const baseIdx = i * SUBDIVS;

        for (let s = 0; s < SUBDIVS; s++) {
          const t0 = s / SUBDIVS;
          const t1 = (s + 1) / SUBDIVS;
          // Quadratic Bézier: B(t) = (1-t)²A + 2(1-t)tC + t²B
          const omt0 = 1 - t0, omt1 = 1 - t1;
          const p0x = omt0 * omt0 * ax + 2 * omt0 * t0 * cx + t0 * t0 * bx;
          const p0y = omt0 * omt0 * ay + 2 * omt0 * t0 * cy + t0 * t0 * by;
          const p0z = omt0 * omt0 * az + 2 * omt0 * t0 * cz + t0 * t0 * bz;
          const p1x = omt1 * omt1 * ax + 2 * omt1 * t1 * cx + t1 * t1 * bx;
          const p1y = omt1 * omt1 * ay + 2 * omt1 * t1 * cy + t1 * t1 * by;
          const p1z = omt1 * omt1 * az + 2 * omt1 * t1 * cz + t1 * t1 * bz;

          const vi = (baseIdx + s) * 6;
          cPos[vi] = p0x; cPos[vi + 1] = p0y; cPos[vi + 2] = p0z;
          cPos[vi + 3] = p1x; cPos[vi + 4] = p1y; cPos[vi + 5] = p1z;
          const ai = (baseIdx + s) * 2;
          cAlpha[ai] = alpha;
          cAlpha[ai + 1] = alpha;
        }
      }

      const crossGeom = crossLines.geometry as THREE.BufferGeometry;
      syncAttribute(crossGeom, "position", cPos, 3);
      syncAttribute(crossGeom, "alpha", cAlpha, 1);
      crossGeom.setDrawRange(0, segCount * 2);
    }

    // Highlighted edges (includes sidebar external selected edges imperatively)
    const hl = highlightLinesRef.current;
    if (hl) {
      const extSel = externalSelectedRef.current;
      const extSelEdges = extSel !== null
        ? targetEdges.filter((e) => e.src === extSel || e.dst === extSel)
        : [];
      const combinedEdges = extSelEdges.length > 0
        ? [...highlightedEdges, ...extSelEdges.filter((e) => !highlightedEdges.includes(e))]
        : highlightedEdges;
      const hlCount = combinedEdges.length;
      if (hlCount > 0) {
        // Cross-edges need Bézier segments, so allocate for worst case (8 segs per edge)
        const HL_SUBDIVS = 8;
        const maxSegs = hlCount * HL_SUBDIVS;
        let hlPos = hlEdgePosRef.current;
        if (hlPos.length < maxSegs * 6) {
          hlPos = new Float32Array(maxSegs * 6);
          hlEdgePosRef.current = hlPos;
        }
        let hlAlpha = hlEdgeAlphaRef.current;
        if (hlAlpha.length < maxSegs * 2) {
          hlAlpha = new Float32Array(maxSegs * 2);
          hlEdgeAlphaRef.current = hlAlpha;
        }
        let hlColor = hlEdgeColorRef.current;
        if (hlColor.length < maxSegs * 6) {
          hlColor = new Float32Array(maxSegs * 6);
          hlEdgeColorRef.current = hlColor;
        }

        // Build cross-edge lookup
        const crossKeys = new Set<string>();
        const tes = graph.treeEdgeSet;
        if (tes) {
          for (const e of combinedEdges) {
            if (!tes.has(edgeKey(e.src, e.dst))) crossKeys.add(edgeKey(e.src, e.dst));
          }
        }

        let segIdx = 0;
        for (let i = 0; i < hlCount; i++) {
          const e = combinedEdges[i];
          const s3 = e.src * 3;
          const d3 = e.dst * 3;
          const ax = currentPos.current[s3], ay = currentPos.current[s3 + 1], az = currentPos.current[s3 + 2];
          const bx = currentPos.current[d3], by = currentPos.current[d3 + 1], bz = currentPos.current[d3 + 2];
          // Ring edges (Feature 5): force straight, muted dark-cyan-grey,
          // fixed low alpha so the perimeter doesn't compete with real edges.
          const isRing = e.type === RING_EDGE_TYPE;
          const alpha = isRing
            ? RING_ALPHA
            : Math.min(currentAlpha.current[e.src], currentAlpha.current[e.dst]);
          const ec = isRing ? RING_COLOR : colorForEdgeType(e.type ?? e.label);

          const isCross = !isRing && crossKeys.has(edgeKey(e.src, e.dst));

          if (!isCross) {
            // Straight line — 1 segment
            const vi = segIdx * 6;
            hlPos[vi] = ax; hlPos[vi + 1] = ay; hlPos[vi + 2] = az;
            hlPos[vi + 3] = bx; hlPos[vi + 4] = by; hlPos[vi + 5] = bz;
            const ai = segIdx * 2;
            hlAlpha[ai] = alpha; hlAlpha[ai + 1] = alpha;
            const ci = segIdx * 6;
            hlColor[ci] = ec.r; hlColor[ci + 1] = ec.g; hlColor[ci + 2] = ec.b;
            hlColor[ci + 3] = ec.r; hlColor[ci + 4] = ec.g; hlColor[ci + 5] = ec.b;
            segIdx++;
          } else {
            // Bézier curve — match the cross-edge control point exactly so the
            // highlight overlay tracks the dim curve and its lane offset.
            const lane = edgeLaneInfo.get(e)?.lane ?? 0;
            const { cx, cy, cz } = computeBezierControl(ax, ay, az, bx, by, bz, lane);

            for (let s = 0; s < HL_SUBDIVS; s++) {
              const t0 = s / HL_SUBDIVS, t1 = (s + 1) / HL_SUBDIVS;
              const omt0 = 1 - t0, omt1 = 1 - t1;
              const vi = segIdx * 6;
              hlPos[vi] = omt0 * omt0 * ax + 2 * omt0 * t0 * cx + t0 * t0 * bx;
              hlPos[vi + 1] = omt0 * omt0 * ay + 2 * omt0 * t0 * cy + t0 * t0 * by;
              hlPos[vi + 2] = omt0 * omt0 * az + 2 * omt0 * t0 * cz + t0 * t0 * bz;
              hlPos[vi + 3] = omt1 * omt1 * ax + 2 * omt1 * t1 * cx + t1 * t1 * bx;
              hlPos[vi + 4] = omt1 * omt1 * ay + 2 * omt1 * t1 * cy + t1 * t1 * by;
              hlPos[vi + 5] = omt1 * omt1 * az + 2 * omt1 * t1 * cz + t1 * t1 * bz;
              const ai = segIdx * 2;
              hlAlpha[ai] = alpha; hlAlpha[ai + 1] = alpha;
              const ci = segIdx * 6;
              hlColor[ci] = ec.r; hlColor[ci + 1] = ec.g; hlColor[ci + 2] = ec.b;
              hlColor[ci + 3] = ec.r; hlColor[ci + 4] = ec.g; hlColor[ci + 5] = ec.b;
              segIdx++;
            }
          }
        }

        const hlGeom = hl.geometry as THREE.BufferGeometry;
        syncAttribute(hlGeom, "position", hlPos, 3);
        syncAttribute(hlGeom, "alpha", hlAlpha, 1);
        syncAttribute(hlGeom, "vertexColor", hlColor, 3);
        hlGeom.setDrawRange(0, segIdx * 2);
      } else {
        (hl.geometry as THREE.BufferGeometry).setDrawRange(0, 0);
      }
    }

    // Breadcrumb trail edge (last two nodes only)
    const trail = trailLinesRef.current;
    if (trail) {
      const len = navigationHistory.length;
      if (len >= 2) {
        const srcId = navigationHistory[len - 2];
        const dstId = navigationHistory[len - 1];
        const s3 = srcId * 3;
        const d3 = dstId * 3;
        const tPos = trailEdgePosRef.current;
        tPos[0] = currentPos.current[s3];
        tPos[1] = currentPos.current[s3 + 1];
        tPos[2] = currentPos.current[s3 + 2];
        tPos[3] = currentPos.current[d3];
        tPos[4] = currentPos.current[d3 + 1];
        tPos[5] = currentPos.current[d3 + 2];
        const tAlpha = trailEdgeAlphaRef.current;
        tAlpha[0] = 0.6;
        tAlpha[1] = 0.6;

        const tGeom = trail.geometry as THREE.BufferGeometry;
        syncAttribute(tGeom, "position", tPos, 3);
        syncAttribute(tGeom, "alpha", tAlpha, 1);
        tGeom.setDrawRange(0, 2);
      } else {
        (trail.geometry as THREE.BufferGeometry).setDrawRange(0, 0);
      }
    }


    // Debug cylinders for ALL nodes with children
    const orbit = orbitLinesRef.current;
    if (orbit && SHOW_HELPERS) {
      const orbitGeom = orbit.geometry as THREE.BufferGeometry;
      const TAU = Math.PI * 2;
      const CIRC = 32;
      const normA = (v: number) => ((v % TAU) + TAU) % TAU;

      const selId = viewState.mode === "subgraph" ? viewState.selectedNodeId : -1;
      const subDepthMap = viewState.mode === "subgraph"
        ? (viewState as { depthMap: Map<number, number> }).depthMap : null;

      const getDepth = (id: number): number | undefined => {
        if (viewState.mode === "overview") return graph.initialDepthMap?.get(id);
        if (id === selId) return 0;
        return subDepthMap?.get(id);
      };

      let vi = 0, ai = 0;

      // Pre-size buffers generously (resize below if needed)
      const maxSegs = nodeCount * (CIRC * 2 + 30);
      let posBuf = orbitPosRef.current;
      if (posBuf.length < maxSegs * 6) {
        posBuf = new Float32Array(maxSegs * 6);
        orbitPosRef.current = posBuf;
      }
      let alphaBuf = orbitAlphaRef.current;
      if (alphaBuf.length < maxSegs * 2) {
        alphaBuf = new Float32Array(maxSegs * 2);
        orbitAlphaRef.current = alphaBuf;
      }

      for (let nodeId = 0; nodeId < nodeCount; nodeId++) {
        if (visibleNodes && !visibleNodes.has(nodeId)) continue;
        const nd = getDepth(nodeId);
        if (nd === undefined) continue;

        // Find children (depth + 1)
        const kids: number[] = [];
        for (const n of graph.adj[nodeId]) {
          if (visibleNodes && !visibleNodes.has(n)) continue;
          if (getDepth(n) === nd + 1) kids.push(n);
        }
        if (kids.length === 0) continue;

        const n3 = nodeId * 3;
        const px = currentPos.current[n3];
        const py = currentPos.current[n3 + 1];
        const pz = currentPos.current[n3 + 2];

        let totalR = 0, kidY = py;
        for (const cid of kids) {
          const c3 = cid * 3;
          const dx = currentPos.current[c3] - px;
          const dz = currentPos.current[c3 + 2] - pz;
          totalR += Math.sqrt(dx * dx + dz * dz);
          kidY = currentPos.current[c3 + 1];
        }
        const avgR = totalR / kids.length;
        if (avgR < 0.1) continue;

        const halfGap = (py - kidY) / 2;
        const topY = py + halfGap;
        const botY = py - halfGap;

        const isHovered = nodeId === hovered;
        const baseAlpha = isHovered ? 1.0 : 0.25;

        // Sort children by angle for wedge boundaries
        const childAngles = kids.map(cid => {
          const c3 = cid * 3;
          return normA(Math.atan2(
            currentPos.current[c3 + 2] - pz,
            currentPos.current[c3] - px,
          ));
        }).sort((x, y) => x - y);

        const bounds: number[] = [];
        for (let i = 0; i < childAngles.length; i++) {
          const ca = childAngles[i];
          const cb = i < childAngles.length - 1 ? childAngles[i + 1] : childAngles[0] + TAU;
          bounds.push((ca + cb) / 2);
        }

        // Ensure buffer space
        const needed = vi + (CIRC * 2 + bounds.length * 3) * 6;
        if (needed > posBuf.length) {
          const bigger = new Float32Array(needed * 2);
          bigger.set(posBuf);
          posBuf = bigger;
          orbitPosRef.current = posBuf;
          const biggerA = new Float32Array((needed / 3) * 2);
          biggerA.set(alphaBuf);
          alphaBuf = biggerA;
          orbitAlphaRef.current = alphaBuf;
        }

        // Top ring
        for (let i = 0; i < CIRC; i++) {
          const a1 = (i / CIRC) * TAU;
          const a2 = ((i + 1) / CIRC) * TAU;
          posBuf[vi++] = px + Math.cos(a1) * avgR; posBuf[vi++] = topY; posBuf[vi++] = pz + Math.sin(a1) * avgR;
          posBuf[vi++] = px + Math.cos(a2) * avgR; posBuf[vi++] = topY; posBuf[vi++] = pz + Math.sin(a2) * avgR;
          alphaBuf[ai++] = 0.5 * baseAlpha; alphaBuf[ai++] = 0.5 * baseAlpha;
        }

        // Bottom ring
        for (let i = 0; i < CIRC; i++) {
          const a1 = (i / CIRC) * TAU;
          const a2 = ((i + 1) / CIRC) * TAU;
          posBuf[vi++] = px + Math.cos(a1) * avgR; posBuf[vi++] = botY; posBuf[vi++] = pz + Math.sin(a1) * avgR;
          posBuf[vi++] = px + Math.cos(a2) * avgR; posBuf[vi++] = botY; posBuf[vi++] = pz + Math.sin(a2) * avgR;
          alphaBuf[ai++] = 0.5 * baseAlpha; alphaBuf[ai++] = 0.5 * baseAlpha;
        }

        // Vertical struts + boundary lines on both caps
        for (const bAngle of bounds) {
          const ex = px + Math.cos(bAngle) * avgR;
          const ez = pz + Math.sin(bAngle) * avgR;
          posBuf[vi++] = ex; posBuf[vi++] = topY; posBuf[vi++] = ez;
          posBuf[vi++] = ex; posBuf[vi++] = botY; posBuf[vi++] = ez;
          alphaBuf[ai++] = 0.4 * baseAlpha; alphaBuf[ai++] = 0.7 * baseAlpha;
          posBuf[vi++] = px; posBuf[vi++] = topY; posBuf[vi++] = pz;
          posBuf[vi++] = ex; posBuf[vi++] = topY; posBuf[vi++] = ez;
          alphaBuf[ai++] = 0.2 * baseAlpha; alphaBuf[ai++] = 0.4 * baseAlpha;
          posBuf[vi++] = px; posBuf[vi++] = botY; posBuf[vi++] = pz;
          posBuf[vi++] = ex; posBuf[vi++] = botY; posBuf[vi++] = ez;
          alphaBuf[ai++] = 0.3 * baseAlpha; alphaBuf[ai++] = 0.6 * baseAlpha;
        }
      }

      const totalVerts = vi / 3;
      syncAttribute(orbitGeom, "position", posBuf, 3);
      syncAttribute(orbitGeom, "alpha", alphaBuf, 1);
      orbitGeom.setDrawRange(0, totalVerts);
    }

    // Labels follow animation (10 fps)
    labelAccum.current += delta;
    if (labelAccum.current > 0.033) {
      labelAccum.current = 0;
      // Labels track node positions exactly.
      const lp = new Float32Array(nodeCount * 3);
      for (let i = 0; i < nodeCount; i++) {
        const i3 = i * 3;
        lp[i3] = currentPos.current[i3];
        lp[i3 + 1] = currentPos.current[i3 + 1];
        lp[i3 + 2] = currentPos.current[i3 + 2];
      }
      setLabelPos(lp);
      // Sync approach indicator to React state
      setApproachState({ ...approachRef.current });
    }

    // Animate detail panel opacity
    const targetOpacity = wbNodeId !== null ? 1.0 : 0.0;
    detailPanelOpacity.current += (targetOpacity - detailPanelOpacity.current) * Math.min(1, delta * 4);
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId === undefined) { console.log("[GV] click: no instanceId"); return; }
    if (visibleNodes && !visibleNodes.has(e.instanceId)) { console.log("[GV] click: filtered by visibleNodes", e.instanceId, "set size:", visibleNodes.size); return; }
    e.stopPropagation();
    onGraphClick?.();
    onNodeClick(e.instanceId);
  };


  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    // Camera drag/rotate sweeps nodes under a stationary cursor — those
    // shouldn't count as deliberate hovers.
    if (suppressHover) return;
    if (e.instanceId === undefined) return;
    if (visibleNodes && !visibleNodes.has(e.instanceId)) return;
    e.stopPropagation();
    setHovered(e.instanceId);
    document.body.style.cursor = "pointer";
  };

  const handlePointerOut = () => {
    setHovered(null);
    document.body.style.cursor = "auto";
  };

  // Clear any active hover the moment camera interaction starts, so the
  // highlight on the previously-hovered node doesn't linger through the
  // gesture.
  useEffect(() => {
    if (suppressHover && hovered !== null) {
      setHovered(null);
      document.body.style.cursor = "auto";
    }
  }, [suppressHover, hovered]);

  const edgeOpacity = viewState.mode === "overview" ? 0.08 : 0.3;

  return (
    <>
      <instancedMesh
        key={meshCapacity}
        ref={meshRef}
        args={[undefined, undefined, meshCapacity]}
        frustumCulled={false}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <planeGeometry args={[3, 3]} />
        <shaderMaterial
          key="glow-billboard"
          vertexShader={glowVertexShader}
          fragmentShader={glowFragmentShader}
          transparent
          blending={THREE.NormalBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>

      <lineSegments ref={linesRef} frustumCulled={false}>
        <bufferGeometry />
        <shaderMaterial
          vertexShader={edgeGlowVertexShader}
          fragmentShader={edgeGlowFragmentShader}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          uniforms={{
            color: { value: new THREE.Color(0.2, 0.9, 1.0) },
            opacity: { value: edgeOpacity },
          }}
        />
      </lineSegments>

      <lineSegments ref={crossLinesRef} frustumCulled={false}>
        <bufferGeometry />
        <shaderMaterial
          vertexShader={edgeGlowVertexShader}
          fragmentShader={edgeGlowFragmentShader}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          uniforms={{
            color: { value: new THREE.Color(0.6, 0.3, 0.9) },
            opacity: { value: viewState.mode === "overview" ? 0.15 : 0.5 },
          }}
        />
      </lineSegments>

      <lineSegments ref={highlightLinesRef} frustumCulled={false}>
        <bufferGeometry />
        <shaderMaterial
          vertexShader={edgeHighlightVertexShader}
          fragmentShader={edgeHighlightFragmentShader}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          uniforms={{
            opacity: { value: 0.85 },
          }}
        />
      </lineSegments>

      <lineSegments ref={trailLinesRef} frustumCulled={false}>
        <bufferGeometry />
        <shaderMaterial
          vertexShader={edgeGlowVertexShader}
          fragmentShader={edgeGlowFragmentShader}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          uniforms={{
            color: { value: new THREE.Color(1.0, 0.7, 0.2) },
            opacity: { value: 0.6 },
          }}
        />
      </lineSegments>


      {SHOW_HELPERS && (
        <lineSegments ref={orbitLinesRef} frustumCulled={false}>
          <bufferGeometry />
          <shaderMaterial
            vertexShader={edgeGlowVertexShader}
            fragmentShader={edgeGlowFragmentShader}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
            uniforms={{
              color: { value: new THREE.Color(1.0, 0.5, 0.1) },
              opacity: { value: 0.45 },
            }}
          />
        </lineSegments>
      )}


      {pulses && pulses.length > 0 && (
        <PulseLayer pulses={pulses} positionsRef={currentPos} />
      )}


      {/* Limit hover-neighbor labels to avoid overlap in dense areas */}
      {!minimap && (() => {
        // Build set of hover-neighbor labels to show (capped, closest first)
        const MAX_HOVER_LABELS = 6;
        const shownHoverNeighbors = new Set<number>();
        if (hovered !== null && hoveredRelated && hoveredRelated.size > MAX_HOVER_LABELS) {
          const hovPos = graph.nodes[hovered].position;
          const sorted = [...hoveredRelated]
            .filter(id => id >= 0 && id < graph.nodes.length)
            .map(id => {
              const p = graph.nodes[id].position;
              const dx = p.x - hovPos.x, dy = p.y - hovPos.y, dz = p.z - hovPos.z;
              return { id, dist: dx * dx + dy * dy + dz * dz };
            })
            .sort((a, b) => a.dist - b.dist);
          for (let k = 0; k < Math.min(MAX_HOVER_LABELS, sorted.length); k++) {
            shownHoverNeighbors.add(sorted[k].id);
          }
        }
        // Hovering a proxy directly is the user's request to see every member —
        // lift the dense-hover cap so all group/cluster children get labeled.
        const hoveredType = hovered !== null ? graph.nodes[hovered]?.nodeType : null;
        const isProxyHover = hoveredType === "_group" || hoveredType === "_cluster";
        const useFilteredHover =
          !isProxyHover && hoveredRelated && hoveredRelated.size > MAX_HOVER_LABELS;

        return graph.nodes.map((node, i) => {
          const isExpandedProxy = i === expandedClusterId;
          // Skip invisible nodes, but keep expanded proxy label visible
          if (targets.scales[i] < 0.01 && !isExpandedProxy) return null;

          // Label gating: show for depth 0-1, hovered + neighbors, cursor-revealed, recent
          const isSelected = viewState.mode === "subgraph" && i === viewState.selectedNodeId;
          const isHovered = i === hovered;
          const isHoverNeighbor = useFilteredHover
            ? shownHoverNeighbors.has(i)
            : (hoveredRelated?.has(i) ?? false);
          const isSearchMatch = searchMatches?.has(i) ?? false;
          // Only the top-N hits (by score) earn a text label; the rest stay as
          // glyph spotlights. When the cap set is absent (e.g. tiny result sets)
          // every match is labelable.
          const isSearchLabel = searchMatches
            ? (searchLabelMatches?.has(i) ?? isSearchMatch)
            : false;
          const isRecentNode = recentNodes?.has(i) ?? false;
          const isHighWeight = (graph.nodes[i].weight ?? 0) > 0.5;
          const isProminent = isSelected || isHovered || isHoverNeighbor || isSearchLabel || isRecentNode || isExpandedProxy || isHighWeight;

          // Unstructured nodes: no label unless hovered, selected, or neighbor of selected
          if ((graph.unstructuredNodeIds?.has(i) ?? false) && !isHovered && !isSelected && !isHoverNeighbor) return null;

          // A search hit that didn't make the label cap: keep it a glyph-only
          // spotlight (color/size handled in the shader). Reveal its label only
          // when the user reaches for it via hover/selection/expansion.
          if (isSearchMatch && !isSearchLabel && !isHovered && !isHoverNeighbor && !isSelected && !isExpandedProxy && !isRecentNode) {
            return null;
          }

          // Hover focus: when something is hovered, suppress every label
          // that isn't hovered / a hover neighbor / explicitly highlighted
          // (selected, search hit, recent). Lets the user read the local
          // neighborhood without competing labels elsewhere.
          if (hovered !== null && !isHovered && !isHoverNeighbor && !isSelected && !isSearchLabel && !isRecentNode && !isExpandedProxy) {
            return null;
          }

          // Depth-based filter: allow depth 0-1, hide deeper unless prominent
          if (!isProminent) {
            if (viewState.mode === "overview") {
              const depth = graph.initialDepthMap?.get(i) ?? 0;
              if (depth > 1) return null;
            } else {
              const selectedId = viewState.selectedNodeId;
              const depth = i === selectedId ? 0 : viewState.depthMap.get(i);
              if (depth === undefined) return null;
              if (depth !== -1 && depth > 1) return null;
            }
          }

          const i3 = i * 3;
          // Use target position if labelPos hasn't grown yet (newly added nodes)
          const lx = i3 + 2 < labelPos.length ? labelPos[i3] : targets.positions[i3];
          const ly = i3 + 2 < labelPos.length ? labelPos[i3 + 1] : targets.positions[i3 + 1];
          const lz = i3 + 2 < labelPos.length ? labelPos[i3 + 2] : targets.positions[i3 + 2];
          const isExecuting = node.status === "executing";

          // Style tiers: hovered > top-hit > selected > hover-neighbor > recent > default
          const recentAge = isRecentNode ? (Date.now() - recentNodes!.get(i)!) / 3000 : 1;
          const recentOpacity = Math.max(0, 1 - recentAge);
          const topRank = topMatchRanks?.get(i);
          const isTopHit = topRank !== undefined;
          const topTint = topRank === 0
            ? "rgba(255, 215, 80, 0.98)"   // gold for the best hit
            : "rgba(120, 200, 255, 0.95)"; // cool blue for ranks 1-2
          const labelColor = isHovered ? "rgba(255,255,255,0.95)"
            : isTopHit ? topTint
              : isSelected ? "rgba(100,220,255,0.95)"
                : isHoverNeighbor ? "rgba(200,200,200,0.85)"
                  : isRecentNode ? `rgba(100,255,180,${(0.5 + 0.45 * recentOpacity).toFixed(2)})`
                    : "rgba(190,200,210,0.75)";
          const labelSize = isHovered || isSelected ? 15
            : isTopHit ? (topRank === 0 ? 17 : 15)
              : isRecentNode ? 14
                : isHoverNeighbor ? 13
                  : 12;
          const labelWeight = isHovered || isSelected || isExpandedProxy || isTopHit ? 700 : 500;

          // Placement priority: hovered > selected > top-hit > expanded-proxy >
          // search-match > recent > hover-neighbor > high-weight > base. Used
          // by the label planner to decide which labels keep their default slot
          // and which get pushed/displaced when boxes collide.
          const placementPriority = isHovered ? 100
            : isSelected ? 90
              : isTopHit ? (topRank === 0 ? 85 : 80)
                : isExpandedProxy ? 75
                  : isSearchLabel ? 70
                    : isRecentNode ? 65
                      : isHoverNeighbor ? 60
                        : isHighWeight ? 50
                          : 10;

          const iconColor = node.icon
            ? isHovered
              ? "rgb(255, 51, 51)"
              : isHoverNeighbor
                ? "rgb(204, 38, 38)"
                : isExecuting
                  ? "rgb(51, 255, 102)"
                  : `rgb(${Math.round(currentColor.current[i3] * 255)}, ${Math.round(currentColor.current[i3 + 1] * 255)}, ${Math.round(currentColor.current[i3 + 2] * 255)})`
            : undefined;

          return (
            <group key={node.id}>
              {node.icon && (
                <Html
                  position={[lx, ly, lz]}
                  style={{
                    color: iconColor,
                    fontSize: 36,
                    pointerEvents: "none",
                    userSelect: "none",
                    transform: "translate(-50%, -50%)",
                    textShadow: `0 0 8px ${iconColor}, 0 0 20px ${iconColor}`,
                    lineHeight: 1,
                    filter: "drop-shadow(0 0 4px rgba(0,0,0,0.9))",
                  }}
                  center
                >
                  {node.icon}
                </Html>
              )}
              <Html
                position={[lx, ly, lz]}
                // Top-3 hits get a zIndexRange above the drei default
                // ([16777271, 0]) so their labels layer above sibling labels.
                zIndexRange={isTopHit ? [100000000, 16777272] : undefined}
                style={{
                  pointerEvents: isExpandedProxy ? "auto" : "none",
                  userSelect: "none",
                  cursor: isExpandedProxy ? "pointer" : undefined,
                }}
              >
                <div
                  ref={(el) => {
                    const reg = labelRegistryRef.current;
                    if (el) reg.set(i, el);
                    else reg.delete(i);
                  }}
                  data-priority={placementPriority}
                  style={{
                    // Baseline = label centered below the anchor (-50% x, +20 y).
                    // --lbl-ex / --lbl-ey are written each tick by the placement
                    // planner to push the label into a non-colliding slot.
                    transform: "translate(calc(-50% + var(--lbl-ex, 0px)), calc(20px + var(--lbl-ey, 0px)))",
                    transition: "transform 180ms ease-out",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                <div style={{
                  color: isExpandedProxy ? "rgba(100,220,255,0.95)" : labelColor,
                  fontSize: isExpandedProxy ? 14 : labelSize,
                  fontFamily: "'Barlow', sans-serif",
                  fontWeight: labelWeight,
                  letterSpacing: "0.3px",
                  whiteSpace: "nowrap",
                  textShadow: "0 0 6px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.7)",
                }}>
                  {isExpandedProxy
                    ? <span onClick={(e) => { e.stopPropagation(); onNodeClick(i); }}>{node.label}</span>
                    : (isSearchMatch && searchTerm)
                      ? renderHighlightedLabel(node.label, searchTerm)
                      : node.label}
                </div>
                {!isExpandedProxy && (() => {
                  const showTypePill =
                    node.nodeType &&
                    node.nodeType !== "_group" &&
                    node.nodeType !== "_cluster";
                  const types = edgeTypesByNeighbor.get(i);
                  const hasEdges = types && types.size > 0;
                  if (!showTypePill && !hasEdges) return null;
                  return (
                    <div style={{
                      display: "flex",
                      flexWrap: "wrap",
                      justifyContent: "center",
                      alignItems: "center",
                      gap: 3,
                    }}>
                      {showTypePill && (() => {
                        const tc = colorForNodeType(node.nodeType!);
                        const tint = `rgb(${Math.round(tc.r * 255)}, ${Math.round(tc.g * 255)}, ${Math.round(tc.b * 255)})`;
                        const iconName = nodeTypeIcons?.[node.nodeType!.toLowerCase()];
                        const Icon = getSchemaIcon(iconName);
                        return (
                          <div style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                            padding: "0px 5px 0px 1px",
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.025)",
                            border: "1px solid rgba(255,255,255,0.07)",
                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                            fontSize: 9,
                            color: "rgba(190,205,215,0.78)",
                            letterSpacing: "0.02em",
                            lineHeight: 1.4,
                            whiteSpace: "nowrap",
                          }}>
                            <span style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 13, height: 13,
                              borderRadius: 2,
                              background: `${tint}1f`,
                              border: `1px solid ${tint}55`,
                              color: tint,
                              lineHeight: 1,
                            }}>
                              <Icon size={9} strokeWidth={2} />
                            </span>
                            {node.nodeType!.toLowerCase()}
                          </div>
                        );
                      })()}
                      {hasEdges && Array.from(types!).map((t) => {
                        const ec = colorForEdgeType(t);
                        return (
                          <div key={t} style={{
                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                            fontSize: 9,
                            color: rgbToCss(ec, 0.95),
                            background: rgbToCss(ec, 0.12),
                            border: `1px solid ${rgbToCss(ec, 0.55)}`,
                            padding: "0px 4px",
                            borderRadius: 999,
                            letterSpacing: "0.06em",
                            lineHeight: 1.4,
                            whiteSpace: "nowrap",
                            textShadow: "0 0 4px rgba(0,0,0,0.9)",
                          }}>
                            {t}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                </div>
              </Html>
            </group>
          );
        });
      })()}

      {!minimap && graph.nodes.map((node, i) => {
        // Only show badge for loadable nodes that are actively loading
        if (!node.loaderId) return null;
        if (node.progress == null || node.progress < 0) return null;
        if (targets.scales[i] < 0.01) return null;
        const badgeText = "loading\u2026";
        return (
          <Html
            key={`prog-${node.id}`}
            position={[
              labelPos[i * 3],
              labelPos[i * 3 + 1],
              labelPos[i * 3 + 2],
            ]}
            style={{
              pointerEvents: "none",
              userSelect: "none",
              transform: "translate(12px, -28px)",
            }}
            center
          >
            <div style={{
              background: "rgba(0, 20, 5, 0.85)",
              border: "1px solid rgba(0, 255, 100, 0.5)",
              borderRadius: "4px",
              padding: "1px 5px",
              color: "rgba(0, 255, 100, 0.95)",
              fontSize: "10px",
              fontFamily: "'Barlow', sans-serif",
              fontWeight: 600,
              whiteSpace: "nowrap",
              textShadow: "0 0 6px rgba(0,255,100,0.6)",
              boxShadow: "0 0 8px rgba(0,255,100,0.15)",
            }}>
              {badgeText}
            </div>
          </Html>
        );
      })}

      {/* Close button — appears over the selected node so the user can pop
          back to overview without aiming at the bottom-right pill. */}
      {!minimap && viewState.mode === "subgraph" && onResetView && (() => {
        const sel = viewState.selectedNodeId;
        const selNode = graph.nodes[sel];
        if (!selNode) return null;
        const i3 = sel * 3;
        const lx = i3 + 2 < labelPos.length ? labelPos[i3] : selNode.position.x;
        const ly = i3 + 2 < labelPos.length ? labelPos[i3 + 1] : selNode.position.y;
        const lz = i3 + 2 < labelPos.length ? labelPos[i3 + 2] : selNode.position.z;
        return (
          <Html
            key={`reset-${sel}`}
            position={[lx, ly, lz]}
            center
            style={{
              userSelect: "none",
              transform: "translate(28px, -28px)",
              zIndex: 10,
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onResetView();
              }}
              title="Reset view"
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                background: "rgba(8, 12, 22, 0.85)",
                border: "1px solid rgba(120, 200, 255, 0.45)",
                color: "rgba(180, 220, 240, 0.9)",
                fontFamily: "ui-monospace, Menlo, monospace",
                fontSize: 13,
                lineHeight: "20px",
                cursor: "pointer",
                padding: 0,
                boxShadow: "0 0 8px rgba(120, 200, 255, 0.18)",
                backdropFilter: "blur(8px)",
              }}
            >
              ×
            </button>
          </Html>
        );
      })()}

      {/* Approach hint — "scroll to inspect" */}
      {approachState.nodeId >= 0 && approachState.progress > 0.05 && wbNodeId === null && (() => {
        const aNode = graph.nodes[approachState.nodeId];
        const p = approachState.progress;
        return (
          <Html
            position={[aNode.position.x, aNode.position.y, aNode.position.z]}
            center
            style={{
              pointerEvents: "none",
              userSelect: "none",
              opacity: p * 0.9,
              transform: `translateY(-48px) scale(${0.8 + 0.2 * p})`,
              transition: "opacity 0.15s ease-out",
            }}
          >
            <div style={{
              background: "rgba(5, 8, 18, 0.85)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(77, 217, 232, 0.3)",
              borderRadius: 8,
              padding: "5px 12px",
              color: "rgba(77, 217, 232, 0.9)",
              fontSize: 11,
              fontFamily: "'Barlow', sans-serif",
              fontWeight: 500,
              whiteSpace: "nowrap",
              textShadow: "0 0 8px rgba(77, 217, 232, 0.3)",
              boxShadow: `0 0 ${12 + 8 * p}px rgba(77, 217, 232, ${0.08 + 0.12 * p})`,
              letterSpacing: "0.3px",
            }}>
              scroll to inspect
            </div>
          </Html>
        );
      })()}

      {/* Node detail panel (whiteboard zoom) — screen-space overlay, always faces camera */}
      {wbNodeId !== null && detailPanelOpacity.current > 0.01 && (() => {
        const wbNode = graph.nodes[wbNodeId];
        return (
          <Html
            position={[wbNode.position.x, wbNode.position.y, wbNode.position.z]}
            center
            style={{
              opacity: detailPanelOpacity.current,
              transform: `scale(${0.85 + 0.15 * detailPanelOpacity.current})`,
              pointerEvents: "auto",
              transition: "opacity 0.05s ease-out",
            }}
          >
            <NodeDetailPanel
              node={wbNode}
              graph={graph}
              viewState={viewState}
              onClose={() => onExitWhiteboard?.()}
              onNavigate={(id) => onDetailNavigate?.(id)}
            />
          </Html>
        );
      })()}

    </>
  );
}