"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { CameraControls, Html } from "@react-three/drei"
import { EffectComposer, Bloom } from "@react-three/postprocessing"
import { Vector3 } from "three"
import * as THREE from "three"
import CameraControlsImpl from "camera-controls"
import {
  extractSubgraph,
  GraphView,
  OffscreenIndicators,
  PrevNodeIndicator,
} from "@/graph-viz-kit"
import type { Graph, ViewState } from "@/graph-viz-kit"
import type { GraphNode as ApiNode, GraphEdge as ApiEdge } from "@/lib/graph-api"
import { getAttachables } from "@/lib/graph-api"
import { useGraphStore } from "@/stores/graph-store"
import { useAppStore } from "@/stores/app-store"
import type { SchemaNode } from "@/app/ontology/page"
import { HoverPreviewCard } from "./hover-preview-card"
import {
  NodeMorph,
  CaseBoardAnimator,
  useCaseBoardStore,
  GroupMorph,
  computeBalancedLayout,
} from "@/components/case-board"
import {
  apiToGraph,
  applyLayout,
  appendToGraph,
  recomputeDescendantLayout,
  describeSubgraph,
  DEPTH_SHRINK,
  rescaleAroundAnchor,
  restoreOriginalPositions,
  type GraphModel,
} from "./graph-transform"
import { metroSeries } from "@/data/metro"
import {
  MetroLinesLayer,
  MetroStationBullets,
  MetroLegend,
  statusToState,
  readStationLines,
  type StationState,
} from "./metro-overlay"
import {
  StationHudScene,
  StationZonePlate,
  type SceneNeighbor,
} from "./station-hud-scene"

// Max number of search hits that keep a text label at once. Beyond this the
// view becomes an unreadable pile of overlapping labels; the rest of the hits
// stay as glyph-only spotlights and reveal their label on hover.
const SEARCH_LABEL_CAP = 15

interface CamTarget {
  posX: number
  posY: number
  posZ: number
  lookX: number
  lookY: number
  lookZ: number
}

function computeCamTarget(graph: Graph, nodeId: number, currentAzimuth: number): CamTarget {
  const p = graph.nodes[nodeId].position
  const treeKids = graph.childrenOf?.get(nodeId) ?? []
  const kidPts = treeKids.map((nid) => graph.nodes[nid]?.position).filter(Boolean)
  let maxRadius = 0
  for (const pt of kidPts) {
    const dx = pt.x - p.x
    const dz = pt.z - p.z
    maxRadius = Math.max(maxRadius, Math.sqrt(dx * dx + dz * dz))
  }
  const fovRad = (50 / 2) * (Math.PI / 180)
  const cameraHeight = Math.max(5, (maxRadius * 1.05) / Math.tan(fovRad))
  // Tiny in-plane offset so setLookAt's up-vector math (worldUp × forward)
  // doesn't go degenerate when the camera ends up directly above the node.
  // Direction follows the user's *current* camera azimuth so the final view
  // preserves their orbit angle instead of snapping to a canonical +Z bias.
  const offset = 0.1
  const ox = Math.sin(currentAzimuth) * offset
  const oz = Math.cos(currentAzimuth) * offset
  return {
    posX: p.x + ox,
    posY: p.y + cameraHeight,
    posZ: p.z + oz,
    lookX: p.x,
    lookY: p.y,
    lookZ: p.z,
  }
}

const OVERVIEW_CAM: CamTarget = {
  posX: 0, posY: 80, posZ: 0.1,
  lookX: 0, lookY: 0, lookZ: 0,
}

// Camera pose for a selected metro Station — an angled tactical view instead
// of the straight-overhead subgraph pose, so the diegetic station HUD (radar
// rings on the ground, holo cards floating on beams) reads with depth like a
// game map. Preserves the user's current orbit azimuth.
const STATION_CAM_DIST = 19
const STATION_CAM_ELEV = (38 * Math.PI) / 180

function computeStationCamTarget(
  graph: Graph,
  nodeId: number,
  currentAzimuth: number,
): CamTarget {
  const p = graph.nodes[nodeId].position
  const horiz = STATION_CAM_DIST * Math.cos(STATION_CAM_ELEV)
  const vert = STATION_CAM_DIST * Math.sin(STATION_CAM_ELEV)
  return {
    posX: p.x + Math.sin(currentAzimuth) * horiz,
    posY: p.y + vert,
    posZ: p.z + Math.cos(currentAzimuth) * horiz,
    lookX: p.x,
    // Aim a touch above the node so the floating cards sit comfortably in
    // frame rather than crowding the top edge.
    lookY: p.y + 2.2,
    lookZ: p.z,
  }
}

// Press-and-hold duration (ms) on the selected node to open the 2D case view.
const CASE_VIEW_HOLD_MS = 600

function smoothstep(x: number) {
  return x * x * (3 - 2 * x)
}

// Lives inside the R3F Canvas so it can read state.controls — which only
// becomes non-null after drei's <CameraControls makeDefault /> has actually
// mounted and registered itself. A useEffect in the outer component would
// race the mount and miss the instance entirely.
function CameraInteractionTracker({
  onChange,
}: {
  onChange: (active: boolean) => void
}) {
  const controls = useThree((s) => s.controls) as
    | (CameraControlsImpl & {
        addEventListener: (t: string, fn: () => void) => void
        removeEventListener: (t: string, fn: () => void) => void
      })
    | null
  useEffect(() => {
    if (!controls) return
    const onStart = () => onChange(true)
    const onEnd = () => onChange(false)
    controls.addEventListener("controlstart", onStart)
    controls.addEventListener("controlend", onEnd)
    return () => {
      controls.removeEventListener("controlstart", onStart)
      controls.removeEventListener("controlend", onEnd)
    }
  }, [controls, onChange])
  return null
}

// Drives the camera with GraphView's exact lerp formula so the camera
// arrives in lockstep with the geometry inflation. Without this the camera
// (CameraControls smoothDamp) and the nodes (smoothstep + delta/1.2 in
// GraphView) use different curves, and the selected node visibly drifts off
// to the side mid-transition.
function CameraSync({
  camRef,
  targetRef,
}: {
  camRef: React.RefObject<CameraControlsImpl | null>
  targetRef: React.RefObject<{
    target: CamTarget
    progress: number
    pos: [number, number, number]
    look: [number, number, number]
  }>
}) {
  // While the case board is opening/open, the CaseBoardAnimator owns the
  // camera (it pulls back to the board pose). CameraSync must yield — otherwise
  // its in-flight select fly-in keeps overriding the board move every frame,
  // leaving the camera stuck close to the focal (huge focal card, tiny faraway
  // group cards). This was the "first open looks broken, reopen fixes it" bug:
  // on reopen the fly-in had already settled so there was nothing to fight.
  const morphActive = useCaseBoardStore((s) => s.morphTarget > 0.001)
  useFrame((_, delta) => {
    const cam = camRef.current
    if (!cam) return
    const state = targetRef.current
    if (morphActive) {
      // Mark the fly-in done so it doesn't resume when the board closes.
      state.progress = 1
      return
    }
    // Only drive the camera while a transition is in flight. Once it settles,
    // hand control back to CameraControls so the user can orbit/pan/zoom.
    if (state.progress >= 1) return
    state.progress = Math.min(1, state.progress + delta / 1.2)
    const t = smoothstep(state.progress)
    const tgt = state.target
    state.pos[0] += (tgt.posX - state.pos[0]) * t
    state.pos[1] += (tgt.posY - state.pos[1]) * t
    state.pos[2] += (tgt.posZ - state.pos[2]) * t
    state.look[0] += (tgt.lookX - state.look[0]) * t
    state.look[1] += (tgt.lookY - state.look[1]) * t
    state.look[2] += (tgt.lookZ - state.look[2]) * t
    cam.setLookAt(
      state.pos[0], state.pos[1], state.pos[2],
      state.look[0], state.look[1], state.look[2],
      false,
    )
  })
  return null
}

// Press-and-hold target on the selected node. Pressing starts filling a
// circular progress ring; holding it to completion opens the in-3D case board.
// Replaces the old ⤢ button and the dolly-in auto-open — holding the node IS
// the gesture now. A quick click just flickers and cancels, so it can't open
// accidentally.
function CaseViewTrigger({
  graph,
  selectedNodeId,
  selectedApiNode,
  onOpen,
  disabled,
}: {
  graph: Graph
  selectedNodeId: number | null
  selectedApiNode: ApiNode | null
  onOpen: (node: ApiNode) => void
  disabled: boolean
}) {
  const [progress, setProgress] = useState(0)
  const rafRef = useRef(0)
  const startRef = useRef(0)
  const holdingRef = useRef(false)

  const stop = useCallback(() => {
    holdingRef.current = false
    cancelAnimationFrame(rafRef.current)
    setProgress(0)
  }, [])

  const start = useCallback(() => {
    if (!selectedApiNode) return
    holdingRef.current = true
    startRef.current = performance.now()
    const tick = () => {
      if (!holdingRef.current) return
      const t = Math.min(1, (performance.now() - startRef.current) / CASE_VIEW_HOLD_MS)
      setProgress(t)
      if (t >= 1) {
        holdingRef.current = false
        setProgress(0)
        onOpen(selectedApiNode)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [selectedApiNode, onOpen])

  // Cancel any in-flight hold when the selection changes, the board opens, or
  // the component unmounts. Done in the effect CLEANUP (not the body) so the
  // reset's setState doesn't run synchronously inside the effect.
  useEffect(() => stop, [selectedNodeId, disabled, stop])

  if (disabled || selectedNodeId === null || !selectedApiNode) return null
  const node = graph.nodes[selectedNodeId]
  if (!node) return null
  const p = node.position

  const SIZE = 64
  const R = 26
  const C = 2 * Math.PI * R
  const holding = progress > 0
  return (
    <Html
      position={[p.x, p.y, p.z]}
      center
      style={{ pointerEvents: "none" }}
      zIndexRange={[20, 0]}
    >
      <div
        onPointerDown={(e) => {
          e.stopPropagation()
          start()
        }}
        onPointerUp={(e) => {
          e.stopPropagation()
          stop()
        }}
        onPointerLeave={stop}
        onPointerCancel={stop}
        title="Hold to open case view"
        style={{
          width: SIZE,
          height: SIZE,
          borderRadius: "50%",
          pointerEvents: "auto",
          cursor: "pointer",
          touchAction: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* rotate -90° so the ring fills from the top, clockwise */}
        <svg width={SIZE} height={SIZE} style={{ transform: "rotate(-90deg)" }}>
          {/* Faint idle ring — marks the node as "hold to open". */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="rgba(77,217,232,0.22)"
            strokeWidth={2.5}
          />
          {/* Progress arc — fills as the user holds. */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="#4dd9e8"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress)}
            style={{
              opacity: holding ? 1 : 0,
              filter: "drop-shadow(0 0 6px rgba(77,217,232,0.6))",
            }}
          />
        </svg>
      </div>
    </Html>
  )
}

// Debug overlay — fixed world reference + per-frame crosshairs for camera and
// click-anchor positions. Lets you see whether the selected node, the camera
// target, and the camera look-at are converging or diverging across a layout
// rebuild. Render *after* GraphView so the markers draw on top.
function DebugMarkers({
  graph,
  selectedNodeId,
  camAnim,
  clickAnchorRef,
  cameraRef,
}: {
  graph: Graph
  selectedNodeId: number | null
  camAnim: React.RefObject<{
    target: CamTarget
    progress: number
    pos: [number, number, number]
    look: [number, number, number]
  }>
  clickAnchorRef: React.RefObject<{
    refId: string
    pos: { x: number; y: number; z: number }
  } | null>
  cameraRef: React.RefObject<CameraControlsImpl | null>
}) {
  const ghostRef = useRef<THREE.Group>(null)
  const liveSelRef = useRef<THREE.Group>(null)
  const camTargetRef = useRef<THREE.Group>(null)
  const camLookRef = useRef<THREE.Group>(null)
  const lookTmp = useRef(new Vector3())

  useFrame(() => {
    // Yellow: click-anchor ghost. World-fixed at the position the node had
    // when the user clicked. Hidden until the first click.
    const anchor = clickAnchorRef.current
    if (ghostRef.current) {
      if (anchor) {
        ghostRef.current.position.set(anchor.pos.x, 0.1, anchor.pos.z)
        ghostRef.current.visible = true
      } else {
        ghostRef.current.visible = false
      }
    }

    // Green: where the selected node IS right now (live position from graph).
    // If this diverges from yellow, the layout has moved the node since click.
    if (liveSelRef.current) {
      if (selectedNodeId != null && graph.nodes[selectedNodeId]) {
        const p = graph.nodes[selectedNodeId].position
        liveSelRef.current.position.set(p.x, 0.15, p.z)
        liveSelRef.current.visible = true
      } else {
        liveSelRef.current.visible = false
      }
    }

    // Magenta: where the camera is heading (target.lookX/Y/Z). Frozen once
    // setCamTarget runs, so if the node moves after click, this stays behind.
    if (camTargetRef.current) {
      const t = camAnim.current.target
      camTargetRef.current.position.set(t.lookX, 0.2, t.lookZ)
    }

    // Cyan: where the camera is actually looking RIGHT NOW. Read from the
    // controls so we see the lerped value, not the target.
    if (camLookRef.current) {
      const cam = cameraRef.current
      if (cam) {
        cam.getTarget(lookTmp.current)
        camLookRef.current.position.set(
          lookTmp.current.x,
          0.25,
          lookTmp.current.z
        )
      }
    }
  })

  // Rings lie flat in XZ plane (rotated -π/2 on X) so the overhead camera
  // sees them as circles. Different radii so they don't fully overlap.
  return (
    <>
      {/* World axes at the origin (R=X, G=Y, B=Z), length 30. */}
      <axesHelper args={[30]} />
      {/* Ground grid at y=0. 200u total, 40 divisions. */}
      <gridHelper args={[200, 40, 0x444466, 0x222233]} position={[0, -0.05, 0]} />

      {/* Yellow — click anchor ghost */}
      <group ref={ghostRef} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.6, 2.0, 48]} />
          <meshBasicMaterial color={0xffd11a} transparent opacity={0.85} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Green — live selected node tracker */}
      <group ref={liveSelRef} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.2, 2.55, 48]} />
          <meshBasicMaterial color={0x33ff66} transparent opacity={0.9} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Magenta — camera target (where camera is heading) */}
      <group ref={camTargetRef}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.75, 3.1, 48]} />
          <meshBasicMaterial color={0xff33dd} transparent opacity={0.9} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Cyan — camera look-at (where camera is looking right now) */}
      <group ref={camLookRef}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[3.3, 3.65, 48]} />
          <meshBasicMaterial color={0x33e6ff} transparent opacity={0.9} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  )
}

