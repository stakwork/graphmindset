"use client"

import { useEffect, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import { Vector3 } from "three"
import type CameraControlsImpl from "camera-controls"
import { useCaseBoardStore } from "./case-board-store"

// Total morph duration in seconds — the time to ease morphProgress 0→1 (open)
// or 1→0 (close). 1.2s feels deliberate without dragging.
const MORPH_DURATION_S = 1.2
// Camera fly-to-board-pose duration.
const CAM_MOVE_S = 0.9

// Board camera pose, as an offset from the focal node. MUST match
// CASE_BOARD_CAM_OFFSET in graph-canvas (which derives the right/up basis the
// neighbor cards are laid out in) — otherwise cards project to the wrong place.
const CAM_DX = 28
const CAM_DY = 14
const CAM_DZ = 11.2

function smoothstep(x: number) {
  return x * x * (3 - 2 * x)
}

interface CaseBoardAnimatorProps {
  // World position of the focal node when the morph is opening — drives the
  // camera move. Null while the graph is still computing the node position.
  focalWorld: [number, number, number] | null
  cameraRef: React.RefObject<CameraControlsImpl | null>
}

// Drives morphProgress toward morphTarget each frame, and continuously steers
// the camera to the case-board pose while the board is open.
//
// The camera move is enforced EVERY FRAME (not a one-shot setLookAt), eased
// from wherever the camera was when the board opened to the board pose, then
// held there. A one-shot move raced the select fly-in / CameraControls and
// lost — leaving the camera stuck close to the focal, which made the focal
// card huge and the neighbor cards tiny + clustered (they're laid out assuming
// the camera is at the board pose). Driving it each frame can't be lost to a
// race. Camera actions are locked to NONE while open, so nothing fights this.
export function CaseBoardAnimator({ focalWorld, cameraRef }: CaseBoardAnimatorProps) {
  const target = useCaseBoardStore((s) => s.morphTarget)
  const setProgress = useCaseBoardStore((s) => s.setProgress)
  const linearRef = useRef(0)

  // Camera fly-in state for the current open.
  const camProgRef = useRef(1)
  const camStartPosRef = useRef<[number, number, number] | null>(null)
  const camStartLookRef = useRef<[number, number, number] | null>(null)
  const armedRef = useRef(false)
  const tmpPos = useRef(new Vector3())
  const tmpLook = useRef(new Vector3())

  // Re-arm on close so the next open re-captures a fresh start pose.
  useEffect(() => {
    if (target <= 0.001) armedRef.current = false
  }, [target])

  useFrame((_, delta) => {
    const cam = cameraRef.current

    // --- Camera: steer to the board pose while open ---
    if (cam && target > 0.001 && focalWorld) {
      if (!armedRef.current) {
        // Capture the live camera pose as the animation start.
        const p = cam.getPosition(tmpPos.current)
        const l = cam.getTarget(tmpLook.current)
        camStartPosRef.current = [p.x, p.y, p.z]
        camStartLookRef.current = [l.x, l.y, l.z]
        camProgRef.current = 0
        armedRef.current = true
      }
      camProgRef.current = Math.min(1, camProgRef.current + delta / CAM_MOVE_S)
      const e = smoothstep(camProgRef.current)
      const [fx, fy, fz] = focalWorld
      const sp = camStartPosRef.current!
      const sl = camStartLookRef.current!
      const destPosX = fx + CAM_DX
      const destPosY = fy + CAM_DY
      const destPosZ = fz + CAM_DZ
      cam.setLookAt(
        sp[0] + (destPosX - sp[0]) * e,
        sp[1] + (destPosY - sp[1]) * e,
        sp[2] + (destPosZ - sp[2]) * e,
        sl[0] + (fx - sl[0]) * e,
        sl[1] + (fy - sl[1]) * e,
        sl[2] + (fz - sl[2]) * e,
        false,
      )
    }

    // --- Morph progress ---
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
    setProgress(smoothstep(next))
  })

  return null
}
