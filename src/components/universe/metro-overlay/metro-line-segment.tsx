"use client"

import { useMemo } from "react"
import { useThree } from "@react-three/fiber"
import * as THREE from "three"
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js"
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js"

export function MetroLineSegment({
  lineId,
  positions,
  color,
  onHover,
  dimmed,
  baseOpacity,
}: {
  lineId: string
  positions: Float32Array
  color: [number, number, number]
  onHover: (lineId: string | null) => void
  dimmed: boolean
  baseOpacity: number
}) {
  const { size } = useThree()

  const geometry = useMemo(() => {
    const g = new LineSegmentsGeometry()
    g.setPositions(Array.from(positions))
    return g
  }, [positions])

  // Dimming (from line-focus highlight) drops the whole segment to ~10% of
  // its natural opacity, preserving the open vs. blocked contrast even
  // while another line is in focus. Built into the memo so a dim toggle
  // rebuilds the material — cheap, and avoids post-memo mutation.
  const material = useMemo(() => {
    const opacity = dimmed ? baseOpacity * 0.1 : baseOpacity
    const m = new LineMaterial({
      color: new THREE.Color(color[0], color[1], color[2]).getHex(),
      // Pixel-space thickness — looks like a real metro map line.
      linewidth: 7,
      transparent: true,
      opacity,
      worldUnits: false,
      depthTest: true,
    })
    m.resolution.set(size.width, size.height)
    return m
  }, [color, size.width, size.height, baseOpacity, dimmed])

  const object = useMemo(() => new LineSegments2(geometry, material), [geometry, material])
  return (
    <primitive
      object={object}
      onPointerOver={(e: { stopPropagation: () => void }) => {
        e.stopPropagation()
        onHover(lineId)
      }}
      onPointerOut={(e: { stopPropagation: () => void }) => {
        e.stopPropagation()
        onHover(null)
      }}
    />
  )
}