// Camera placement for the case-board view, expressed as an offset from the
// focal node. The same vector is used by CaseBoardAnimator (to setLookAt the
// camera) and by CaseBoardMorphLayer (to compute the plane the neighbor ring
// sits in). Keep them in sync so cards face the camera at full morph.
export const CASE_BOARD_CAM_OFFSET = new Vector3(28, 14, 11.2)
// Board camera fov (matches the <Canvas> camera) and its resting distance from
// the focal (the length of the offset above). Together with the viewport
// height these give the world-units-per-screen-pixel scale at the board pose,
// so the px-space card layout can be converted to world positions that match
// exactly what's rendered — see CaseBoardMorphLayer.
const BOARD_FOV = 50
const BOARD_CAM_DISTANCE = CASE_BOARD_CAM_OFFSET.length()
// Breathing room between cards, in SCREEN PIXELS (the space the layout works
// in) — applied uniformly on every side now that the packer uses measured card
// sizes. Sized so the relationship pill can sit near the SOURCE end of the edge
// (≈48–72px wide) and still leave a visible dashed line running on to the
// target, instead of the pill covering the whole edge. Single density knob.
const BOARD_GAP_PX = 130

// Groups with this many members or fewer render as individual cards instead of
// a group container. A deck only earns its container when there are enough
// same-(type, relationship) neighbors that loose cards would clutter — so a
// pair or a trio stays as plain cards and stacking begins at 4+. (1 = group
// every pair, which over-grouped a 2-neighbor station into a "STATION 2" deck.)
const HYBRID_THRESHOLD = 3

// A single-neighbor card or a collapsed group card placed on the board.
type BoardItem =
  | { kind: "node"; id: string; type: string; edgeLabel: string; node: ApiNode }
  | { kind: "group"; id: string; type: string; edgeLabel: string; members: ApiNode[] }

// Real card footprint in PIXELS — half-width/half-height — kept in sync with
// the actual CaseCard / CaseGroup CSS dimensions. Estimating height honestly is
// what prevents tall cards (e.g. a Person card with a description) from
// overlapping their neighbors. Circular collision can't capture aspect ratio.
function boardItemBoxPx(item: BoardItem): { w: number; h: number } {
  if (item.kind === "node") {
    // Neighbor CaseCard: width 240; height = hero(132) + padding + pill + title
    // (+ up to 3 field rows ~46px each). Estimate from the fields present.
    const props = item.node.properties as Record<string, unknown> | undefined
    let fieldRows = 0
    if (props) {
      for (const k of Object.keys(props)) {
        if (fieldRows >= 3) break
        const v = props[k]
        if ((typeof v === "string" && v.length > 0) || typeof v === "number") fieldRows++
      }
    }
    const h = 132 + 64 + fieldRows * 50
    return { w: 240, h }
  }
  // Group CaseGroup: defaults to the STACKED deck, whose footprint is roughly a
  // single member tile plus the offset backs + header + meta row. The real size
  // is measured once rendered (and re-measured when unstacked), so this only
  // needs to be close for the first pre-measurement frame.
  return { w: 220, h: 250 }
}

// Focal CaseCard footprint (width 300; hero 170 + body with description +
// up to 4 fields). Generous height so neighbors keep clear of it.
const BOARD_FOCAL_BOX_PX = { w: 300, h: 470 }

// Peak opacity of the cream backdrop. Below 1 lets a hint of the 3D scene
// bleed through so the board reads as "on top of the world" rather than a
// hard cut. Lower = more visible 3D ghost; 1 = fully opaque cream.
export const CASE_BOARD_BACKDROP_OPACITY = 0.92

// Z-index layering for the case-board overlays. drei's <Html /> defaults to
// zIndexRange [16777271, 0] for its label portals, so anything that has to
// occlude or sit above GraphView's labels needs values past 16.77M.
export const CASE_BOARD_Z = {
  backdrop: 16777300, // cream paper above 3D labels
  connectors: 16777350, // SVG lines + dots: between cream + cards (tunnel under)
  cardFar: 16777400,
  cardNear: 16777500,
  connectorLabels: 16777700, // edge pills: ABOVE cards so they never clip
  button: 16778000,
}

// World→screen projection shared between the in-Canvas emitter and the
// out-of-Canvas connectors SVG. Mutable ref so the SVG can update path d
// attributes via its own rAF without re-rendering React 60fps. One entry
// per visible node (focal + neighbors); the SVG looks each end up by refId
// when drawing per-edge connectors.
export type ProjectionsRef = {
  positions: Map<string, { x: number; y: number }>
}

// Inside Canvas: each frame, project every visible (focal + neighbor)
// interpolated world position to screen coords and write into the shared
// ref. Renders nothing — purely a side-effect bridge to the SVG outside
// the Canvas.
function ProjectionEmitter({
  projectionsRef,
  items,
  morphProgress,
}: {
  projectionsRef: React.RefObject<ProjectionsRef>
  items: { id: string; origin: [number, number, number]; target: [number, number, number] }[]
  morphProgress: number
}) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  useFrame(() => {
    const r = projectionsRef.current
    if (!r) return
    const t = Math.max(0, Math.min(1, morphProgress))
    const next = new Map<string, { x: number; y: number }>()
    for (const item of items) {
      const wx = item.origin[0] + (item.target[0] - item.origin[0]) * t
      const wy = item.origin[1] + (item.target[1] - item.origin[1]) * t
      const wz = item.origin[2] + (item.target[2] - item.origin[2]) * t
      const v = new Vector3(wx, wy, wz).project(camera)
      next.set(item.id, {
        x: (v.x + 1) * 0.5 * size.width,
        y: (-v.y + 1) * 0.5 * size.height,
      })
    }
    r.positions = next
  })
  return null
}

