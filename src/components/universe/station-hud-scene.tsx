"use client"

import { useMemo, useRef } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { Html, Line } from "@react-three/drei"
import type { Graph } from "@/graph-viz-kit"
import type { GraphNode as ApiNode } from "@/lib/graph-api"
import { pickString, resolveNodeThumbnail } from "@/lib/node-display"
import {
  BLOCKING_STATES,
  MAP_Y_OFFSET,
  METRO_LINE_COLORS,
  STATION_FILL,
  STATION_GLOW,
  STATION_STATE_LABEL,
  readStationLines,
  statusToState,
} from "./metro-overlay"
import {
  ERAS,
  stationTimeline,
  type EraId,
  type EraSnapshot,
} from "@/data/station-timeline"

const TEAL = "#46e3d4"
const GOLD = "#f2b73f"
const INK = "#d9fbf6"
const INK_DIM = "rgba(150, 200, 195, 0.55)"

const teal = (a: number) => `rgba(70, 227, 212, ${a})`
const gold = (a: number) => `rgba(242, 183, 63, ${a})`

// Faction id (metro2087 data) → display name for the zone plate.
const FACTION_LABEL: Record<string, string> = {
  union: "HANSA RING",
  central: "POLIS ALLIANCE",
  commune: "RED COMMUNE",
  iron: "IRON ORDER",
  free: "FREE STATIONS",
  swamp: "SWAMP ENCLAVE",
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function lineColorCss(line: string): string {
  const c = METRO_LINE_COLORS[line]
  if (!c) return "#9aa3ab"
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`
}

function nodeName(node: ApiNode): string {
  return (
    pickString(node.properties, "name") ??
    pickString(node.properties, "title") ??
    node.ref_id
  )
}

// `image` / `images` are the metro fixture's lore overrides; the generic
// thumbnail resolver covers backend-shaped nodes.
function nodeImage(node: ApiNode): string | undefined {
  const p = node.properties as Record<string, unknown> | undefined
  if (typeof p?.image === "string" && p.image) return p.image
  if (Array.isArray(p?.images) && typeof p.images[0] === "string") return p.images[0]
  return resolveNodeThumbnail(node)
}

// State label without lore parentheticals ("Anomaly (creatures)" → "ANOMALY")
// so chips and the zone plate stay one crisp word.
function stateWord(label: string): string {
  return label.split(" (")[0].toUpperCase()
}

// Procedural hero art for nodes without an image — deterministic per ref_id
// so a station always renders the same hologram. Diagonal struts + a hue
// shifted glow + ghosted initials read as "no visual feed, schematic only".
function heroArtStyle(refId: string, accent: string): React.CSSProperties {
  const h = hashCode(refId)
  const hue = 165 + (h % 55) // teal → blue-green band
  const angle = 100 + (h % 60)
  return {
    background: [
      `linear-gradient(180deg, rgba(2,12,14,0.1) 30%, rgba(2,12,14,0.85) 100%)`,
      `repeating-linear-gradient(${angle}deg, ${teal(0.08)} 0 2px, transparent 2px 11px)`,
      `repeating-linear-gradient(${angle - 90}deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 17px)`,
      `radial-gradient(ellipse at ${20 + (h % 50)}% 18%, hsla(${hue}, 75%, 42%, 0.55), transparent 62%)`,
      `linear-gradient(180deg, #0a2b30, #051317)`,
    ].join(", "),
    boxShadow: `inset 0 0 32px rgba(0,0,0,0.55), inset 0 0 3px ${accent}33`,
  }
}

function ghostInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
}

// Corner-notched silhouette shared by the cards — the single strongest
// "game HUD" shape cue.
const NOTCH = (n: number) =>
  `polygon(0 0, calc(100% - ${n}px) 0, 100% ${n}px, 100% 100%, ${n}px 100%, 0 calc(100% - ${n}px))`

// Diegetic station HUD — rendered INSIDE the 3D scene when a Station node is
// selected on the metro map. Radar rings spin on the map plane around the
// station, a gold light beam lifts a holo card above it, and each tunnel
// neighbor gets a small teal holo card on a stem, wired up with glowing
// dashed ground links. The default GraphView labels for these nodes are
// suppressed (suppressLabelIds) so the cards ARE the labels.

