"use client"

import { Html } from "@react-three/drei"
import type { GraphNode } from "@/lib/graph-api"
import { CaseGroup } from "./case-group"

interface GroupMorphProps {
  // Card id (= group key).
  id: string
  type: string
  members: GraphNode[]
  expanded: boolean
  onToggle: () => void
  onMemberClick: (refId: string) => void
  // Pre-morph world position (focal point — groups fan out from the focal).
  originPosition: [number, number, number]
  // Resting world position on the case-board ring.
  targetPosition: [number, number, number]
  morphProgress: number
  portal?: React.RefObject<HTMLElement | null>
  // Registers the container DOM root so the connector overlay can attach
  // edges to the real card border.
  registerEl?: (el: HTMLElement | null) => void
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

// drei <Html> wrapper for a group container — same lerp / portal / z-index
// pattern as NodeMorph, but renders a CaseGroup at the group's world anchor.
export function GroupMorph({
  type,
  members,
  expanded,
  onToggle,
  onMemberClick,
  originPosition,
  targetPosition,
  morphProgress,
  portal,
  registerEl,
}: GroupMorphProps) {
  if (morphProgress <= 0.001) return null
  const t = Math.max(0, Math.min(1, morphProgress))
  const pos: [number, number, number] = [
    lerp(originPosition[0], targetPosition[0], t),
    lerp(originPosition[1], targetPosition[1], t),
    lerp(originPosition[2], targetPosition[2], t),
  ]
  return (
    <Html
      portal={portal as React.RefObject<HTMLElement> | undefined}
      position={pos}
      center
      // No distanceFactor — see NodeMorph: cards are a 2D DOM overlay sized by
      // CSS and only positioned by the projection. Avoids the stale-canvas-size
      // scaling bug; zoom is the board layer's CSS transform.
      zIndexRange={[16777500, 16777400]}
      style={{ pointerEvents: "auto" }}
    >
      <div ref={registerEl} style={{ display: "inline-block" }}>
        <CaseGroup
          type={type}
          members={members}
          expanded={expanded}
          morphProgress={morphProgress}
          onToggle={onToggle}
          onMemberClick={onMemberClick}
        />
      </div>
    </Html>
  )
}