// Renders the in-3D case board. The focal node + 1-hop neighbors get laid
// out via a force-directed sim in the plane perpendicular to the case-
// board camera direction — neighbors that share edges cluster naturally
// instead of all hanging off a perfect star. Mounts the camera animator
// + projection emitter alongside the cards.
function CaseBoardMorphLayer({
  graph,
  refIdToIndex,
  nodes,
  selectedRefId,
  morphProgress,
  cameraRef,
  projectionsRef,
  cardPortalRef,
  cardElsRef,
  items,
}: {
  graph: Graph
  refIdToIndex: Map<string, number>
  nodes: ApiNode[]
  selectedRefId: string
  morphProgress: number
  cameraRef: React.RefObject<CameraControlsImpl | null>
  projectionsRef: React.RefObject<ProjectionsRef>
  cardPortalRef: React.RefObject<HTMLDivElement | null>
  cardElsRef: React.RefObject<Map<string, HTMLElement>>
  items: BoardItem[]
}) {
  const selectedIdx = refIdToIndex.get(selectedRefId)
  const selectedNode = nodes.find((n) => n.ref_id === selectedRefId) ?? null
  // Viewport height drives the px→world conversion for the card layout below.
  const viewportHeight = useThree((s) => s.size.height)

  // The focal node's attached images. Attachables come from a separate
  // server-side `edge_props` query (getAttachables), NOT the regular 1-hop
  // neighbourhood the board lays out — so without this fetch they'd never
  // appear on the board. Embedded as a strip inside the focal card. Keyed by
  // refId so a previous node's images never flash while a new fetch is in
  // flight (and so we don't setState synchronously inside the effect).
  const [imagesResult, setImagesResult] = useState<{ refId: string; images: ApiNode[] }>(
    () => ({ refId: "", images: [] }),
  )
  useEffect(() => {
    const controller = new AbortController()
    getAttachables(selectedRefId, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        setImagesResult({
          refId: selectedRefId,
          images: (data.nodes ?? []).filter(
            (n) => n.node_type === "Image" && n.ref_id !== selectedRefId,
          ),
        })
      })
      .catch(() => {
        if (!controller.signal.aborted) setImagesResult({ refId: selectedRefId, images: [] })
      })
    return () => controller.abort()
  }, [selectedRefId])
  const attachedImages = imagesResult.refId === selectedRefId ? imagesResult.images : []
  const focalWorld = useMemo<[number, number, number] | null>(() => {
    if (selectedIdx === undefined) return null
    const p = graph.nodes[selectedIdx]?.position
    if (!p) return null
    return [p.x, p.y, p.z]
  }, [graph, selectedIdx])

  // Real on-screen card sizes (CSS px). offsetWidth/Height are LAYOUT sizes, so
  // they ignore the board layer's scale transform — exactly the px footprint the
  // packer needs. The layout below uses these instead of the boardItemBoxPx
  // estimates, which is what makes the edge-to-edge gap uniform on every side
  // (estimates mis-guessed card height, so top/bottom got more room than
  // left/right). A ResizeObserver re-measures when content changes (e.g. a card
  // switching LOD tier), so the layout re-packs to stay even.
  const [cardSizes, setCardSizes] = useState<Map<string, { w: number; h: number }>>(
    () => new Map(),
  )
  const sizeObserverRef = useRef<ResizeObserver | null>(null)
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      setCardSizes((prev) => {
        let next = prev
        for (const e of entries) {
          const el = e.target as HTMLElement
          const id = el.dataset.cardId
          if (!id) continue
          const w = el.offsetWidth
          const h = el.offsetHeight
          if (!w && !h) continue
          const cur = prev.get(id)
          if (!cur || cur.w !== w || cur.h !== h) {
            if (next === prev) next = new Map(prev)
            next.set(id, { w, h })
          }
        }
        return next
      })
    })
    sizeObserverRef.current = ro
    return () => ro.disconnect()
  }, [])
  // Registers a card's DOM root: tracks it for the connector overlay, observes
  // it for size changes, and seeds an immediate measurement so the first layout
  // pass isn't stuck on the estimate.
  const registerCard = useCallback(
    (id: string, el: HTMLElement | null) => {
      const m = cardElsRef.current
      const ro = sizeObserverRef.current
      if (el) {
        el.dataset.cardId = id
        m.set(id, el)
        ro?.observe(el)
        const w = el.offsetWidth
        const h = el.offsetHeight
        if (w || h) {
          setCardSizes((prev) => {
            const cur = prev.get(id)
            if (cur && cur.w === w && cur.h === h) return prev
            const next = new Map(prev)
            next.set(id, { w, h })
            return next
          })
        }
      } else {
        const old = m.get(id)
        if (old) ro?.unobserve(old)
        m.delete(id)
      }
    },
    [cardElsRef],
  )

  // World-space anchor for each GROUP: focal at center, groups on a ring
  // around it (radial hub & spokes). Same camera-facing plane mapping as the
  // focal — right/up basis derived from the case-board camera offset.
  const itemTargets = useMemo(() => {
    type Entry = {
      item: BoardItem
      origin: [number, number, number]
      target: [number, number, number]
    }
    if (!focalWorld) return [] as Entry[]
    const focal = new Vector3(focalWorld[0], focalWorld[1], focalWorld[2])
    const camPos = focal.clone().add(CASE_BOARD_CAM_OFFSET)
    const forward = focal.clone().sub(camPos).normalize()
    const worldUp = new Vector3(0, 1, 0)
    const right = new Vector3().crossVectors(worldUp, forward).normalize()
    const up = new Vector3().crossVectors(forward, right).normalize()
    // Pack the cards in SCREEN PIXELS — they render at a fixed CSS px size
    // (NodeMorph has no distanceFactor), so collision in px space matches what
    // the user actually sees. Spacing is then a fixed px gap regardless of how
    // many cards there are; the AABB solver only pushes the cluster wider when
    // cards genuinely can't fit, which is the "tight when few, spread when
    // many" behaviour we want.
    // Prefer the measured size; fall back to the estimate only until the card
    // has rendered once (first frame on open).
    const halfOf = (id: string, est: { w: number; h: number }) => {
      const s = cardSizes.get(id) ?? est
      return { hw: s.w / 2, hh: s.h / 2 }
    }
    const placement = computeBalancedLayout({
      items: items.map((it) => ({ id: it.id, ...halfOf(it.id, boardItemBoxPx(it)) })),
      focalHalf: halfOf(selectedRefId, BOARD_FOCAL_BOX_PX),
      seed: selectedRefId,
      gap: BOARD_GAP_PX,
    })
    // World units per on-screen pixel at the (fixed) board pose. The perspective
    // camera shows 2·d·tan(fov/2) world units of height across the viewport, so
    // dividing by the pixel height gives the scale that maps the px layout to
    // world offsets matching the rendered card sizes — at any viewport size.
    const fovRad = (BOARD_FOV / 2) * (Math.PI / 180)
    const worldPerPx =
      (2 * BOARD_CAM_DISTANCE * Math.tan(fovRad)) / Math.max(1, viewportHeight)
    const entries: Entry[] = []
    for (const item of items) {
      const pos = placement.get(item.id) ?? { x: 0, y: 0 }
      const offset = right
        .clone()
        .multiplyScalar(pos.x * worldPerPx)
        .add(up.clone().multiplyScalar(pos.y * worldPerPx))
      const target = focal.clone().add(offset)
      entries.push({
        item,
        origin: focalWorld,
        target: [target.x, target.y, target.z],
      })
    }
    return entries
  }, [focalWorld, items, selectedRefId, viewportHeight, cardSizes])

  // Projection inputs — focal + each group anchor (id = group key) so the
  // connectors SVG can draw focal → group beziers each frame.
  const projectionInput = useMemo(() => {
    if (!focalWorld) return []
    const list: { id: string; origin: [number, number, number]; target: [number, number, number] }[] = [
      { id: selectedRefId, origin: focalWorld, target: focalWorld },
    ]
    for (const e of itemTargets) {
      list.push({ id: e.item.id, origin: e.origin, target: e.target })
    }
    return list
  }, [focalWorld, selectedRefId, itemTargets])

  // Which groups are unstacked (members spread as tiles) vs stacked (deck).
  // Local to the open session — resets on close since the layer unmounts.
  // Groups default to STACKED so the board opens tidy; the user unstacks a
  // group to inspect its members. Tracking the expanded set keeps "stacked" the
  // default without seeding state from the (changing) group list.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set())
  const toggleGroup = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  return (
    <>
      <CaseBoardAnimator focalWorld={focalWorld} cameraRef={cameraRef} />
      <ProjectionEmitter
        projectionsRef={projectionsRef}
        items={projectionInput}
        morphProgress={morphProgress}
      />
      {selectedNode && focalWorld && (
        <NodeMorph
          id={selectedRefId}
          node={selectedNode}
          originPosition={focalWorld}
          targetPosition={focalWorld}
          variant="selected"
          morphProgress={morphProgress}
          portal={cardPortalRef}
          registerEl={(el) => registerCard(selectedRefId, el)}
          attachedImages={attachedImages}
        />
      )}
      {itemTargets.map(({ item, origin, target }) =>
        item.kind === "node" ? (
          <NodeMorph
            key={item.id}
            id={item.id}
            node={item.node}
            originPosition={origin}
            targetPosition={target}
            variant="neighbor"
            morphProgress={morphProgress}
            onClick={() => useCaseBoardStore.getState().open(item.id)}
            portal={cardPortalRef}
            registerEl={(el) => registerCard(item.id, el)}
          />
        ) : (
          <GroupMorph
            key={item.id}
            id={item.id}
            type={item.type}
            members={item.members}
            expanded={expandedKeys.has(item.id)}
            onToggle={() => toggleGroup(item.id)}
            onMemberClick={(refId) => useCaseBoardStore.getState().open(refId)}
            originPosition={origin}
            targetPosition={target}
            morphProgress={morphProgress}
            portal={cardPortalRef}
            registerEl={(el) => registerCard(item.id, el)}
          />
        ),
      )}
    </>
  )
}

// SVG overlay that hosts the connector graphics — dashed lines, endpoint
// dots, mid-edge "linked to" pills. Each frame, an in-Canvas projection
// emitter writes focal + neighbor screen coords to a shared ref; this
// component's own rAF reads that ref and updates the SVG element attrs
// imperatively (no React re-renders during pan/zoom/morph).
const CONNECTOR_COLOR = "#4a90e2"
const CONNECTOR_COLOR_DIM = "rgba(74, 144, 226, 0.55)"
const CONNECTOR_LABEL_BG = "#0a0e15"
const CONNECTOR_LABEL_TEXT = "rgba(180, 210, 240, 0.85)"