// Rings sit above the schematic lines/bullets but below the node glyphs.
const RING_LIFT = MAP_Y_OFFSET + 0.22

// World heights of the floating cards (Html anchors) and their beams/stems.
// Sized for the angled station camera (STATION_CAM_DIST in graph-canvas) —
// tall enough to float clear of the glyphs, short enough that the cards
// never approach the camera plane.
const FOCAL_CARD_H = 4.6
const FOCAL_BEAM_TOP = 4.3
const SAT_CARD_H = 3.0
const SAT_STEM_TOP = 2.75

export interface SceneNeighbor {
  node: ApiNode
  idx: number
  edgeLabel: string
}

function stationState(node: ApiNode) {
  const p = node.properties as Record<string, unknown>
  return statusToState(p.station_status ?? p.status, p.faction)
}

// Sweep wedge doubles as the TIME CURSOR: it glides (shortest path) to point
// at the active era notch on the dial instead of free-spinning.
const SWEEP_WIDTH = 0.55

function SweepWedge({ targetAngle }: { targetAngle: number }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, delta) => {
    if (!ref.current) return
    const cur = ref.current.rotation.z
    const want = targetAngle - SWEEP_WIDTH / 2
    let d = want - cur
    d = Math.atan2(Math.sin(d), Math.cos(d))
    ref.current.rotation.z = cur + d * Math.min(1, delta * 5)
  })
  return (
    <mesh ref={ref} position={[0, 0, -0.002]}>
      <circleGeometry args={[4.7, 48, 0, SWEEP_WIDTH]} />
      <meshBasicMaterial
        color={TEAL}
        transparent
        opacity={0.07}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// Ring-local angle of each era notch on the dial. Chronological, clockwise
// from the top of the ring.
function eraAngle(index: number): number {
  return ((90 - index * 72) * Math.PI) / 180
}

function EraDial({
  era,
  onEraChange,
}: {
  era: EraId
  onEraChange: (era: EraId) => void
}) {
  return (
    <>
      {ERAS.map((e, i) => {
        const a = eraAngle(i)
        const active = e.id === era
        return (
          <Html
            key={e.id}
            position={[Math.cos(a) * 5.6, Math.sin(a) * 5.6, 0.05]}
            center
            zIndexRange={[70, 0]}
            style={{ pointerEvents: "none" }}
          >
            <button
              onClick={(ev) => {
                ev.stopPropagation()
                onEraChange(e.id)
              }}
              style={{
                pointerEvents: "auto",
                cursor: "pointer",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10,
                letterSpacing: 1.5,
                padding: "2px 8px",
                color: active ? "#04211e" : teal(0.85),
                background: active ? GOLD : "rgba(4, 18, 18, 0.78)",
                border: `1px solid ${active ? GOLD : teal(0.45)}`,
                borderRadius: 999,
                boxShadow: active ? `0 0 14px ${gold(0.55)}` : `0 0 8px ${teal(0.15)}`,
                transition: "all 160ms ease",
                whiteSpace: "nowrap",
              }}
            >
              {e.year}
            </button>
          </Html>
        )
      })}
    </>
  )
}

function RadarRings() {
  // Tick marks — 72 short radial dashes between the inner and mid rings.
  const ticks = useMemo(() => {
    const pts: number[] = []
    const R0 = 2.55
    const R1 = 2.85
    const N = 72
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      pts.push(Math.cos(a) * R0, Math.sin(a) * R0, 0, Math.cos(a) * R1, Math.sin(a) * R1, 0)
    }
    return new Float32Array(pts)
  }, [])

  return (
    <>
      {[
        { r: [2.0, 2.05] as const, o: 0.55 },
        { r: [3.4, 3.44] as const, o: 0.3 },
        { r: [4.7, 4.73] as const, o: 0.18 },
      ].map((ring, i) => (
        <mesh key={i}>
          <ringGeometry args={[ring.r[0], ring.r[1], 96]} />
          <meshBasicMaterial color={TEAL} transparent opacity={ring.o} depthWrite={false} />
        </mesh>
      ))}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[ticks, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={TEAL} transparent opacity={0.4} depthWrite={false} />
      </lineSegments>
      {/* Soft inner glow + gold core ring under the station glyph */}
      <mesh position={[0, 0, -0.004]}>
        <circleGeometry args={[2.0, 48]} />
        <meshBasicMaterial
          color={TEAL}
          transparent
          opacity={0.05}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0, 0.002]}>
        <ringGeometry args={[0.55, 0.62, 48]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.9} depthWrite={false} />
      </mesh>
    </>
  )
}

