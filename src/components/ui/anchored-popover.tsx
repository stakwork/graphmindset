"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

interface AnchoredPopoverProps {
  // The element the popover floats next to (usually the trigger/input wrapper).
  anchorRef: React.RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
  // Match the anchor's width (the common case for selects/comboboxes).
  matchWidth?: boolean
  gap?: number
  // Upper bound on the surface height so a long list stays a tidy, scrollable
  // popover instead of stretching to fill the viewport.
  maxHeight?: number
}

interface Position {
  left: number
  width?: number
  top?: number
  bottom?: number
  maxHeight: number
}

// Above the Dialog content (16777274) so the list is never clipped by the
// modal's overflow.
const Z_INDEX = 16777275
const VIEWPORT_MARGIN = 8
const PREFERRED_MIN = 220
const DEFAULT_MAX_HEIGHT = 300

/**
 * A dropdown surface rendered in a portal with fixed positioning, anchored to a
 * trigger element. Because it lives at the document root it escapes any scroll
 * container (e.g. a modal's `overflow-y-auto`) instead of being clipped inside
 * it. Flips above the anchor when there isn't room below, and re-measures on
 * scroll/resize. Owns its own outside-click handling.
 */
export function AnchoredPopover({
  anchorRef,
  open,
  onClose,
  children,
  className,
  matchWidth = true,
  gap = 6,
  maxHeight = DEFAULT_MAX_HEIGHT,
}: AnchoredPopoverProps) {
  const popoverRef = React.useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = React.useState(false)
  const [pos, setPos] = React.useState<Position | null>(null)

  React.useEffect(() => setMounted(true), [])

  const compute = React.useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom - gap - VIEWPORT_MARGIN
    const spaceAbove = r.top - gap - VIEWPORT_MARGIN
    // Prefer below; flip up only when below is cramped and above has more room.
    const placeBelow = spaceBelow >= PREFERRED_MIN || spaceBelow >= spaceAbove
    const available = placeBelow ? spaceBelow : spaceAbove
    setPos({
      left: r.left,
      width: matchWidth ? r.width : undefined,
      top: placeBelow ? r.bottom + gap : undefined,
      bottom: placeBelow ? undefined : window.innerHeight - r.top + gap,
      // Cap to a tidy size, but never exceed the room actually available.
      maxHeight: Math.min(maxHeight, Math.max(120, available)),
    })
  }, [anchorRef, gap, matchWidth, maxHeight])

  // Position on open and keep it pinned as the page scrolls/resizes. Capture
  // scroll so we also catch scrolling inside ancestor containers (the modal).
  React.useLayoutEffect(() => {
    if (!open) return
    compute()
    const onScrollOrResize = () => compute()
    window.addEventListener("scroll", onScrollOrResize, true)
    window.addEventListener("resize", onScrollOrResize)
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true)
      window.removeEventListener("resize", onScrollOrResize)
    }
  }, [open, compute])

  // Close on a click outside both the anchor and the popover. Uses mousedown
  // (matching the components this replaced) — clicks inside the portal are
  // ignored, so selecting an option doesn't dismiss before the click lands.
  React.useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (anchorRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener("mousedown", onMouseDown, true)
    return () => document.removeEventListener("mousedown", onMouseDown, true)
  }, [open, onClose, anchorRef])

  if (!mounted || !open || !pos) return null

  return createPortal(
    <div
      ref={popoverRef}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        bottom: pos.bottom,
        width: pos.width,
        maxHeight: pos.maxHeight,
        zIndex: Z_INDEX,
      }}
      className={cn("flex flex-col overflow-hidden", className)}
    >
      {children}
    </div>,
    document.body
  )
}
