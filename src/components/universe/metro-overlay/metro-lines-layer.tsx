"use client"

import { useMemo } from "react"
import type { GraphNode as ApiNode, GraphEdge as ApiEdge } from "@/lib/graph-api"
import { MetroLineSegment } from "./metro-line-segment"
import {
  BLOCKING_STATES,
  MAP_Y_OFFSET,
  METRO_LINE_COLORS,
  statusToState,
  type StationState,
} from "./constants"

// Returns the lowercase metro line identifier(s) declared on a Station's
// properties. Reads `metro_line` first (the synced schema name) and falls
// back to legacy `line` for compatibility with older payloads.
function readStationLines(p: Record<string, unknown> | undefined): string[] {
  if (!p) return []
  const raw =
    (typeof p.metro_line === "string" ? p.metro_line : null) ??
    (typeof p.line === "string" ? p.line : null)
  if (!raw) return []
  return raw
    .split(",")
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean)
}

// Renders TUNNEL_TO edges as colored segments matching their metro line.
// Lives on top of the regular graph edge layer; the underlying purple
// cross-edges show through faintly which is fine — colored lines dominate.
// Renders nothing when no TUNNEL_TO edges are present, so safe to mount in
// non-metro themes.
export function MetroLinesLayer({
  nodes,
  edges,
  onLineHover,
  activeLines,
}: {
  nodes: ApiNode[]
  edges: ApiEdge[]
  onLineHover: (lineId: string | null) => void
  activeLines: Set<string> | null
}) {
  const segmentsByLine = useMemo(() => {
    const posByRefId = new Map<string, [number, number, number]>()
    const stateByStation = new Map<string, StationState>()
    for (const n of nodes) {
      const p = n.properties as Record<string, unknown> | undefined
      if (!p) continue
      if (typeof p.mapX !== "number" || typeof p.mapZ !== "number") continue
      const y = typeof p.mapY === "number" ? (p.mapY as number) : 0
      posByRefId.set(n.ref_id, [p.mapX as number, y + MAP_Y_OFFSET, p.mapZ as number])
      if (n.node_type === "Station") {
        // `station_status` is the synced schema name; `status` is the legacy.
        const status = p.station_status ?? p.status
        stateByStation.set(n.ref_id, statusToState(status, p.faction))
      }
    }

    // Per-line position arrays split into "open" (both endpoints safe) and
    // "blocked" (either endpoint in a BLOCKING_STATE). Rendered as two
    // separate LineSegments2 passes so each can carry its own opacity.
    const openByLine = new Map<string, number[]>()
    const blockedByLine = new Map<string, number[]>()
    const brownStations: Array<[number, number, number]> = []
    for (const e of edges) {
      if (e.edge_type !== "TUNNEL_TO") continue
      const props = (e as unknown as { properties?: Record<string, unknown> }).properties
      const lineStr = props?.line
      if (typeof lineStr !== "string") continue
      const primary = lineStr.split(",")[0].trim().toLowerCase()
      const start = posByRefId.get(e.source)
      const end = posByRefId.get(e.target)
      if (!start || !end) continue
      if (primary === "brown") {
        brownStations.push(start)
        continue
      }
      const srcState = stateByStation.get(e.source) ?? "neutral"
      const dstState = stateByStation.get(e.target) ?? "neutral"
      const isBlocked = BLOCKING_STATES.has(srcState) || BLOCKING_STATES.has(dstState)
      const target = isBlocked ? blockedByLine : openByLine
      let arr = target.get(primary)
      if (!arr) {
        arr = []
        target.set(primary, arr)
      }
      arr.push(start[0], start[1], start[2], end[0], end[1], end[2])
    }

    // Smooth the brown Koltsevaya ring: compute centroid + average radius
    // from its stations, then emit a high-resolution closed arc. Real metro
    // maps draw it as a perfect ring rather than a polygon.
    if (brownStations.length >= 3) {
      let cx = 0,
        cy = 0,
        cz = 0
      for (const p of brownStations) {
        cx += p[0]
        cy += p[1]
        cz += p[2]
      }
      cx /= brownStations.length
      cy /= brownStations.length
      cz /= brownStations.length
      let rSum = 0
      for (const p of brownStations) {
        const dx = p[0] - cx
        const dz = p[2] - cz
        rSum += Math.sqrt(dx * dx + dz * dz)
      }
      const r = rSum / brownStations.length
      const RING_SEGMENTS = 96
      const ring: number[] = []
      for (let i = 0; i < RING_SEGMENTS; i++) {
        const a1 = (i / RING_SEGMENTS) * Math.PI * 2
        const a2 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2
        ring.push(
          cx + Math.cos(a1) * r,
          cy,
          cz + Math.sin(a1) * r,
          cx + Math.cos(a2) * r,
          cy,
          cz + Math.sin(a2) * r,
        )
      }
      openByLine.set("brown", ring)
    }

    return { open: openByLine, blocked: blockedByLine }
  }, [nodes, edges])

  const lines = useMemo(() => {
    const set = new Set<string>()
    for (const k of segmentsByLine.open.keys()) set.add(k)
    for (const k of segmentsByLine.blocked.keys()) set.add(k)
    return Array.from(set)
  }, [segmentsByLine])

  // Reads of readStationLines belong on the consumer side; export for reuse.
  void readStationLines

  return (
    <>
      {lines.flatMap((line) => {
        const rgb = METRO_LINE_COLORS[line] ?? [1, 1, 1]
        // Lines rest at the dimmed look by default and only brighten to full
        // opacity when in focus — i.e. the line itself is hovered, or a node
        // sitting on it is hovered/selected (see `activeLines`). When nothing
        // is in focus (activeLines === null) every line stays dimmed.
        const dimmed = activeLines === null || !activeLines.has(line)
        const open = segmentsByLine.open.get(line)
        const blocked = segmentsByLine.blocked.get(line)
        const out: React.ReactElement[] = []
        if (open && open.length > 0) {
          out.push(
            <MetroLineSegment
              key={`${line}-open`}
              lineId={line}
              positions={new Float32Array(open)}
              color={rgb}
              onHover={onLineHover}
              dimmed={dimmed}
              baseOpacity={0.95}
            />,
          )
        }
        if (blocked && blocked.length > 0) {
          out.push(
            <MetroLineSegment
              key={`${line}-blocked`}
              lineId={line}
              positions={new Float32Array(blocked)}
              color={rgb}
              onHover={onLineHover}
              dimmed={dimmed}
              baseOpacity={0.22}
            />,
          )
        }
        return out
      })}
    </>
  )
}

export { readStationLines }