// Shared shell for the floating cards: notched border, dark glass fill,
// procedural hero (or image), scanlines.
// CSS filter per era — "archive footage" grading for the time dial. Pre-war
// goes warm sepia, the war burns red and dark, the book years desaturate,
// the present is untouched.
const ERA_FILTER: Record<EraId, string> = {
  prewar: "sepia(0.65) saturate(0.65) brightness(0.85)",
  war: "sepia(0.4) hue-rotate(-25deg) saturate(1.6) brightness(0.7) contrast(1.15)",
  y2033: "saturate(0.7) brightness(0.85)",
  y2036: "saturate(0.85) brightness(0.95)",
  now: "none",
}

function HoloHero({
  node,
  accent,
  ghostSize,
  filter,
}: {
  node: ApiNode
  accent: string
  ghostSize: number
  filter?: string
}) {
  const image = nodeImage(node)
  const p = node.properties as Record<string, unknown>
  const ghost = ghostInitials(
    (typeof p.name_ru === "string" ? p.name_ru : null) ?? nodeName(node),
  )
  return (
    <div
      style={{
        position: "relative",
        aspectRatio: "16 / 6.5",
        overflow: "hidden",
        filter,
        transition: "filter 400ms ease",
        ...(image ? {} : heroArtStyle(node.ref_id, accent)),
      }}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={nodeName(node)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: ghostSize,
            fontWeight: 700,
            letterSpacing: 5,
            color: `${accent}29`,
            userSelect: "none",
          }}
        >
          {ghost}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0 1px, transparent 1px 3px)",
          pointerEvents: "none",
        }}
      />
    </div>
  )
}

