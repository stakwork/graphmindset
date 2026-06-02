"use client"

import { useEffect, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import { Vector3 } from "three"
import type CameraControlsImpl from "camera-controls"
import { useCaseBoardStore } from "./case-board-store"

// Morph easing durations (seconds), asymmetric on purpose:
//  • OPEN  — the board blooms in. Snappy but not instant.
//  • CLOSE — dismissal should feel immediate, so it's roughly half the open.
//  • NAV   — a node-to-node switch re-blooms the new neighborhood; in between
//            open and close so it reads as a quick "settle", not a full open.
const OPEN_DURATION_S = 0.8
const CLOSE_DURATION_S = 0.4
const NAV_DURATION_S = 0.55
// On a node switch the morph drops to this progress and springs back to 1, so
// the new neighbors collapse toward the arrived node and fan back out — the cue
// that makes navigation read as travel instead of a teleport.
const NAV_DIP = 0.45

// Camera move durations (seconds):
//  • CAM_MOVE — the first fly-in from wherever the camera was to the board pose.
//  • NAV_MOVE — the hop from the old focal to the new one when switching nodes.
const CAM_MOVE_S = 0.85
const NAV_MOVE_S = 0.55

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
//
// When the focal node CHANGES while the board stays open (navigating to a
// neighbor), the camera fly + morph dip are re-armed so the transition is felt:
// the camera hops to the new node and its neighborhood blooms back out.
export function CaseBoardAnimator({ focalWorld, cameraRef }: CaseBoardAnimatorProps) {
  const target = useCaseBoardStore((s) => s.morphTarget)
  const setProgress = useCaseBoardStore((s) => s.setProgress)
  const linearRef = useRef(0)
  // Active opening/nav morph duration — CLOSE is chosen by direction below.
  const morphDurRef = useRef(OPEN_DURATION_S)

  // Camera fly state for the current open / nav hop.
  const camProgRef = useRef(1)
  const camStartPosRef = useRef<[number, number, number] | null>(null)
  const camStartLookRef = useRef<[number, number, number] | null>(null)
  const camDurRef = useRef(CAM_MOVE_S)
  const armedRef = useRef(false)
  // The focal we're currently flying toward — re-arms when it changes (= a
  // node switch), distinguishing "open" (was unarmed) from "navigate".
  const armedFocalRef = useRef<[number, number, number] | null>(null)
  const tmpPos = useRef(new Vector3())
  const tmpLook = useRef(new Vector3())

  // Re-arm on close so the next open re-captures a fresh start pose.
  useEffect(() => {
    if (target <= 0.001) {
      armedRef.current = false
      armedFocalRef.current = null
      morphDurRef.current = OPEN_DURATION_S
    }
  }, [target])

  useFrame((_, delta) => {
    const cam = cameraRef.current

    // --- Camera: steer to the board pose while open, hop on node switch ---
    if (cam && target > 0.001 && focalWorld) {
      const af = armedFocalRef.current
      const focalChanged =
        !af ||
        Math.abs(af[0] - focalWorld[0]) > 1e-3 ||
        Math.abs(af[1] - focalWorld[1]) > 1e-3 ||
        Math.abs(af[2] - focalWorld[2]) > 1e-3
      if (!armedRef.current || focalChanged) {
        // Already armed + focal moved ⇒ this is a node-to-node navigation.
        const isNav = armedRef.current
        const p = cam.getPosition(tmpPos.current)
        const l = cam.getTarget(tmpLook.current)
        camStartPosRef.current = [p.x, p.y, p.z]
        camStartLookRef.current = [l.x, l.y, l.z]
        camProgRef.current = 0
        camDurRef.current = isNav ? NAV_MOVE_S : CAM_MOVE_S
        armedRef.current = true
        armedFocalRef.current = focalWorld
        if (isNav) {
          // Collapse the neighborhood toward the new focal then spring it back
          // out (clamp so we never make it pop further in than it already is).
          linearRef.current = Math.min(linearRef.current, NAV_DIP)
          morphDurRef.current = NAV_DURATION_S
        } else {
          morphDurRef.current = OPEN_DURATION_S
        }
      }
      camProgRef.current = Math.min(1, camProgRef.current + delta / camDurRef.current)
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
    // Closing is faster than opening/nav; opening + nav re-bloom use morphDurRef.
    const dur = dir < 0 ? CLOSE_DURATION_S : morphDurRef.current
    const step = (delta / dur) * dir
    let next = cur + step
    if (dir > 0 && next > target) next = target
    if (dir < 0 && next < target) next = target
    linearRef.current = next
    setProgress(smoothstep(next))
  })

  return null
}
