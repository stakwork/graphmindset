"use client"

import { useEffect, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import type CameraControlsImpl from "camera-controls"
import { useCaseBoardStore } from "./case-board-store"

// Total morph duration in seconds — the time to ease from progress 0→1
// (open) or 1→0 (close). 1.2s feels deliberate without dragging.
const MORPH_DURATION_S = 1.2

function smoothstep(x: number) {
  return x * x * (3 - 2 * x)
}

interface CaseBoardAnimatorProps {
  // World position of the focal node when the morph is opening — drives the
  // camera move. Null when the case board isn't active.
  focalWorld: [number, number, number] | null
  cameraRef: React.RefObject<CameraControlsImpl | null>
}

// Drives morphProgress toward morphTarget each frame, and triggers the
// one-shot camera move to a case-board viewing angle when the morph opens.
// Lives inside the R3F Canvas so it can read state.camera via useFrame.
export function CaseBoardAnimator({ focalWorld, cameraRef }: CaseBoardAnimatorProps) {
  const target = useCaseBoardStore((s) => s.morphTarget)
  const setProgress = useCaseBoardStore((s) => s.setProgress)
  const linearRef = useRef(0)

  // Whenever target flips to 1 with a focal point, ease the camera to a
  // case-board view: slightly elevated, off to one side, looking at the focal.
  // The 60°-ish angle reads as "front of the node" without being dead-flat.
  // Close direction is handled by the parent's existing setCamTarget flow.
  useEffect(() => {
    if (target <= 0.001) return
    if (!focalWorld || !cameraRef.current) return
    const [fx, fy, fz] = focalWorld
    const dist = 28
    const elevation = 14
    const camX = fx + dist
    const camY = fy + elevation
    const camZ = fz + dist * 0.4
    cameraRef.current.setLookAt(camX, camY, camZ, fx, fy, fz, true)
  }, [target, focalWorld, cameraRef])

  useFrame((_, delta) => {
    const cur = linearRef.current
    if (Math.abs(cur - target) < 0.0005) {
      if (cur !== target) {
        linearRef.current = target
        setProgress(smoothstep(target))
      }
      return
    }
    const dir = target > cur ? 1 : -1
    const step = (delta / MORPH_DURATION_S) * dir
    let next = cur + step
    if (dir > 0 && next > target) next = target
    if (dir < 0 && next < target) next = target
    linearRef.current = next
    // Smoothstep applied at read so consumers (CaseCard opacity, future
    // sphere fade) see an eased curve in both directions.
    setProgress(smoothstep(next))
  })

  return null
}