function FocalHoloCard({
  focal,
  neighbors,
  snapshot,
}: {
  focal: ApiNode
  neighbors: SceneNeighbor[]
  snapshot: EraSnapshot
}) {
  const props = focal.properties as Record<string, unknown>
  const name = nodeName(focal)
  const nameRu = typeof props.name_ru === "string" ? props.name_ru : null
  const lines = readStationLines(props)
  const passable = neighbors.filter((n) => !BLOCKING_STATES.has(stationState(n.node))).length
  const total = neighbors.length
  const isNow = snapshot.era === "now"

  return (
    <div style={{ width: 252, fontFamily: "var(--font-heading), sans-serif", color: INK }}>
      <style>{`
        @keyframes shud-archive-flicker {
          0%, 100% { opacity: 0 }
          4% { opacity: 0.35 }
          6% { opacity: 0 }
          52% { opacity: 0 }
          54% { opacity: 0.22 }
          56% { opacity: 0 }
        }
      `}</style>
      {/* Name strip */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          padding: "5px 10px 4px",
          marginBottom: 5,
          clipPath: NOTCH(8),
          background: "rgba(8, 18, 16, 0.9)",
          border: `1px solid ${gold(0.75)}`,
          boxShadow: `0 0 16px ${gold(0.2)}`,
        }}
      >
        <span style={{ fontSize: 8.5, letterSpacing: 2, color: GOLD, fontWeight: 700 }}>STATION</span>
        <span
          style={{
            fontSize: 17,
            lineHeight: 1.1,
            fontWeight: 700,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textShadow: `0 0 12px ${gold(0.45)}`,
            flex: 1,
          }}
        >
          {name}
        </span>
        <span
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10,
            fontWeight: 700,
            color: isNow ? INK_DIM : GOLD,
            whiteSpace: "nowrap",
          }}
        >
          {snapshot.year}
        </span>
        {nameRu && <span style={{ fontSize: 9.5, color: INK_DIM, whiteSpace: "nowrap" }}>{nameRu}</span>}
      </div>

      <div
        style={{
          clipPath: NOTCH(11),
          border: `1.5px solid ${gold(0.9)}`,
          background: "rgba(5, 13, 14, 0.92)",
          boxShadow: `0 0 22px ${gold(0.22)}`,
        }}
      >
        <div style={{ position: "relative" }}>
          <HoloHero node={focal} accent={GOLD} ghostSize={42} filter={ERA_FILTER[snapshot.era]} />
          {!isNow && (
            <>
              {/* Archive-footage chrome: flicker pass + corner tag */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(220, 235, 230, 0.5)",
                  mixBlendMode: "overlay",
                  pointerEvents: "none",
                  animation: "shud-archive-flicker 3.4s linear infinite",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 4,
                  right: 6,
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 8,
                  letterSpacing: 1.5,
                  color: "rgba(240, 245, 240, 0.75)",
                  textShadow: "0 0 4px rgba(0,0,0,0.9)",
                  pointerEvents: "none",
                }}
              >
                ● REC {snapshot.year}
              </div>
            </>
          )}
        </div>
        <div style={{ padding: "6px 10px 8px", borderTop: `1px solid ${gold(0.35)}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isNow ? (
              <>
                <span style={{ fontSize: 8.5, letterSpacing: 1.5, color: INK_DIM }}>TUNNELS</span>
                <div style={{ display: "flex", gap: 2.5, flex: 1 }}>
                  {Array.from({ length: Math.max(total, 1) }, (_, i) => (
                    <span
                      key={i}
                      style={{
                        flex: 1,
                        height: 6,
                        transform: "skewX(-18deg)",
                        background: total > 0 && i < passable ? GOLD : "rgba(120,120,110,0.22)",
                        boxShadow: total > 0 && i < passable ? `0 0 7px ${gold(0.5)}` : "none",
                      }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: GOLD }}>
                  {passable}/{total}
                </span>
              </>
            ) : (
              <>
                <span style={{ fontSize: 8.5, letterSpacing: 1.5, color: GOLD }}>ARCHIVE</span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 8.5,
                    letterSpacing: 1.2,
                    color: INK_DIM,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {snapshot.faction ?? snapshot.label}
                </span>
              </>
            )}
            {snapshot.status && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 8.5,
                  letterSpacing: 1,
                  padding: "2px 6px",
                  border: `1px solid ${snapshot.statusGlow}66`,
                  clipPath: NOTCH(5),
                  background: "rgba(0,0,0,0.35)",
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: snapshot.statusFill,
                    boxShadow: `0 0 7px ${snapshot.statusGlow}`,
                  }}
                />
                {snapshot.status}
              </span>
            )}
          </div>
          {/* Era story — or an honest placeholder when no record exists. */}
          {snapshot.text ? (
            <div
              style={{
                fontFamily: "var(--font-sans), sans-serif",
                fontSize: 10,
                lineHeight: 1.5,
                color: "rgba(190, 225, 220, 0.75)",
                marginTop: 7,
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {snapshot.text}
            </div>
          ) : (
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 9,
                letterSpacing: 1.5,
                color: INK_DIM,
                marginTop: 7,
                textTransform: "uppercase",
              }}
            >
              — No archival record —
            </div>
          )}
          {isNow && lines.length > 0 && (
            <div style={{ display: "flex", gap: 4, marginTop: 7, alignItems: "center" }}>
              <span style={{ fontSize: 8, letterSpacing: 1.5, color: INK_DIM }}>LINES</span>
              {lines.map((l) => (
                <span
                  key={l}
                  title={l}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: lineColorCss(l),
                    border: "1px solid rgba(255,255,255,0.35)",
                    boxShadow: `0 0 5px ${lineColorCss(l)}`,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SatelliteHoloCard({
  neighbor,
  onClick,
}: {
  neighbor: SceneNeighbor
  onClick: () => void
}) {
  const node = neighbor.node
  const name = nodeName(node)
  const state = stationState(node)
  const lines = readStationLines(node.properties as Record<string, unknown>)
  const edge = (neighbor.edgeLabel || "LINKED").replace(/_/g, " ").toUpperCase()

  return (
    <div
      data-hud-card={node.ref_id}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      style={{
        position: "relative",
        width: 156,
        fontFamily: "var(--font-heading), sans-serif",
        color: INK,
        clipPath: NOTCH(9),
        border: `1px solid ${teal(0.55)}`,
        background: "rgba(5, 16, 17, 0.9)",
        boxShadow: `0 0 14px ${teal(0.12)}`,
        cursor: "pointer",
        transition: "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-3px)"
        e.currentTarget.style.boxShadow = `0 0 24px ${teal(0.35)}`
        e.currentTarget.style.borderColor = teal(0.95)
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = ""
        e.currentTarget.style.boxShadow = `0 0 14px ${teal(0.12)}`
        e.currentTarget.style.borderColor = teal(0.55)
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -1,
          left: -1,
          padding: "2px 8px 2px 6px",
          fontSize: 7.5,
          fontWeight: 700,
          letterSpacing: 1.3,
          color: "#04211e",
          background: TEAL,
          clipPath: "polygon(0 0, 100% 0, calc(100% - 6px) 100%, 0 100%)",
          zIndex: 1,
        }}
      >
        {edge}
      </div>
      <HoloHero node={node} accent={TEAL} ghostSize={24} />
      <div style={{ padding: "5px 8px 6px" }}>
        <div
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: STATION_FILL[state],
              boxShadow: `0 0 5px ${STATION_GLOW[state]}`,
            }}
          />
          <span style={{ fontSize: 8, letterSpacing: 1, color: INK_DIM }}>
            {stateWord(STATION_STATE_LABEL[state])}
          </span>
          <span style={{ flex: 1 }} />
          {lines.map((l) => (
            <span
              key={l}
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: lineColorCss(l),
                boxShadow: `0 0 4px ${lineColorCss(l)}`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export interface StationHudSceneProps {
  graph: Graph
  selectedNodeId: number
  focal: ApiNode
  neighbors: SceneNeighbor[]
  // Active era on the time dial; "now" = present day. State lives in
  // GraphCanvas so the zone plate (separate DOM tree) stays in sync.
  era: EraId
  onEraChange: (era: EraId) => void
  onFocusNode: (nodeId: number) => void
}

export function StationHudScene({
  graph,
  selectedNodeId,
  focal,
  neighbors,
  era,
  onEraChange,
  onFocusNode,
}: StationHudSceneProps) {
  const snapshots = useMemo(() => stationTimeline(focal), [focal])
  const p = graph.nodes[selectedNodeId]?.position
  if (!p) return null
  const ringY = p.y + RING_LIFT
  const snapshot = snapshots.find((s) => s.era === era) ?? snapshots[snapshots.length - 1]
  const isNow = snapshot.era === "now"
  const eraIndex = Math.max(0, ERAS.findIndex((e) => e.id === snapshot.era))

  return (
    <group>
      {/* Radar rings + era dial on the map plane around the station */}
      <group position={[p.x, ringY, p.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <RadarRings />
        <SweepWedge targetAngle={eraAngle(eraIndex)} />
        <EraDial era={snapshot.era} onEraChange={onEraChange} />
      </group>

      {/* Gold beam + central holo card */}
      <group position={[p.x, p.y, p.z]}>
        <mesh position={[0, (0.4 + FOCAL_BEAM_TOP) / 2, 0]}>
          <cylinderGeometry args={[0.022, 0.022, FOCAL_BEAM_TOP - 0.4, 8]} />
          <meshBasicMaterial
            color={GOLD}
            transparent
            opacity={0.7}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <Html position={[0, FOCAL_CARD_H, 0]} zIndexRange={[90, 0]} style={{ pointerEvents: "none" }}>
          <div style={{ transform: "translate(-50%, -100%)" }}>
            <FocalHoloCard focal={focal} neighbors={neighbors} snapshot={snapshot} />
          </div>
        </Html>
      </group>

      {/* Tunnel neighbors: ground link, anchor ring, stem, holo card. The
          neighbor network describes the PRESENT — viewing a past era dims it
          so the archive story owns the stage. */}
      {neighbors.map((nb) => {
        const np = graph.nodes[nb.idx]?.position
        if (!np) return null
        const dim = isNow ? 1 : 0.3
        return (
          <group key={nb.node.ref_id}>
            <Line
              points={[
                [p.x, ringY, p.z],
                [np.x, np.y + RING_LIFT, np.z],
              ]}
              color={TEAL}
              transparent
              opacity={0.55 * dim}
              lineWidth={1.4}
              dashed
              dashSize={0.45}
              gapSize={0.28}
            />
            <group position={[np.x, np.y + RING_LIFT, np.z]} rotation={[-Math.PI / 2, 0, 0]}>
              <mesh>
                <ringGeometry args={[0.45, 0.5, 48]} />
                <meshBasicMaterial color={TEAL} transparent opacity={0.7 * dim} depthWrite={false} />
              </mesh>
            </group>
            <group position={[np.x, np.y, np.z]}>
              <mesh position={[0, (0.3 + SAT_STEM_TOP) / 2, 0]}>
                <cylinderGeometry args={[0.016, 0.016, SAT_STEM_TOP - 0.3, 8]} />
                <meshBasicMaterial
                  color={TEAL}
                  transparent
                  opacity={0.6 * dim}
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                />
              </mesh>
              <Html
                position={[0, SAT_CARD_H, 0]}
                zIndexRange={[80, 0]}
                style={{ pointerEvents: "none" }}
              >
                <div
                  style={{
                    transform: "translate(-50%, -100%)",
                    pointerEvents: "auto",
                    opacity: dim,
                    transition: "opacity 400ms ease",
                  }}
                >
                  <SatelliteHoloCard neighbor={nb} onClick={() => onFocusNode(nb.idx)} />
                </div>
              </Html>
            </group>
          </group>
        )
      })}
    </group>
  )
}

// DOM chrome shown alongside the in-scene HUD: the zone plate (bottom-center)
// with the station's state + faction, and a small sector readout. Follows
// the time dial: past eras swap the zone word for the era title and show
// that era's controlling power.
export function StationZonePlate({ node, era }: { node: ApiNode; era: EraId }) {
  const props = node.properties as Record<string, unknown>
  const snapshots = useMemo(() => stationTimeline(node), [node])
  const snapshot = snapshots.find((s) => s.era === era) ?? snapshots[snapshots.length - 1]
  const isNow = snapshot.era === "now"
  const stateGlow = snapshot.statusGlow
  const nowFaction =
    typeof props.faction === "string" ? (FACTION_LABEL[props.faction] ?? null) : null
  const faction = isNow ? nowFaction : snapshot.faction
  const sector = `SEC-${String(hashCode(node.ref_id) % 999).padStart(3, "0")}`
  const title = isNow ? `${snapshot.status} ZONE` : `${snapshot.label} · ${snapshot.year}`

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 22,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        pointerEvents: "none",
        fontFamily: "var(--font-heading), sans-serif",
        color: INK,
        zIndex: 30,
      }}
    >
      <div
        style={{
          width: 5,
          height: 30,
          background: stateGlow,
          transform: "skewX(-18deg)",
          boxShadow: `0 0 10px ${stateGlow}`,
        }}
      />
      <div
        style={{
          transform: "skewX(-18deg)",
          border: `1px solid ${teal(0.5)}`,
          background: "rgba(4, 20, 20, 0.78)",
          padding: "6px 22px",
          boxShadow: `inset 0 0 16px ${teal(0.08)}`,
          maxWidth: "44vw",
        }}
      >
        <div style={{ transform: "skewX(18deg)" }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: 4,
              textShadow: `0 0 14px ${teal(0.6)}`,
              whiteSpace: "nowrap",
            }}
          >
            {title}
            <span style={{ fontSize: 9, letterSpacing: 2, color: INK_DIM, marginLeft: 12 }}>
              {faction ? `${faction} · ${sector}` : sector}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
