"use client"

import { Html } from "@react-three/drei"
import type { GraphNode } from "@/lib/graph-api"
import { CaseCard } from "./case-card"

interface NodeMorphProps {
  // Card id (= focal/neighbor refId).
  id: string
  node: GraphNode
  // Where the node sits in the 3D scene before any morph happened — usually
  // its natural radial-layout position.
  originPosition: [number, number, number]
  // Where the card should land at full morph — for the focal this is the
  // same as origin; for neighbors it's a slot on the case-board ring.
  targetPosition: [number, number, number]
  variant: "selected" | "neighbor"
  morphProgress: number
  onClick?: () => void
  // Optional: where to portal the card DOM. Defaults to the canvas wrapper
  // (drei default). We pass a board-layer ref so the cards live inside a
  // div that the parent transforms for pan / zoom — keeps board movement
  // independent of the 3D camera.
  portal?: React.RefObject<HTMLElement | null>
  // Registers the card's DOM root so the connector overlay can measure its
  // real on-screen rectangle and attach edges to the actual card border.
  registerEl?: (el: HTMLElement | null) => void
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

// Renders a case-board card at a node's world position, interpolating from
// the original 3D location to the case-board ring slot as morph progresses.
// Lives inside the R3F Canvas; drei's <Html /> handles world→screen each
// frame so the card tracks the position as the camera moves.
export function NodeMorph({
  node,
  originPosition,
  targetPosition,
  variant,
  morphProgress,
  onClick,
  portal,
  registerEl,
}: NodeMorphProps) {
  if (morphProgress <= 0.001) return null
  const t = Math.max(0, Math.min(1, morphProgress))
  const pos: [number, number, number] = [
    lerp(originPosition[0], targetPosition[0], t),
    lerp(originPosition[1], targetPosition[1], t),
    lerp(originPosition[2], targetPosition[2], t),
  ]
  return (
    <Html
      // drei's Html types portal as RefObject<HTMLElement>, but useRef<T>(null)
      // returns RefObject<T | null>. Cast to satisfy the looser drei signature;
      // drei reads .current at runtime and is fine with either.
      portal={portal as React.RefObject<HTMLElement> | undefined}
      position={pos}
      center
      // No distanceFactor: the camera is locked at the board pose, so cards are
      // a 2D DOM overlay — they render at their natural CSS size and are only
      // POSITIONED by the 3D projection. distanceFactor coupled size to the
      // renderer's canvas size, which is briefly stale on open and only
      // refreshes on a real window resize — that was the "focal too big until I
      // resize" bug. Board zoom is handled by the board layer's CSS transform.
      // Must outrank both drei's default Html zIndexRange (used by GraphView's
      // node + edge labels at ~16.77M) and the cream backdrop. Kept just
      // below the close button so chrome wins.
      zIndexRange={[16777500, 16777400]}
      style={{ pointerEvents: "auto" }}
    >
      <div ref={registerEl} style={{ display: "inline-block" }}>
        <CaseCard
          node={node}
          variant={variant}
          morphProgress={morphProgress}
          onClick={onClick}
        />
      </div>
    </Html>
  )
}