function CaseBoardConnectorsSvg({
  projectionsRef,
  cardElsRef,
  edges,
  morphProgress,
}: {
  // Projected (board-layer-local) screen positions of every card centre,
  // written each frame by the in-Canvas ProjectionEmitter. These are the SAME
  // coordinates drei uses to position the cards, BEFORE the board layer's CSS
  // transform — so drawing here and letting that transform scale the SVG keeps
  // edges glued to the cards at any zoom (React-Flow model).
  projectionsRef: React.RefObject<ProjectionsRef>
  // Card DOM roots — used only for their natural (un-transformed) size via
  // offsetWidth/Height, to clip endpoints to the card borders.
  cardElsRef: React.RefObject<Map<string, HTMLElement>>
  // One per visible-pair edge. a/b are refIds (a = focal/source).
  edges: { id: string; a: string; b: string; label: string }[]
  morphProgress: number
}) {
  const pathRefs = useRef<Map<string, SVGPathElement>>(new Map())
  const dotARefs = useRef<Map<string, SVGCircleElement>>(new Map())
  const dotBRefs = useRef<Map<string, SVGCircleElement>>(new Map())
  const labelGRefs = useRef<Map<string, SVGGElement>>(new Map())

  useEffect(() => {
    let raf = 0
    function tick() {
      const proj = projectionsRef.current?.positions
      const els = cardElsRef.current
      if (proj && els) {
        for (const e of edges) {
          const ca = proj.get(e.a)
          const cb = proj.get(e.b)
          const ea = els.get(e.a)
          const eb = els.get(e.b)
          if (!ca || !cb || !ea || !eb) continue
          // Natural card half-sizes (offsetWidth/Height ignore the CSS scale,
          // matching the un-transformed space these coords live in).
          const hax = ea.offsetWidth / 2
          const hay = ea.offsetHeight / 2
          const hbx = eb.offsetWidth / 2
          const hby = eb.offsetHeight / 2
          const dx = cb.x - ca.x
          const dy = cb.y - ca.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const nx = dx / dist
          const ny = dy / dist

          // Where the centre→centre ray exits each card rect, and which face it
          // crossed. Picking the face keeps the line on the edge that faces the
          // other card, never on a corner.
          const boundary = (
            px: number, py: number, hx: number, hy: number, ux: number, uy: number,
          ) => {
            const tx = hx / Math.max(Math.abs(ux), 1e-3)
            const ty = hy / Math.max(Math.abs(uy), 1e-3)
            const t = Math.min(tx, ty)
            return { x: px + ux * t, y: py + uy * t, faceX: tx <= ty }
          }
          const A = boundary(ca.x, ca.y, hax, hay, nx, ny)
          const B = boundary(cb.x, cb.y, hbx, hby, -nx, -ny)
          const ax = A.x, ay = A.y
          const bx = B.x, by = B.y

          // Leave/enter each card PERPENDICULAR to its face (smoothstep edge).
          const ctrl = Math.max(20, Math.min(90, dist * 0.4))
          const nAx = A.faceX ? Math.sign(ax - ca.x) || 1 : 0
          const nAy = A.faceX ? 0 : Math.sign(ay - ca.y) || 1
          const nBx = B.faceX ? Math.sign(bx - cb.x) || 1 : 0
          const nBy = B.faceX ? 0 : Math.sign(by - cb.y) || 1
          const c1x = ax + nAx * ctrl
          const c1y = ay + nAy * ctrl
          const c2x = bx + nBx * ctrl
          const c2y = by + nBy * ctrl

          const path = pathRefs.current.get(e.id)
          if (path) {
            path.setAttribute(
              "d",
              `M ${ax.toFixed(1)} ${ay.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`,
            )
          }
          const da = dotARefs.current.get(e.id)
          if (da) {
            da.setAttribute("cx", ax.toFixed(1))
            da.setAttribute("cy", ay.toFixed(1))
          }
          const db = dotBRefs.current.get(e.id)
          if (db) {
            db.setAttribute("cx", bx.toFixed(1))
            db.setAttribute("cy", by.toFixed(1))
          }
          const labelG = labelGRefs.current.get(e.id)
          if (labelG) {
            // Place the pill just past the SOURCE card, ALONG THE FACE NORMAL
            // (= the curve's tangent where it leaves the card), not along the
            // straight source→target line. The edge leaves perpendicular and
            // then curves, so offsetting along the straight line drifts the
            // label off the visible curve (top/bottom edges floated sideways).
            const pillW = Math.max(48, (e.label || "linked to").length * 7 + 18)
            const along = pillW / 2 + 10
            const lx = ax + nAx * along
            const ly = ay + nAy * along
            labelG.setAttribute("transform", `translate(${lx.toFixed(1)}, ${ly.toFixed(1)})`)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [projectionsRef, cardElsRef, edges])

  // One SVG filling the (transformed) connector layer. No per-element scaling —
  // the layer's CSS transform scales strokes, dots, and the pill as crisp
  // vectors, exactly like the cards.
  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        pointerEvents: "none",
        opacity: morphProgress,
      }}
    >
      {edges.map((e) => {
        const label = (e.label || "linked to").toUpperCase()
        const pillW = Math.max(48, label.length * 7 + 18)
        return (
          <g key={e.id}>
            <path
              ref={(el) => {
                if (el) pathRefs.current.set(e.id, el)
                else pathRefs.current.delete(e.id)
              }}
              stroke={CONNECTOR_COLOR_DIM}
              strokeWidth={1.4}
              strokeDasharray="6 5"
              fill="none"
              strokeLinecap="round"
            />
            <circle
              ref={(el) => {
                if (el) dotARefs.current.set(e.id, el)
                else dotARefs.current.delete(e.id)
              }}
              r={4}
              fill={CONNECTOR_COLOR}
              stroke={CARD_BG_FOR_DOT}
              strokeWidth={1.5}
            />
            <circle
              ref={(el) => {
                if (el) dotBRefs.current.set(e.id, el)
                else dotBRefs.current.delete(e.id)
              }}
              r={4}
              fill={CONNECTOR_COLOR}
              stroke={CARD_BG_FOR_DOT}
              strokeWidth={1.5}
            />
            <g
              ref={(el) => {
                if (el) labelGRefs.current.set(e.id, el)
                else labelGRefs.current.delete(e.id)
              }}
            >
              <rect
                x={-pillW / 2}
                y={-9}
                width={pillW}
                height={18}
                rx={9}
                fill={CONNECTOR_LABEL_BG}
                stroke={CONNECTOR_COLOR_DIM}
                strokeWidth={0.75}
              />
              <text
                x={0}
                y={1}
                textAnchor="middle"
                dominantBaseline="central"
                fill={CONNECTOR_LABEL_TEXT}
                fontSize={9}
                fontWeight={600}
                fontFamily='"Space Grotesk", system-ui, sans-serif'
                letterSpacing={1}
              >
                {label}
              </text>
            </g>
          </g>
        )
      })}
    </svg>
  )
}

// Small dark border around endpoint dots so they read as distinct chips
// rather than blending into the dashed line. Matches the case-board's
// dark backdrop.
const CARD_BG_FOR_DOT = "#0a0e15"

// Board zoom limits. Past ~0.5 the cards are tiny; zooming out further just
// scatters them into empty space with no added value, so we stop there.
const BOARD_MIN_ZOOM = 0.5
const BOARD_MAX_ZOOM = 4

interface GraphCanvasProps {
  nodes: ApiNode[]
  edges: ApiEdge[]
  schemas: SchemaNode[]
  onNodeSelect?: (node: ApiNode) => void
}

export function GraphCanvas({ nodes, edges, schemas, onNodeSelect }: GraphCanvasProps) {
  const cameraRef = useRef<CameraControlsImpl>(null)
  const sidebarHoveredNode = useGraphStore((s) => s.hoveredNode)
  const sidebarSelectedNode = useGraphStore((s) => s.sidebarSelectedNode)
  const dataVersion = useGraphStore((s) => s.dataVersion)
  const searchTerm = useAppStore((s) => s.searchTerm)

  // Metro overlay is opt-in via NEXT_PUBLIC_METRO_OVERLAY=1. When off, no
  // fixture data is spliced into the graph and the schematic layers don't
  // render — useful when pointing at a non-metro backend dataset.
  const metroEnabled = process.env.NEXT_PUBLIC_METRO_OVERLAY === "1"

  // The metro overlay renders from the local fixture so the schematic stays
  // visible even when search replaces the graph store with results that don't
  // include Station nodes. Station node ref_ids are rewritten to their backend
  // UUIDs (see STATION_BACKEND_REF_ID_MAP in metro.ts), so the fixture supplies
  // the static map (positions + tunnels) while each station still resolves to
  // its live DB record on click.
  const overlayNodes = metroEnabled ? (metroSeries.nodes as ApiNode[]) : []
  const overlayEdges = metroEnabled ? (metroSeries.edges as ApiEdge[]) : []

  // The *interactive* station layer (3D spheres + labels + hover behavior
  // provided by GraphView) also has to persist through search. Splice fixture
  // stations and TUNNEL_TO edges into whatever the graph store currently has
  // before running the radial layout. De-dupe by ref_id / edge identity so a
  // future search that does return a station won't double-render it.
  const effectiveNodes = useMemo(() => {
    if (!metroEnabled) return nodes
    const seen = new Set(nodes.map((n) => n.ref_id))
    const fixtureStations = (metroSeries.nodes as ApiNode[]).filter(
      (n) => n.node_type === "Station" && !seen.has(n.ref_id)
    )
    return fixtureStations.length > 0 ? [...nodes, ...fixtureStations] : nodes
  }, [nodes, metroEnabled])

  const effectiveEdges = useMemo(() => {
    if (!metroEnabled) return edges
    const refIds = new Set(effectiveNodes.map((n) => n.ref_id))
    const seen = new Set(
      edges.map((e) => `${e.source}|${e.target}|${e.edge_type}`)
    )
    // Pull in every fixture edge whose endpoints both exist in the effective
    // node set. That covers two cases at once:
    //   1. Station↔Station TUNNEL_TO edges (both stations are in fixture).
    //   2. Cross-edges from search results to stations — e.g. when the user
    //      searches "Librarian", the result has the Librarian node but no
    //      INHABITS edge to Biblioteka, because the backend only returns
    //      edges between nodes in the result set. The fixture has the edge.
    // Edges whose other endpoint isn't in the dataset would just dangle,
    // so we skip them.
    const extras = (metroSeries.edges as ApiEdge[]).filter(
      (e) =>
        !seen.has(`${e.source}|${e.target}|${e.edge_type}`) &&
        refIds.has(e.source) &&
        refIds.has(e.target)
    )
    return extras.length > 0 ? [...edges, ...extras] : edges
  }, [edges, effectiveNodes, metroEnabled])

  // Selection mirrored into a ref so the append effect can recompute the right
  // subgraph without taking viewState as a dependency (which would re-fire it
  // on every camera/visibility change). viewState is declared here, above the
  // data layer, because the incremental-append effect below reads it.
  const [viewState, setViewState] = useState<ViewState>({ mode: "overview" })
  const selectedIdRef = useRef<number | null>(null)
  selectedIdRef.current =
    viewState.mode === "subgraph" ? viewState.selectedNodeId : null

  // Full rebuild (apiToGraph + global radial layout) only on a NEW dataset
  // (dataVersion bump from setGraphData) or a schema change — never on addNodes
  // appends. Rebuilding on every nodes/edges change was the reshuffle that made
  // the camera jump when related data loaded; appends are now folded in
  // incrementally below via appendToGraph. effectiveNodes/effectiveEdges (metro
  // fixture splice) are read at build time, and the fork's applyLayout
  // signature keeps the lore Y-lift + fixed station positions.
  const baseModel = useMemo(() => {
    const result = apiToGraph(effectiveNodes, effectiveEdges, schemas)
    applyLayout(result.graph, result.fixedPositions, true)
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effectiveNodes/Edges read at build time but intentionally NOT deps; rebuild only on dataset/schema swap, appends fold in incrementally
  }, [dataVersion, schemas])

  // Bumps once per full rebuild (new baseModel). GraphView uses it to snap on
  // rebuild but ANIMATE in-place appends (where node identities are preserved).
  const layoutGenRef = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- baseModel identity IS the trigger; we bump per rebuild, not per value read
  const layoutGeneration = useMemo(() => ++layoutGenRef.current, [baseModel])

  // `appendModel` accumulates incremental appends on top of the last full
  // build. On a full rebuild (baseModel changes) we use baseModel directly for
  // THIS render to avoid a one-frame flash of stale data, then resync
  // appendModel in an effect so subsequent appends build on the fresh layout.
  const [appendModel, setAppendModel] = useState<GraphModel>(baseModel)
  const baseRef = useRef(baseModel)
  const isRebuild = baseRef.current !== baseModel
  const model = isRebuild ? baseModel : appendModel

  // Counts processed into `model` so the append effect can tell real growth
  // (addNodes) from a full rebuild that already includes everything.
  const appendCountsRef = useRef({ nodes: nodes.length, edges: edges.length })

  // A full rebuild resets the append baseline.
  useEffect(() => {
    baseRef.current = baseModel
    setAppendModel(baseModel)
    appendCountsRef.current = { nodes: nodes.length, edges: edges.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- counts captured at rebuild time on purpose
  }, [baseModel])

  // Fold appended nodes/edges into the current graph in place (no reshuffle).
  // The count guard runs before the append, so the re-render setAppendModel
  // triggers (which re-fires this effect via the `model` dep) early-returns.
  useEffect(() => {
    const last = appendCountsRef.current
    if (nodes.length <= last.nodes && edges.length <= last.edges) return
    appendCountsRef.current = { nodes: nodes.length, edges: edges.length }

    const res = appendToGraph(model, nodes, edges, schemas)
    if (!res) return

    // "Add new node, recalculate": once the new descendants are folded in,
    // relay out the selected node's descendant subgraph as a clean radial
    // anchored on the selection — no incremental patching, no reshuffle of
    // ancestors or other branches, no camera motion.
    const sel = selectedIdRef.current
    if (sel != null && res.model.graph.nodes[sel]) {
      // Nodes with index >= the pre-append count are the freshly added ones.
      recomputeDescendantLayout(res.model.graph, sel, model.graph.nodes.length)
    }

    setAppendModel(res.model)

    // When focused on a subgraph, GraphView hides anything outside
    // visibleNodeIds. Reveal the freshly-attached nodes (at their parent's
    // relative depth + 1) so a click-driven fetch actually surfaces them.
    if (res.newNodeIds.length > 0) {
      setViewState((vs) => {
        if (vs.mode !== "subgraph") return vs
        const visible = new Set(vs.visibleNodeIds)
        const depthMap = new Map(vs.depthMap)
        let changed = false
        for (const id of res.newNodeIds) {
          if (visible.has(id)) continue
          visible.add(id)
          const p = res.parentOf.get(id)
          const pd = p === undefined || p === vs.selectedNodeId ? 0 : depthMap.get(p) ?? 1
          depthMap.set(id, pd + 1)
          changed = true
        }
        if (!changed) return vs
        return { ...vs, visibleNodeIds: Array.from(visible), depthMap }
      })
    }
  }, [nodes, edges, schemas, model])

  // Downstream feature code (metro, case-board, station HUD, click/hover) reads
  // these — derive them from the active model so they track incremental appends.
  const { graph, indexMap, refIdToIndex } = model

  // ref_id → API node lookups. Built once per data change so the per-click /
  // per-hover / per-board-item paths don't each rescan the node array.
  // `nodes` and `effectiveNodes` are kept separate on purpose: callers that
  // previously scanned `nodes` must not start resolving the metro fixture
  // stations that only live in `effectiveNodes`.
  const nodeByRefId = useMemo(() => {
    const m = new Map<string, ApiNode>()
    for (const n of nodes) m.set(n.ref_id, n)
    return m
  }, [nodes])
  const effectiveNodeByRefId = useMemo(() => {
    const m = new Map<string, ApiNode>()
    for (const n of effectiveNodes) m.set(n.ref_id, n)
    return m
  }, [effectiveNodes])

  // Metro stations are drawn by the dedicated schematic overlay (colored lines
  // + bullets), so their 3D graph glyph + label rest muted to avoid doubling
  // up and cluttering the overview. They stay interactive — hover/select
  // restores the label and highlight. Only active in the metro view.
  const mutedNodeIds = useMemo(() => {
    if (!metroEnabled) return null
    const set = new Set<number>()
    for (const n of effectiveNodes) {
      if (n.node_type !== "Station") continue
      const idx = refIdToIndex.get(n.ref_id)
      if (idx !== undefined) set.add(idx)
    }
    return set.size > 0 ? set : null
  }, [effectiveNodes, refIdToIndex, metroEnabled])

  // Lowercase type → schema icon name (e.g. "EpisodeIcon"). The pill in
  // GraphView resolves this through schema-icons to a Lucide component.
  const nodeTypeIcons = useMemo(() => {
    const map: Record<string, string> = {}
    for (const s of schemas) {
      if (s.icon) map[s.type.toLowerCase()] = s.icon
    }
    return map
  }, [schemas])

  // In-3D case board state — subscribed via the case-board store. Open is
  // triggered by either the close-up zoom (CaseViewTrigger) or the manual
  // "open case board" button. The whole transition stays in the 3D scene:
  // cards appear as Html overlays at node world positions, camera tilts to
  // a front-of-node view, morphProgress drives card opacity + scale-in.
  const morphSelectedRefId = useCaseBoardStore((s) => s.selectedRefId)
  const morphProgress = useCaseBoardStore((s) => s.morphProgress)
  const morphTarget = useCaseBoardStore((s) => s.morphTarget)
  const morphOpen = morphTarget > 0.001 || morphProgress > 0.001

  // Shared between the in-Canvas ProjectionEmitter (writer) and the
  // out-of-Canvas CaseBoardConnectorsSvg (reader). Holds the most recent
  // world→screen projection of the focal + each neighbor's interpolated
  // position. Mutable ref so the SVG can repaint via its own rAF without
  // touching React state per frame.
  const projectionsRef = useRef<ProjectionsRef>({ positions: new Map() })
  // Maps focal refId + each group key to its rendered card DOM element, so the
  // connector overlay can measure real card rectangles and attach edges to the
  // actual borders (works at any zoom — getBoundingClientRect includes it).
  const cardElsRef = useRef<Map<string, HTMLElement>>(new Map())

  // Board pan + zoom — applied as a CSS transform on the layer that hosts
  // the Html cards + SVG connectors. Lives entirely in DOM so the 3D
  // camera stays locked and the underlying scene doesn't move at all.
  const boardLayerRef = useRef<HTMLDivElement>(null)
  // Connector layer — a sibling of the board layer that gets the SAME pan/zoom
  // transform, so the edge SVG (drawn in the same projected coordinates the
  // cards use) scales as one with the cards. This is the React-Flow / Miro
  // model: nodes + edges + labels in one transformed space, so everything
  // stays aligned and crisp at any zoom with no per-element scaling hacks.
  const connectorLayerRef = useRef<HTMLDivElement>(null)
  // Stable, UNTRANSFORMED container — used to anchor cursor-relative zoom. The
  // board layer itself has the pan/zoom transform applied, so its own
  // getBoundingClientRect is post-transform and can't be used as the reference.
  const containerRef = useRef<HTMLDivElement>(null)
  const boardPanRef = useRef({ x: 0, y: 0 })
  const boardZoomRef = useRef(1)
  // Apply pan/zoom imperatively to the board layer's transform — NOT via React
  // state. Driving it through setState re-rendered the entire GraphCanvas tree
  // (heavy, especially with the metro overlay's extra nodes) on every drag-move
  // / wheel tick — that was the lag, the dead drag, and the stale-until-resize
  // layout. The connector overlay already tracks via rAF + measured rects, so
  // the DOM transform is fine as the single source of truth.
  const applyBoardTransform = useCallback(() => {
    const p = boardPanRef.current
    const z = boardZoomRef.current
    const t = `translate(${p.x}px, ${p.y}px) scale(${z})`
    if (boardLayerRef.current) boardLayerRef.current.style.transform = t
    // Same transform on the connector layer so edges track the cards exactly.
    if (connectorLayerRef.current) connectorLayerRef.current.style.transform = t
  }, [])
  const setBoard = useCallback(
    (pan: { x: number; y: number }, zoom: number) => {
      boardPanRef.current = pan
      boardZoomRef.current = zoom
      applyBoardTransform()
    },
    [applyBoardTransform],
  )
  const dragStateRef = useRef<{
    startX: number
    startY: number
    startPanX: number
    startPanY: number
    moved: boolean
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Snap pan/zoom back to identity whenever the morph closes so the next
  // open always starts centered. Without this, the board would remember
  // the pan/zoom from the last session.
  useEffect(() => {
    // Reset to identity whenever the board opens or closes so each open starts
    // centered at scale 1. Pure imperative — no setState, no re-render.
    setBoard({ x: 0, y: 0 }, 1)
  }, [morphOpen, setBoard])

  const handleBoardMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only start a pan gesture on left button. Right-click / middle stay
      // available for browser context menu / future tools.
      if (e.button !== 0) return
      dragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPanX: boardPanRef.current.x,
        startPanY: boardPanRef.current.y,
        moved: false,
      }
    },
    [],
  )

  const handleBoardMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current
      if (!drag) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      // 3px threshold so a clean click on a card doesn't register as a
      // micro-drag and consume the click event.
      if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      if (!drag.moved) {
        drag.moved = true
        setIsDragging(true)
      }
      setBoard(
        { x: drag.startPanX + dx, y: drag.startPanY + dy },
        boardZoomRef.current,
      )
    },
    [setBoard],
  )

  const handleBoardMouseUp = useCallback(() => {
    dragStateRef.current = null
    setIsDragging(false)
  }, [])

  const handleBoardWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      // If the wheel is over a scrollable group list, let it scroll its rows
      // natively instead of zooming the board. Checked per-event from the
      // target so there's no persistent flag that can get stuck and
      // permanently disable zoom.
      let scrollEl: HTMLElement | null = e.target as HTMLElement | null
      while (scrollEl && scrollEl !== e.currentTarget) {
        if (
          scrollEl.scrollHeight > scrollEl.clientHeight + 1 &&
          getComputedStyle(scrollEl).overflowY !== "visible"
        ) {
          return
        }
        scrollEl = scrollEl.parentElement
      }
      // Miro-style zoom: the step scales with the actual wheel delta (so a
      // trackpad's many small events stay gentle and a mouse notch is one
      // smooth bump), and the zoom anchors on the cursor instead of the
      // viewport center.
      e.stopPropagation()
      // Normalize across deltaMode: pixels (0), lines (1), pages (2).
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const delta = e.deltaY * unit
      const factor = Math.exp(-delta * 0.0015)

      const z = boardZoomRef.current
      const next = Math.max(BOARD_MIN_ZOOM, Math.min(BOARD_MAX_ZOOM, z * factor))
      // Clamping can shrink the effective factor — recompute it so the
      // cursor-anchor math stays exact at the zoom limits.
      const applied = next / z

      // Anchor against the UNTRANSFORMED container, not the board layer itself
      // (its rect is post-transform, which threw the anchor off by the current
      // pan and made the zoom drift toward a point). cx/cy is the cursor
      // relative to the transform origin (center center).
      const rect = (containerRef.current ?? e.currentTarget).getBoundingClientRect()
      const cx = e.clientX - rect.left - rect.width / 2
      const cy = e.clientY - rect.top - rect.height / 2
      // Keep the content point under the cursor fixed: pan' = c - f·(c - pan).
      const p = boardPanRef.current
      setBoard(
        {
          x: cx - applied * (cx - p.x),
          y: cy - applied * (cy - p.y),
        },
        next,
      )
    },
    [setBoard],
  )

  // 1-hop neighbor ref_ids of the morph-selected node. Hoisted out of
  // CaseBoardMorphLayer so the connectors SVG (sibling, not child) can
  // share the same set without duplicating the edge scan.
  const morphNeighborIds = useMemo(() => {
    if (!morphSelectedRefId) return []
    const out: string[] = []
    const seen = new Set<string>([morphSelectedRefId])
    for (const e of effectiveEdges) {
      let nb: string | null = null
      if (e.source === morphSelectedRefId) nb = e.target
      else if (e.target === morphSelectedRefId) nb = e.source
      if (nb && !seen.has(nb)) {
        seen.add(nb)
        out.push(nb)
      }
    }
    return out
  }, [morphSelectedRefId, effectiveEdges])

  // Edges to render on the case board: every edge whose both endpoints
  // are part of the visible set (focal + 1-hop neighbors). Includes
  // neighbor-to-neighbor edges so the board reads as a network instead of
  // a star. De-duped by canonical key.
  const morphVisibleEdges = useMemo(() => {
    if (!morphSelectedRefId) return []
    const visible = new Set<string>([morphSelectedRefId, ...morphNeighborIds])
    const out: { id: string; a: string; b: string; label: string }[] = []
    const seen = new Set<string>()
    for (const e of effectiveEdges) {
      if (!visible.has(e.source) || !visible.has(e.target)) continue
      const lo = e.source < e.target ? e.source : e.target
      const hi = e.source < e.target ? e.target : e.source
      const key = `${lo}|${hi}|${e.edge_type}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ id: key, a: e.source, b: e.target, label: e.edge_type })
    }
    return out
  }, [morphSelectedRefId, morphNeighborIds, effectiveEdges])

  // Group the focal's 1-hop neighbors by node_type into case-board groups.
  // The dominant relationship (edge_type) to the focal becomes the group's
  // connector label + header subtitle.
  const boardItems = useMemo<BoardItem[]>(() => {
    if (!morphSelectedRefId) return []
    const relFor = new Map<string, string>()
    for (const e of morphVisibleEdges) {
      let nb: string | null = null
      if (e.a === morphSelectedRefId) nb = e.b
      else if (e.b === morphSelectedRefId) nb = e.a
      if (nb && !relFor.has(nb)) relFor.set(nb, e.label ?? "")
    }
    // Group by (node_type + relationship) so members of a group genuinely share
    // the same edge to the focal. Grouping by type alone mislabels members — a
    // spouse and a child both end up under whichever relationship is dominant.
    const byKey = new Map<string, { type: string; rel: string; members: ApiNode[] }>()
    const order: string[] = []
    for (const refId of morphNeighborIds) {
      const node = effectiveNodeByRefId.get(refId)
      if (!node) continue
      const type = node.node_type || "Node"
      const rel = relFor.get(refId) ?? ""
      const key = `${type}|${rel}`
      let g = byKey.get(key)
      if (!g) {
        g = { type, rel, members: [] }
        byKey.set(key, g)
        order.push(key)
      }
      g.members.push(node)
    }
    // Hybrid: sparse groups → individual cards; dense ones → one group card.
    const items: BoardItem[] = []
    for (const key of order) {
      const g = byKey.get(key)!
      if (g.members.length <= HYBRID_THRESHOLD) {
        for (const node of g.members) {
          items.push({ kind: "node", id: node.ref_id, type: g.type, edgeLabel: g.rel, node })
        }
      } else {
        items.push({ kind: "group", id: `grp:${key}`, type: g.type, edgeLabel: g.rel, members: g.members })
      }
    }
    return items
  }, [morphSelectedRefId, morphNeighborIds, morphVisibleEdges, effectiveNodeByRefId])

  // One connector per board item: focal → item.
  const boardConnectorEdges = useMemo(
    () =>
      boardItems.map((it) => ({
        id: it.id,
        a: morphSelectedRefId ?? "",
        b: it.id,
        label: it.edgeLabel || "linked to",
      })),
    [boardItems, morphSelectedRefId],
  )

  const [hoveredCardNode, setHoveredCardNode] = useState<ApiNode | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  // Metro overlay focus state — driven by hovering the lines (3D) or the
  // legend (DOM). null when nothing is hovered, which leaves every line and
  // bullet at full opacity.
  const [hoveredLine, setHoveredLine] = useState<string | null>(null)
  const [hoveredState, setHoveredState] = useState<StationState | null>(null)

  // True while the user is actively dragging/rotating/dollying the camera.
  // Suppresses hover firing on whatever nodes happen to sweep under the
  // (otherwise stationary) cursor during the gesture. Wired via a tracker
  // component inside the Canvas (see <CameraInteractionTracker/>) because
  // an outer useEffect races drei's makeDefault registration.
  const [cameraInteracting, setCameraInteracting] = useState(false)
  const handleCameraInteractingChange = useCallback((v: boolean) => {
    setCameraInteracting(v)
  }, [])

  // Debug overlay: world-fixed markers + per-frame camera/anchor crosshairs.
  // Gated entirely behind NEXT_PUBLIC_DEBUG_MARKERS so production builds carry
  // no debug UI. When the env is set, markers default on and a toggle button
  // appears for in-session A/B'ing.
  const debugAvailable = process.env.NEXT_PUBLIC_DEBUG_MARKERS === "1"
  const [debugMarkers, setDebugMarkers] = useState<boolean>(debugAvailable)
  // Click anchor: world position of the node the user clicked, captured at
  // click time. Stays fixed after the click so a layout rebuild moves the
  // node away from it visibly.
  const clickAnchorRef = useRef<{
    refId: string
    pos: { x: number; y: number; z: number }
  } | null>(null)

  // CameraSync drives this each frame using the same lerp curve as GraphView,
  // so geometry inflation and camera dolly stay in lockstep.
  const camAnim = useRef<{
    target: CamTarget
    progress: number
    pos: [number, number, number]
    look: [number, number, number]
  }>({
    target: OVERVIEW_CAM,
    progress: 1,
    pos: [OVERVIEW_CAM.posX, OVERVIEW_CAM.posY, OVERVIEW_CAM.posZ],
    look: [OVERVIEW_CAM.lookX, OVERVIEW_CAM.lookY, OVERVIEW_CAM.lookZ],
  })

  const setCamTarget = useCallback((target: CamTarget) => {
    const cam = cameraRef.current
    if (cam) {
      // Seed from where the camera actually is right now — the user may have
      // orbited since the last transition, so the previous interpolated
      // values are stale.
      const pos = cam.getPosition(new Vector3())
      const tgt = cam.getTarget(new Vector3())
      camAnim.current.pos = [pos.x, pos.y, pos.z]
      camAnim.current.look = [tgt.x, tgt.y, tgt.z]
    }
    camAnim.current.target = target
    camAnim.current.progress = 0
  }, [])

  // Smooth orbital fly-to using camera-controls' own damped transition, which
  // interpolates in SPHERICAL coordinates around the look-at point. Used for
  // station selections: CameraSync's Cartesian lerp cuts a straight chord when
  // the azimuth changes (the tunnel-axis re-orientation), which reads as a
  // jump / unexpected rotation. Stations are fixed-position nodes, so the
  // camera doesn't need CameraSync's lockstep with geometry inflation.
  const defaultSmoothTimeRef = useRef<number | null>(null)
  const flyCamTo = useCallback((target: CamTarget) => {
    // Park CameraSync so its in-flight lerp can't fight this transition.
    camAnim.current.progress = 1
    const cam = cameraRef.current
    if (!cam) return
    // Lengthen the damping for the fly-in, then restore the original value
    // (captured once) so user wheel/drag feel is untouched afterwards. Always
    // restoring to the captured default keeps rapid successive clicks from
    // permanently "locking in" the slow transition time.
    if (defaultSmoothTimeRef.current === null) {
      defaultSmoothTimeRef.current = cam.smoothTime
    }
    cam.smoothTime = 0.65
    const transition = cam.setLookAt(
      target.posX, target.posY, target.posZ,
      target.lookX, target.lookY, target.lookZ,
      true,
    )
    // setLookAt leaves theta un-normalized — after the user has orbited, the
    // accumulated angle can differ from the destination by > π and the damped
    // transition would swing the camera the long way around. Normalizing
    // snaps both angles into the same revolution = shortest-path rotation.
    cam.normalizeRotations()
    void transition.finally(() => {
      cam.smoothTime = defaultSmoothTimeRef.current!
    })
  }, [])

  // Reset view only on full data replacement (new search), not on appends
  // from sidebar-driven neighbor fetches — otherwise focusing the camera on
  // a clicked node would be undone every time a neighborhood arrives.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- paired with an imperative camera reset; remount would drop GL state
    setViewState({ mode: "overview" })
    setCamTarget(OVERVIEW_CAM)
    useCaseBoardStore.getState().close()
  }, [dataVersion, setCamTarget])

  const selectedApiNode = useMemo<ApiNode | null>(() => {
    if (viewState.mode !== "subgraph") return null
    const refId = indexMap.get(viewState.selectedNodeId)
    if (!refId) return null
    // Resolve from effectiveNodeByRefId so metro Station nodes — which only
    // live in the spliced fixture set, not the graph store `nodes` — can open
    // the 2D case view. nodeByRefId (built from `nodes` only) returns null for
    // them, which left CaseViewTrigger disabled on every station. The board
    // itself already operates on effectiveNodes, so opening on a station works.
    return effectiveNodeByRefId.get(refId) ?? nodeByRefId.get(refId) ?? null
  }, [viewState, indexMap, effectiveNodeByRefId, nodeByRefId])

  // Diegetic station HUD — active whenever a Station node is the current
  // selection on the metro map (and the full-screen morph isn't covering the
  // scene). Renders radar rings + floating holo cards in the 3D scene itself.
  const hudSceneActive =
    metroEnabled && !morphOpen && viewState.mode === "subgraph" &&
    selectedApiNode?.node_type === "Station"

  // Tunnel-linked station neighbors of the selected station, with their graph
  // indices so the holo cards can both anchor at node positions and navigate
  // on click. Non-station neighbors keep their regular GraphView labels.
  const sceneNeighbors = useMemo<SceneNeighbor[]>(() => {
    if (!hudSceneActive || !selectedApiNode) return []
    const out: SceneNeighbor[] = []
    const seen = new Set<string>([selectedApiNode.ref_id])
    for (const e of effectiveEdges) {
      let nb: string | null = null
      if (e.source === selectedApiNode.ref_id) nb = e.target
      else if (e.target === selectedApiNode.ref_id) nb = e.source
      if (!nb || seen.has(nb)) continue
      seen.add(nb)
      const node = effectiveNodeByRefId.get(nb)
      if (!node || node.node_type !== "Station") continue
      const idx = refIdToIndex.get(nb)
      if (idx === undefined) continue
      out.push({ node, idx, edgeLabel: e.edge_type })
    }
    return out
  }, [hudSceneActive, selectedApiNode, effectiveEdges, effectiveNodeByRefId, refIdToIndex])

  // The holo cards ARE the labels for these nodes — suppress GraphView's own.
  const hudSuppressedLabelIds = useMemo<Set<number> | null>(() => {
    if (!hudSceneActive || viewState.mode !== "subgraph") return null
    const set = new Set<number>([viewState.selectedNodeId])
    for (const n of sceneNeighbors) set.add(n.idx)
    return set
  }, [hudSceneActive, viewState, sceneNeighbors])

  // Opens the in-3D case board (morph + camera tilt + Html cards) on the
  // node the user has been zooming into. apparentRadius is unused now —
  // kept in the trigger's signature for back-compat, but the morph doesn't
  // need it since cards are sized in screen-space via distanceFactor.
  const handleOpenCaseView = useCallback(
    (node: ApiNode) => {
      useCaseBoardStore.getState().open(node.ref_id)
    },
    [],
  )

  // Closes the in-3D case board: drops morph state and pulls the camera back
  // to the selected node's rest distance so the user has room to maneuver.
  const handleCloseCaseBoard = useCallback(() => {
    useCaseBoardStore.getState().close()
    if (viewState.mode === "subgraph") {
      const isStation = metroEnabled && selectedApiNode?.node_type === "Station"
      const azimuth = cameraRef.current?.azimuthAngle ?? 0
      if (isStation) {
        flyCamTo(computeStationCamTarget(graph, viewState.selectedNodeId, azimuth))
      } else {
        setCamTarget(computeCamTarget(graph, viewState.selectedNodeId, azimuth))
      }
    }
  }, [viewState, graph, setCamTarget, flyCamTo, metroEnabled, selectedApiNode])

  const externalHoveredId = sidebarHoveredNode ? (refIdToIndex.get(sidebarHoveredNode.ref_id) ?? null) : null
  const externalSelectedId = sidebarSelectedNode ? (refIdToIndex.get(sidebarSelectedNode.ref_id) ?? null) : null

  // Backend sets `matched_property` on actual search hits; expanded 1-hop
  // neighbors don't have it. Map those onto graph indices for the spotlight.
  const searchMatches = useMemo(() => {
    const set = new Set<number>()
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].matched_property !== undefined) set.add(i)
    }
    return set.size > 0 ? set : null
  }, [nodes])

  // Hovering a legend row spotlights every station in that state — reuses
  // the search-match plumbing in GraphView (highlights members, dims the
  // rest).
  const stateHoverMatches = useMemo(() => {
    if (!hoveredState) return null
    const set = new Set<number>()
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].node_type !== "Station") continue
      const p = nodes[i].properties as Record<string, unknown> | undefined
      if (!p) continue
      const status = p.station_status ?? p.status
      if (statusToState(status, p.faction) === hoveredState) set.add(i)
    }
    return set.size > 0 ? set : null
  }, [nodes, hoveredState])

  // Hovering a metro line spotlights every node tagged with that line.
  const lineHoverMatches = useMemo(() => {
    if (!hoveredLine) return null
    const set = new Set<number>()
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i].properties as Record<string, unknown> | undefined
      if (readStationLines(p).includes(hoveredLine)) set.add(i)
    }
    return set.size > 0 ? set : null
  }, [nodes, hoveredLine])

  // ref_id → set of metro line colors the node is associated with. Stations
  // contribute their own line property; non-station nodes inherit lines from
  // any station they share an edge with (1-hop). Used to dim unrelated
  // lines/bullets when a node is hovered or selected.
  const nodeToLines = useMemo(() => {
    const stationLines = new Map<string, Set<string>>()
    for (const n of nodes) {
      if (n.node_type !== "Station") continue
      const p = n.properties as Record<string, unknown> | undefined
      const lines = new Set(readStationLines(p))
      if (lines.size > 0) stationLines.set(n.ref_id, lines)
    }
    const map = new Map<string, Set<string>>()
    for (const [refId, lines] of stationLines) map.set(refId, new Set(lines))
    for (const e of edges) {
      const srcLines = stationLines.get(e.source)
      const dstLines = stationLines.get(e.target)
      if (srcLines && !stationLines.has(e.target)) {
        let arr = map.get(e.target)
        if (!arr) {
          arr = new Set()
          map.set(e.target, arr)
        }
        for (const l of srcLines) arr.add(l)
      }
      if (dstLines && !stationLines.has(e.source)) {
        let arr = map.get(e.source)
        if (!arr) {
          arr = new Set()
          map.set(e.source, arr)
        }
        for (const l of dstLines) arr.add(l)
      }
    }
    return map
  }, [nodes, edges])

  // Lines currently in focus. Hovering a line directly wins; otherwise the
  // active node (hover beats select; canvas beats sidebar) contributes its
  // associated lines. `null` means no dimming — every line at full opacity.
  const activeLines = useMemo<Set<string> | null>(() => {
    if (hoveredLine) return new Set([hoveredLine])
    let activeRefId: string | null = null
    if (hoveredCardNode) activeRefId = hoveredCardNode.ref_id
    else if (sidebarHoveredNode) activeRefId = sidebarHoveredNode.ref_id
    else if (viewState.mode === "subgraph") {
      activeRefId = indexMap.get(viewState.selectedNodeId) ?? null
    } else if (sidebarSelectedNode) activeRefId = sidebarSelectedNode.ref_id
    if (!activeRefId) return null
    return nodeToLines.get(activeRefId) ?? new Set()
  }, [
    hoveredLine,
    hoveredCardNode,
    sidebarHoveredNode,
    sidebarSelectedNode,
    viewState,
    indexMap,
    nodeToLines,
  ])

  // All search hits, sorted by descending score. Drives both the top-3
  // amplification ranks and the label cap below, so they stay consistent.
  const sortedHits = useMemo(() => {
    const hits: { i: number; score: number }[] = []
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].matched_property === undefined) continue
      hits.push({ i, score: typeof nodes[i].score === "number" ? nodes[i].score! : 0 })
    }
    hits.sort((a, b) => b.score - a.score)
    return hits
  }, [nodes])

  // Top-3 ranked search hits, by descending score. GraphView amplifies their
  // size + color and tints their labels (rank 0 gold, ranks 1-2 cool blue).
  const topMatchRanks = useMemo<Map<number, number> | null>(() => {
    if (sortedHits.length === 0) return null
    const m = new Map<number, number>()
    for (let r = 0; r < Math.min(3, sortedHits.length); r++) m.set(sortedHits[r].i, r)
    return m
  }, [sortedHits])

  // A search can return up to 100 hits; labeling every one buries the view in
  // overlapping text (the de-overlap solver can't help when labels outnumber the
  // screen slots). Cap text labels to the top-N hits by score — every match
  // still keeps its glyph spotlight (color + size); the rest reveal their label
  // on hover or when zoomed into their neighborhood.
  const searchLabelMatches = useMemo<Set<number> | null>(() => {
    if (sortedHits.length === 0) return null
    return new Set(sortedHits.slice(0, SEARCH_LABEL_CAP).map((h) => h.i))
  }, [sortedHits])

  // Feature 2 (GRAPH_FEATURES.md): pan to the rank-0 search hit once per new
  // search query. Tracks the last search term we've already panned for, so a
  // neighbor-fetch payload that arrives later (same query, fresher graph)
  // doesn't re-pan and override a user click in between. handleNodeClick
  // consumes the pending pan by writing the current searchTerm into the ref —
  // see below.
  const lastPannedSearchTerm = useRef<string>("")
  useEffect(() => {
    if (!searchTerm) return
    if (searchTerm === lastPannedSearchTerm.current) return
    if (!topMatchRanks) return
    let topIdx = -1
    for (const [idx, rank] of topMatchRanks) {
      if (rank === 0) { topIdx = idx; break }
    }
    if (topIdx < 0 || !graph.nodes[topIdx]) return
    setCamTarget(computeCamTarget(graph, topIdx, cameraRef.current?.azimuthAngle ?? 0))
    lastPannedSearchTerm.current = searchTerm
  }, [searchTerm, topMatchRanks, graph, setCamTarget])

  const handleHoverChange = useCallback(
    (nodeId: number | null) => {
      if (nodeId === null) {
        setHoveredCardNode(null)
        return
      }
      const refId = indexMap.get(nodeId)
      if (!refId) {
        setHoveredCardNode(null)
        return
      }
      const apiNode = nodeByRefId.get(refId)
      setHoveredCardNode(apiNode ?? null)
    },
    [indexMap, nodeByRefId]
  )

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    setCursor({ x: e.clientX, y: e.clientY })
  }, [])

  const handlePointerLeave = useCallback(() => {
    setHoveredCardNode(null)
  }, [])

  const handleNodeClick = useCallback(
    (nodeId: number) => {
      useGraphStore.getState().setSidebarSelectedNode(null)
      useGraphStore.getState().setHoveredNode(null)
      const refId = indexMap.get(nodeId)
      if (refId && onNodeSelect) {
        const apiNode = nodeByRefId.get(refId)
        if (apiNode) onNodeSelect(apiNode)
      }

      // Debug: snapshot the clicked node's world position BEFORE rescale.
      // The yellow ghost marker lives here so layout rebuilds become visible.
      const preClickPos = graph.nodes[nodeId]?.position
      if (refId && preClickPos) {
        clickAnchorRef.current = {
          refId,
          pos: { x: preClickPos.x, y: preClickPos.y, z: preClickPos.z },
        }
      }

      // Re-scale the world around the clicked node. Selected stays put on
      // screen; descendants' offsets from selected grow to R1-sized rings,
      // ancestors push outward. No camera motion — the anchor doesn't move.
      const initialDepth = graph.initialDepthMap?.get(nodeId) ?? 0
      const scale = Math.pow(1 / DEPTH_SHRINK, Math.max(0, initialDepth))
      rescaleAroundAnchor(graph, nodeId, scale)

      const sub = extractSubgraph(graph, nodeId, 30, { useAdj: "undirected" })

      console.log(
        "[select] node:",
        graph.nodes[nodeId]?.label,
        "| descendant subgraph:",
        describeSubgraph(graph, nodeId, "directed")
      )

      // Intentionally do NOT promote extraEdge (cluster-absorbed) endpoints
      // to depth 1. The cluster proxy is the 1-hop stand-in for its members;
      // promoting members would label every absorbed clip at once. Members
      // become labelable when the user hovers the proxy directly.

      setViewState((prev) => {
        const prevHistory = prev.mode === "subgraph" ? prev.navigationHistory : []
        const existingIdx = prevHistory.indexOf(nodeId)
        const newHistory =
          existingIdx !== -1
            ? prevHistory.slice(0, existingIdx + 1)
            : [...prevHistory, nodeId]

        const prevVisible = prev.mode === "subgraph" ? prev.visibleNodeIds : []
        const prevSet = new Set(prevVisible)
        const newNodes = sub.nodeIds.filter((n) => !prevSet.has(n))
        const allVisible = [...prevVisible, ...newNodes]
        const visibleSet = new Set(allVisible)
        for (const hid of newHistory) {
          if (!visibleSet.has(hid)) {
            allVisible.push(hid)
            visibleSet.add(hid)
          }
        }

        const depthMap = new Map(sub.depthMap)
        const prevNodeId = newHistory.length >= 2 ? newHistory[newHistory.length - 2] : null
        if (prevNodeId !== null && !depthMap.has(prevNodeId)) {
          depthMap.set(prevNodeId, -1)
        }

        return {
          mode: "subgraph" as const,
          selectedNodeId: nodeId,
          navigationHistory: newHistory,
          depthMap,
          neighborsByDepth: sub.neighborsByDepth,
          parentId: sub.parentId,
          visibleNodeIds: allVisible,
        }
      })

      // Camera dollies to look at selected. Anchor's world position is
      // fixed by rescaleAroundAnchor, so the camera target is constant
      // through the lerp — no drift like when both the camera and the
      // anchor were moving in opposite directions. Capture the current
      // orbit azimuth so the final view preserves it rather than snapping
      // to a canonical orientation when the camera lands above the node.
      // Metro stations get the angled tactical pose (the diegetic HUD's
      // rings + floating cards need depth); everything else keeps the
      // overhead subgraph pose.
      const clickedIsStation =
        metroEnabled &&
        refId !== undefined &&
        effectiveNodeByRefId.get(refId)?.node_type === "Station"
      let azimuth = cameraRef.current?.azimuthAngle ?? 0
      if (clickedIsStation && refId) {
        // Orient the camera so the station's tunnel axis runs screen-
        // horizontal: neighbor holo cards then spread left/right of the
        // focal card instead of stacking behind it / on the ring center.
        // Average the neighbor bearings as an AXIS (angle-doubling trick, so
        // opposite directions reinforce instead of canceling), then pick the
        // of the two facing azimuths closest to the user's current orbit.
        const p0 = graph.nodes[nodeId].position
        let s2 = 0
        let c2 = 0
        const seenNb = new Set<string>([refId])
        for (const e of effectiveEdges) {
          const nb =
            e.source === refId ? e.target : e.target === refId ? e.source : null
          if (!nb || seenNb.has(nb)) continue
          seenNb.add(nb)
          if (effectiveNodeByRefId.get(nb)?.node_type !== "Station") continue
          const ni = refIdToIndex.get(nb)
          const q = ni !== undefined ? graph.nodes[ni]?.position : undefined
          if (!q) continue
          const phi = Math.atan2(q.z - p0.z, q.x - p0.x)
          s2 += Math.sin(2 * phi)
          c2 += Math.cos(2 * phi)
        }
        if (s2 !== 0 || c2 !== 0) {
          let aligned = -0.5 * Math.atan2(s2, c2)
          if (Math.cos(aligned - azimuth) < 0) aligned += Math.PI
          azimuth = aligned
        }
      }
      if (clickedIsStation) {
        flyCamTo(computeStationCamTarget(graph, nodeId, azimuth))
      } else {
        setCamTarget(computeCamTarget(graph, nodeId, azimuth))
      }

      // Consume any pending search-pan: if results haven't landed yet, a
      // later payload would otherwise yank the camera off the node the
      // user just clicked. Marking this term as "already panned for" stops
      // the search-pan effect from firing for it.
      lastPannedSearchTerm.current = searchTerm
    },
    [graph, indexMap, nodeByRefId, effectiveNodeByRefId, effectiveEdges, refIdToIndex, metroEnabled, onNodeSelect, setCamTarget, flyCamTo, searchTerm]
  )

  const handleReset = useCallback(() => {
    restoreOriginalPositions(graph)
    setViewState({ mode: "overview" })
    setCamTarget(OVERVIEW_CAM)
    // Clear hover + sidebar selection so highlight edges / external-selected
    // beziers from the previously focused node don't linger after the reset.
    useGraphStore.getState().setSidebarSelectedNode(null)
    useGraphStore.getState().setHoveredNode(null)
  }, [graph, setCamTarget])

  // Lock CameraControls into a 2D-feeling pan + zoom mode while the case
  // board is open: drag = truck (parallel to view plane), wheel = dolly,
  // rotate disabled. Reverts to the default 3D orbit controls on close.
  useEffect(() => {
    const cc = cameraRef.current
    if (!cc) return
    if (morphOpen) {
      // 3D camera fully locked while the board is up. Pan + zoom for the
      // board happen on a separate DOM layer (BoardPanZoom below) so they
      // don't move the underlying 3D scene at all — true Miro-style
      // independent whiteboard.
      cc.mouseButtons.left = CameraControlsImpl.ACTION.NONE
      cc.mouseButtons.right = CameraControlsImpl.ACTION.NONE
      cc.mouseButtons.middle = CameraControlsImpl.ACTION.NONE
      cc.mouseButtons.wheel = CameraControlsImpl.ACTION.NONE
      cc.touches.one = CameraControlsImpl.ACTION.NONE
      cc.touches.two = CameraControlsImpl.ACTION.NONE
      cc.touches.three = CameraControlsImpl.ACTION.NONE
    } else {
      cc.mouseButtons.left = CameraControlsImpl.ACTION.ROTATE
      cc.mouseButtons.right = CameraControlsImpl.ACTION.TRUCK
      cc.mouseButtons.middle = CameraControlsImpl.ACTION.DOLLY
      cc.mouseButtons.wheel = CameraControlsImpl.ACTION.DOLLY
      cc.touches.one = CameraControlsImpl.ACTION.TOUCH_ROTATE
      cc.touches.two = CameraControlsImpl.ACTION.TOUCH_DOLLY_TRUCK
      cc.touches.three = CameraControlsImpl.ACTION.TOUCH_TRUCK
    }
  }, [morphOpen])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      // Two-stage Esc: while the case board is open it closes the board
      // first (keeping the subgraph view); a second Esc resets to overview.
      if (morphOpen) {
        handleCloseCaseBoard()
        return
      }
      if (viewState.mode === "subgraph") handleReset()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [viewState.mode, handleReset, morphOpen, handleCloseCaseBoard])

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <Canvas
        camera={{ position: [0, 80, 0.1], fov: 50 }}
        style={{ background: "#05080c" }}
      >
        <ambientLight intensity={0.3} />
        {metroEnabled && (
          <>
            <MetroLinesLayer
              nodes={overlayNodes}
              edges={overlayEdges}
              onLineHover={setHoveredLine}
              activeLines={activeLines}
            />
            <MetroStationBullets
              nodes={overlayNodes}
              activeLines={activeLines}
              activeState={hoveredState}
            />
          </>
        )}
        <GraphView
          graph={graph}
          viewState={viewState}
          onNodeClick={handleNodeClick}
          onHoverChange={handleHoverChange}
          externalHoveredId={externalHoveredId}
          externalSelectedId={externalSelectedId}
          searchMatches={lineHoverMatches ?? stateHoverMatches ?? searchMatches}
          searchLabelMatches={searchLabelMatches}
          topMatchRanks={topMatchRanks}
          searchTerm={searchTerm}
          nodeTypeIcons={nodeTypeIcons}
          onResetView={handleReset}
          layoutGeneration={layoutGeneration}
          suppressHover={cameraInteracting}
          mutedNodeIds={mutedNodeIds}
          suppressLabelIds={hudSuppressedLabelIds}
          onGraphClick={() => {
            useGraphStore.getState().setSidebarSelectedNode(null)
            useGraphStore.getState().setHoveredNode(null)
          }}
        />
        {hudSceneActive && viewState.mode === "subgraph" && selectedApiNode && (
          <StationHudScene
            graph={graph}
            selectedNodeId={viewState.selectedNodeId}
            focal={selectedApiNode}
            neighbors={sceneNeighbors}
            onFocusNode={handleNodeClick}
          />
        )}
        {debugMarkers && (
          <DebugMarkers
            graph={graph}
            selectedNodeId={viewState.mode === "subgraph" ? viewState.selectedNodeId : null}
            camAnim={camAnim}
            clickAnchorRef={clickAnchorRef}
            cameraRef={cameraRef}
          />
        )}
        <OffscreenIndicators
          graph={graph}
          viewState={viewState}
          onNodeClick={handleNodeClick}
        />
        <PrevNodeIndicator
          graph={graph}
          viewState={viewState}
          onNodeClick={handleNodeClick}
        />
        <CaseViewTrigger
          graph={graph}
          selectedNodeId={
            viewState.mode === "subgraph" ? viewState.selectedNodeId : null
          }
          selectedApiNode={selectedApiNode}
          onOpen={handleOpenCaseView}
          disabled={morphOpen}
        />
        {morphOpen && morphSelectedRefId && (
          <CaseBoardMorphLayer
            graph={graph}
            refIdToIndex={refIdToIndex}
            nodes={effectiveNodes}
            selectedRefId={morphSelectedRefId}
            morphProgress={morphProgress}
            cameraRef={cameraRef}
            projectionsRef={projectionsRef}
            cardPortalRef={boardLayerRef}
            cardElsRef={cardElsRef}
            items={boardItems}
          />
        )}
        <CameraControls
          ref={cameraRef}
          makeDefault
          dollySpeed={0.5}
          truckSpeed={1}
          dollyToCursor
        />
        <CameraInteractionTracker onChange={handleCameraInteractingChange} />
        <CameraSync camRef={cameraRef} targetRef={camAnim} />
        <EffectComposer>
          <Bloom
            luminanceThreshold={0.7}
            luminanceSmoothing={0.9}
            intensity={0.5}
          />
        </EffectComposer>
      </Canvas>

      {viewState.mode === "subgraph" && (
        <button
          onClick={handleReset}
          className="absolute bottom-4 right-4 rounded-md bg-background/80 px-3 py-1.5 text-xs text-foreground backdrop-blur hover:bg-background"
        >
          Reset view
        </button>
      )}

      {debugAvailable && (
        <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-md bg-background/80 px-2 py-1.5 text-xs text-foreground backdrop-blur">
          <button
            onClick={() => setDebugMarkers((v) => !v)}
            className={`rounded px-2 py-0.5 transition-colors ${
              debugMarkers
                ? "bg-foreground text-background"
                : "hover:bg-foreground/10"
            }`}
          >
            Debug markers {debugMarkers ? "on" : "off"}
          </button>
          {debugMarkers && (
            <div className="flex items-center gap-3 text-[10px] leading-none">
              <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ background: "#ffd11a" }} /> click anchor</span>
              <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ background: "#33ff66" }} /> live node</span>
              <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ background: "#ff33dd" }} /> cam target</span>
              <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-full" style={{ background: "#33e6ff" }} /> cam look</span>
            </div>
          )}
        </div>
      )}

      {/* Cream whiteboard backdrop — fades in to cover the 3D scene. Must
          outrank drei's default Html zIndexRange (~16.77M) so GraphView's
          node + edge labels disappear behind it, not bleed through. The
          case-board cards + SVG sit above this layer. */}
      {morphOpen && (
        <div
          className="absolute inset-0"
          style={{
            // Same hue family as the 3D scene bg (#05080c) plus a subtle
            // radial-gradient dot grid every 24px. Reads as graph paper /
            // case-board surface without being noisy.
            background: `
              radial-gradient(circle at center, rgba(180,200,220,0.06) 1px, transparent 1.4px) 0 0 / 24px 24px,
              #0a0e15
            `,
            // Cap below 1 so a faint ghost of the 3D scene shows through.
            opacity: morphProgress * CASE_BOARD_BACKDROP_OPACITY,
            zIndex: CASE_BOARD_Z.backdrop,
            pointerEvents: "none",
          }}
        />
      )}
      {/* Persistent layer that hosts the case-board cards (Html portals
          from NodeMorph) and the SVG connectors. Stays mounted so the
          drei portal ref is always populated; only takes pointer events
          + applies pan/zoom transform when the morph is open. Translate +
          scale happen here so the 3D camera underneath stays still. */}
      <div
        ref={boardLayerRef}
        onMouseDown={morphOpen ? handleBoardMouseDown : undefined}
        onMouseMove={morphOpen ? handleBoardMouseMove : undefined}
        onMouseUp={morphOpen ? handleBoardMouseUp : undefined}
        onMouseLeave={morphOpen ? handleBoardMouseUp : undefined}
        onWheel={morphOpen ? handleBoardWheel : undefined}
        style={{
          position: "absolute",
          inset: 0,
          // Always above the cream backdrop so cards + connectors render
          // on top; inert when the morph isn't open.
          zIndex: CASE_BOARD_Z.cardFar,
          pointerEvents: morphOpen ? "auto" : "none",
          cursor: morphOpen ? (isDragging ? "grabbing" : "grab") : "default",
          // transform applied imperatively via applyBoardTransform (above) so
          // dragging / zooming never re-renders this tree.
          transformOrigin: "center center",
          willChange: "transform",
          // No transform transition: zoom is cursor-anchored and applied
          // per wheel event, so a lagging transition would make the anchor
          // point visibly drift. Smoothness comes from the delta-scaled
          // exponential step instead.
          transition: "none",
        }}
      >
      </div>
      {/* Connector layer — sibling of the board layer, given the SAME pan/zoom
          transform (see applyBoardTransform) so the edge SVG scales as one with
          the cards. Above the cards so dots/pills read on top; inert to pointer
          so it never blocks card clicks or board panning. */}
      <div
        ref={connectorLayerRef}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: CASE_BOARD_Z.connectorLabels,
          pointerEvents: "none",
          transformOrigin: "center center",
          willChange: "transform",
          transition: "none",
        }}
      >
        {morphOpen && (
          <CaseBoardConnectorsSvg
            projectionsRef={projectionsRef}
            cardElsRef={cardElsRef}
            edges={boardConnectorEdges}
            morphProgress={morphProgress}
          />
        )}
      </div>
      {morphOpen && (
        <button
          onClick={handleCloseCaseBoard}
          title="Close case board (Esc)"
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            width: 36,
            height: 36,
            borderRadius: 18,
            border: "1px solid rgba(180,195,210,0.2)",
            background: "rgba(15,20,28,0.85)",
            color: "#e6edf3",
            backdropFilter: "blur(8px)",
            fontSize: 18,
            lineHeight: 1,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            opacity: morphProgress,
            transition: "opacity 200ms",
            zIndex: CASE_BOARD_Z.button,
          }}
        >
          ✕
        </button>
      )}

      {hudSceneActive && selectedApiNode && (
        <StationZonePlate node={selectedApiNode} />
      )}

      <HoverPreviewCard node={hoveredCardNode} schemas={schemas} x={cursor.x} y={cursor.y} />

      {metroEnabled && (
        <MetroLegend hoveredState={hoveredState} onHoverState={setHoveredState} />
      )}

    </div>
  )
}
