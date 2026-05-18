"use client"

import { useMemo } from "react"
import * as THREE from "three"
import type { GraphNode as ApiNode } from "@/lib/graph-api"
import {
  MAP_Y_OFFSET,
  METRO_LINE_COLORS,
  STATION_FILL,
  statusToState,
  type StationState,
} from "./constants"

// Schematic-style station bullets — a flat white-cream disc ringed in the
// station's primary line color, lying on the y=0 plane. This is what makes
// a metro map *look* like one; lines without bullets read as plain edges.
//
// Renders nothing when no Station nodes carry mapX/mapZ, so safe to mount
// in non-metro themes.
export function MetroStationBullets({
  nodes,
  activeLines,
  activeState,
}: {
  nodes: ApiNode[]
  activeLines: Set<string> | null
  activeState: StationState | null
}) {
  const bullets = useMemo(() => {
    const result: Array<{
      id: string
      x: number
      y: number
      z: number
      color: [number, number, number]
      lines: string[]
      fill: string
      state: StationState
    }> = []
    for (const n of nodes) {
      if (n.node_type !== "Station") continue
      const p = n.properties as Record<string, unknown> | undefined
      if (!p) continue
      if (typeof p.mapX !== "number" || typeof p.mapZ !== "number") continue
      const lineStrRaw =
        (typeof p.metro_line === "string" ? p.metro_line : null) ??
        (typeof p.line === "string" ? p.line : null)
      const lineStr = lineStrRaw ?? ""
      const lines = lineStr
        .split(",")
        .map((s: string) => s.trim().toLowerCase())
        .filter(Boolean)
      const primary = lines[0] ?? ""
      const color = METRO_LINE_COLORS[primary] ?? [0.85, 0.85, 0.85]
      const status = p.station_status ?? p.status
      const state = statusToState(status, p.faction)
      const fill = STATION_FILL[state]
      const baseY = typeof p.mapY === "number" ? (p.mapY as number) : 0
      result.push({
        id: n.ref_id,
        x: p.mapX as number,
        y: baseY + MAP_Y_OFFSET + 0.05,
        z: p.mapZ as number,
        color,
        lines,
        fill,
        state,
      })
    }
    return result
  }, [nodes])

  return (
    <group>
      {bullets.map((b) => {
        const lineDimmed =
          activeLines !== null && !b.lines.some((l) => activeLines.has(l))
        const stateDimmed = activeState !== null && b.state !== activeState
        const dimmed = lineDimmed || stateDimmed
        const opacity = dimmed ? 0.12 : 1
        return (
          <group
            key={b.id}
            position={[b.x, b.y, b.z]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <mesh>
              <ringGeometry args={[0.22, 0.27, 48]} />
              <meshBasicMaterial
                color={new THREE.Color(b.color[0], b.color[1], b.color[2])}
                transparent
                opacity={opacity}
              />
            </mesh>
            <mesh position={[0, 0, 0.001]}>
              <circleGeometry args={[0.22, 48]} />
              <meshBasicMaterial color={b.fill} transparent opacity={opacity} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
