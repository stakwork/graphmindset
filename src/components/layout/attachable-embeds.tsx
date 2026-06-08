"use client"

/**
 * AttachableEmbeds — renders a node's *attachable* neighbours as native embeds,
 * inline in the preview panel's content flow.
 *
 * Design intent (from the "attachables" handoff): no "CONTAINS / ATTACHED"
 * label ever reaches the screen. A node's attachments just render in its
 * natural content flow keyed off the child's type — images become a bonded
 * media grid + lightbox, episodes become a video-style hero card, everything
 * else a compact card. The only "what is this" cue is the type pill.
 *
 * Data: fetched scoped via getAttachables() (server-side `edge_props` filter),
 * NOT derived from the full neighbourhood — a node may have thousands of edges.
 */

import { useEffect, useMemo, useState, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { Play, Clock, Image as ImageIcon, ChevronRight, X, ChevronLeft, ImagePlus, Loader2, UploadCloud } from "lucide-react"

import {
  getAttachables,
  addImageContent,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_UPLOAD_BYTES,
} from "@/lib/graph-api"
import type { GraphNode } from "@/lib/graph-api"
import { resolveNodeTitle, resolveNodeThumbnail, pickString } from "@/lib/node-display"
import { displayNodeType, cn } from "@/lib/utils"
import { payL402 } from "@/lib/sphinx"
import { useUserStore } from "@/stores/user-store"
import { cookieStorage } from "@/lib/cookie-storage"
import { BoostButton } from "@/components/boost/boost-button"
import { BulletIcon } from "@/components/ui/bullet-icon"
import type { SchemaNode } from "@/app/ontology/page"

const ALLOWED_IMAGE_TYPE_SET = new Set<string>(ALLOWED_IMAGE_TYPES)

// Current boost on a node — `boost` is the canonical field, `num_boost` a
// legacy fallback (mirrors node-preview-panel).
function nodeBoost(node: GraphNode): number {
  const b = node.properties?.boost ?? node.properties?.num_boost
  return typeof b === "number" && b > 0 ? b : 0
}

interface AttachableEmbedsProps {
  nodeRefId: string
  schemas: SchemaNode[]
  onNavigate?: (node: GraphNode) => void
}

export function AttachableEmbeds({ nodeRefId, schemas, onNavigate }: AttachableEmbedsProps) {
  // Keyed by refId so a previous node's attachables never flash while a new
  // fetch is in flight, and so we never call setState synchronously in the effect.
  const [result, setResult] = useState<{ refId: string; peers: GraphNode[] } | null>(null)
  const [lightbox, setLightbox] = useState<{ images: GraphNode[]; index: number } | null>(null)
  // Bumped after a successful attach to re-pull the attachables for this node.
  const [reloadNonce, setReloadNonce] = useState(0)
  // Anyone signed in (admin, a pubkey, or an L402 balance) can attach — not
  // admins only. Matches the "Add Edge" gate in the node panel.
  const isAdmin = useUserStore((s) => s.isAdmin)
  const pubKey = useUserStore((s) => s.pubKey)
  const canAttach = isAdmin || !!pubKey || !!cookieStorage.getItem("l402")

  useEffect(() => {
    const controller = new AbortController()
    getAttachables(nodeRefId, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        const seen = new Set<string>()
        const others = (data.nodes ?? []).filter((n) => {
          if (n.ref_id === nodeRefId || seen.has(n.ref_id)) return false
          seen.add(n.ref_id)
          return true
        })
        setResult({ refId: nodeRefId, peers: others })
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ refId: nodeRefId, peers: [] })
      })
    return () => controller.abort()
  }, [nodeRefId, reloadNonce])

  const peers = result && result.refId === nodeRefId ? result.peers : null

  const { images, episodes, rest } = useMemo(() => {
    const list = peers ?? []
    return {
      images: list.filter((n) => n.node_type === "Image"),
      episodes: list.filter((n) => n.node_type === "Episode" || n.node_type === "Clip"),
      rest: list.filter((n) => n.node_type !== "Image" && n.node_type !== "Episode" && n.node_type !== "Clip"),
    }
  }, [peers])

  // With no attachables and no way to add → render nothing (no label, no empty
  // state). Signed-in users always get the section so they can add the first one.
  if ((!peers || peers.length === 0) && !canAttach) return null

  return (
    <div className="space-y-3">
      {episodes.map((ep) => (
        <EpisodeEmbed key={ep.ref_id} node={ep} schemas={schemas} onOpen={() => onNavigate?.(ep)} />
      ))}

      {images.length > 0 && (
        <MediaGrid images={images} onOpen={(i) => setLightbox({ images, index: i })} />
      )}

      {rest.map((n) => (
        <AttachableCard key={n.ref_id} node={n} schemas={schemas} onOpen={() => onNavigate?.(n)} />
      ))}

      {canAttach && (
        <AttachImageControl
          nodeRefId={nodeRefId}
          onAttached={() => setReloadNonce((n) => n + 1)}
        />
      )}

      {lightbox && (
        <Lightbox
          images={lightbox.images}
          index={lightbox.index}
          schemas={schemas}
          onClose={() => setLightbox(null)}
          onIndex={(i) => setLightbox((lb) => (lb ? { ...lb, index: i } : lb))}
        />
      )}
    </div>
  )
}

/* ── Episode / Clip — video-style hero card ─────────────────────────────── */
function EpisodeEmbed({
  node,
  schemas,
  onOpen,
}: {
  node: GraphNode
  schemas: SchemaNode[]
  onOpen: () => void
}) {
  const cover = resolveNodeThumbnail(node)
  const title = resolveNodeTitle(node, schemas)
  const duration = pickString(node.properties, "duration")
  const show =
    pickString(node.properties, "show") ??
    pickString(node.properties, "show_title") ??
    pickString(node.properties, "channel")

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-border/80">
      <button
        type="button"
        onClick={onOpen}
        className="group relative block w-full cursor-pointer bg-muted"
      >
        {cover ? (
          <img
            src={cover}
            alt=""
            className="aspect-video w-full object-cover transition-transform duration-500 group-hover:scale-[1.035]"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center bg-muted">
            <Play className="h-8 w-8 text-muted-foreground" />
          </div>
        )}
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/5 to-black/35" />
        <span className="absolute inset-0 m-auto flex h-13 w-13 items-center justify-center rounded-full bg-primary shadow-lg transition-transform group-hover:scale-105">
          <Play className="h-5 w-5 fill-primary-foreground text-primary-foreground" />
        </span>
        {duration && (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/65 px-2 py-1 font-mono text-[11px] text-white backdrop-blur-sm">
            <Clock className="h-3 w-3" /> {duration}
          </span>
        )}
      </button>
      <div className="px-4 pb-4 pt-3">
        <div className="mb-1.5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
          {displayNodeType(node.node_type)}
          {show ? ` · ${show}` : ""}
        </div>
        <h4 className="text-[15px] font-semibold leading-snug text-foreground">{title}</h4>
      </div>
    </article>
  )
}

/* ── Image mosaic — 1 = wide, 2-4 = grid, 5+ = +N ───────────────────────── */
function MediaGrid({ images, onOpen }: { images: GraphNode[]; onOpen: (index: number) => void }) {
  const n = images.length
  const cols = n === 1 ? 1 : n === 3 ? 3 : 2
  const cap = n > 4 ? 4 : n
  const shown = images.slice(0, cap)
  const extra = n - cap

  return (
    <div
      className="grid gap-1.5 overflow-hidden rounded-2xl"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {shown.map((im, i) => (
        // A tile is a div (not a button) so the interactive boost pill can live
        // inside it without nesting buttons. The full-bleed open button sits
        // beneath; decorative overlays are pointer-events-none so clicks fall
        // through to it; the boost pill sits on top with its own pointer events.
        <div
          key={im.ref_id}
          className={cn(
            "group relative overflow-hidden border border-border bg-muted",
            n === 1 ? "aspect-[16/10]" : "aspect-square"
          )}
        >
          <button
            type="button"
            onClick={() => onOpen(i)}
            aria-label="Open image"
            className="block h-full w-full cursor-pointer"
          >
            <ImageThumb node={im} variant="fill" />
          </button>
          <span className="pointer-events-none absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
            <ImageIcon className="h-4 w-4 text-white" />
          </span>
          {i === 0 && n > 1 && (
            <span className="pointer-events-none absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-black/70 px-2.5 py-1 font-mono text-[11px] text-primary backdrop-blur-sm">
              <ImageIcon className="h-3 w-3" /> {n} images
            </span>
          )}
          {i === cap - 1 && extra > 0 && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/60 text-xl font-bold text-foreground backdrop-blur-[1px]">
              +{extra}
            </span>
          )}
          {/* Current boost amount + trigger — always visible, FB/X-style. */}
          <div className="absolute bottom-2 left-2 z-10">
            <ImageBoost node={im} variant="compact" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Generic compact attachable (non-image, non-episode) ────────────────── */
function AttachableCard({
  node,
  schemas,
  onOpen,
}: {
  node: GraphNode
  schemas: SchemaNode[]
  onOpen: () => void
}) {
  const thumb = resolveNodeThumbnail(node)
  const title = resolveNodeTitle(node, schemas)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-border/80"
    >
      {thumb ? (
        <span className="h-12 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{title}</span>
      </span>
      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
        {displayNodeType(node.node_type)}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

/* ── Lightbox — fullscreen viewer with prev/next + thumbstrip ───────────── */
function Lightbox({
  images,
  index,
  schemas,
  onClose,
  onIndex,
}: {
  images: GraphNode[]
  index: number
  schemas: SchemaNode[]
  onClose: () => void
  onIndex: (i: number) => void
}) {
  const go = useCallback(
    (dir: number) => onIndex((index + dir + images.length) % images.length),
    [index, images.length, onIndex]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowRight") go(1)
      else if (e.key === "ArrowLeft") go(-1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go, onClose])

  const im = images[index]
  const src = resolveNodeThumbnail(im)

  // Portal to <body> so the overlay escapes the preview panel's scroll/transform
  // container — `position: fixed` is relative to a transformed ancestor, which
  // would otherwise trap the lightbox inside the panel instead of the viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/95 p-12 backdrop-blur-md"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-foreground hover:bg-white/10"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="absolute top-7 left-1/2 -translate-x-1/2 font-mono text-sm tracking-wide text-muted-foreground">
        {index + 1} / {images.length}
      </div>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); go(-1) }}
            className="absolute left-6 top-1/2 flex h-13 w-13 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/70 hover:bg-card"
            aria-label="Previous"
          >
            <ChevronLeft className="h-6 w-6 text-foreground" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); go(1) }}
            className="absolute right-6 top-1/2 flex h-13 w-13 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/70 hover:bg-card"
            aria-label="Next"
          >
            <ChevronRight className="h-6 w-6 text-foreground" />
          </button>
        </>
      )}

      <figure className="m-0 flex min-h-0 flex-1 flex-col items-center justify-center gap-3" onClick={(e) => e.stopPropagation()}>
        {src ? (
          <img src={src} alt="" className="max-h-[64vh] max-w-full rounded-xl border border-border object-contain" />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center rounded-xl border border-border bg-muted">
            <ImageIcon className="h-10 w-10 text-muted-foreground" />
          </div>
        )}
        <figcaption className="flex flex-col items-center gap-2.5 text-center">
          <span className="text-sm font-medium text-foreground">{resolveNodeTitle(im, schemas)}</span>
          <ImageBoost node={im} variant="compact" className="px-3 py-1 text-sm" />
        </figcaption>
      </figure>

      {images.length > 1 && (
        <div className="mt-4 flex max-w-[82vw] flex-wrap justify-center gap-2" onClick={(e) => e.stopPropagation()}>
          {images.map((g, i) => (
            <button
              key={g.ref_id}
              type="button"
              onClick={() => onIndex(i)}
              className={cn(
                "h-13 w-13 overflow-hidden rounded-lg border bg-muted transition-opacity",
                i === index ? "border-primary opacity-100 ring-1 ring-primary" : "border-border opacity-50 hover:opacity-90"
              )}
            >
              <ImageThumb node={g} />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  )
}

/* ── Image thumb with graceful fallback ─────────────────────────────────── */
// variant="cover" (default) center-crops to fill — fine for small uniform
// thumbnails. variant="fill" shows the WHOLE image (object-contain) over a
// blurred, zoomed copy of itself, so mismatched aspect ratios (e.g. a tall
// full-body shot next to a face crop) aren't cropped and leave no dead space.
function ImageThumb({
  node,
  variant = "cover",
}: {
  node: GraphNode
  variant?: "cover" | "fill"
}) {
  const src = resolveNodeThumbnail(node)
  if (!src) {
    return (
      <span className="flex h-full w-full items-center justify-center bg-muted">
        <ImageIcon className="h-5 w-5 text-muted-foreground" />
      </span>
    )
  }
  if (variant === "fill") {
    return (
      <span className="relative block h-full w-full overflow-hidden">
        <img
          src={src}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl"
        />
        <img
          src={src}
          alt=""
          className="relative h-full w-full object-contain transition-transform duration-500 group-hover:scale-105"
        />
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
    />
  )
}

/* ── Boost an image — shows current amount and lets anyone boost ─────────── */
// variant="default" → labelled button (lightbox caption).
// variant="compact" → glassy pill overlay (image tile / lightbox over the art).
function ImageBoost({
  node,
  variant = "default",
  className,
}: {
  node: GraphNode
  variant?: "default" | "compact"
  className?: string
}) {
  const p = node.properties ?? {}
  const ownerReference = typeof p.owner_reference_id === "string" ? p.owner_reference_id : undefined
  const pubkey = typeof p.pubkey === "string" ? p.pubkey : undefined
  const routeHint = typeof p.route_hint === "string" ? p.route_hint : undefined
  const boost = nodeBoost(node)

  // BoostButton handles the L402 flow and shows the live count. It needs an
  // owner to credit; without one we can only display the current amount.
  if (ownerReference) {
    return (
      <BoostButton
        refId={node.ref_id}
        ownerReference={ownerReference}
        pubkey={pubkey}
        routeHint={routeHint}
        boostCount={boost}
        variant={variant}
        className={className}
      />
    )
  }
  // No owner to credit — passive display only. Match the active pill's shape so
  // the grid stays visually consistent whether or not a tile is boostable.
  if (boost > 0) {
    if (variant === "compact") {
      return (
        <span className={cn("inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 font-mono text-[11px] text-amber-400 backdrop-blur-sm", className)}>
          <BulletIcon className="h-3 w-3" /> {boost}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 font-mono text-xs text-amber-400">
        <BulletIcon className="h-3 w-3" /> {boost} bullets
      </span>
    )
  }
  return null
}

/* ── Add image — drop / paste / browse → Image node + attachable edge ────── */
const maxMb = Math.round(MAX_IMAGE_UPLOAD_BYTES / 1024 / 1024)

// Run one paid call, settling the L402 once on a 402 and retrying that SAME
// call. Deliberately per-call: the image upload and the edge are retried
// independently, so a 402 on the (cheaper) edge step can never re-run — and
// re-charge for — the image upload.
async function withL402Retry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof Response && err.status === 402) {
      await payL402(() => {})
      return await fn()
    }
    throw err
  }
}

function AttachImageControl({
  nodeRefId,
  onAttached,
}: {
  nodeRefId: string
  onAttached: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function describeError(err: unknown): Promise<string> {
    if (err instanceof Response) {
      const body = (await err.json().catch(() => null)) as { message?: string; errorCode?: string } | null
      return body?.message || body?.errorCode || `Upload failed (${err.status})`
    }
    return err instanceof Error ? err.message : "Upload failed"
  }

  const handleFile = useCallback(
    async (file: File) => {
      if (!ALLOWED_IMAGE_TYPE_SET.has(file.type)) {
        setError("Use a JPEG, PNG, WebP, or GIF image")
        return
      }
      if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
        setError(`Image must be under ${maxMb} MB`)
        return
      }
      setBusy(true)
      setError(null)
      try {
        // Single paid step: boltwall uploads the Image node AND creates the
        // attachable edge to nodeRefId server-side, so the user is charged once.
        const res = await withL402Retry(() =>
          addImageContent(file, { attachTo: nodeRefId })
        )
        if (typeof res.nodes?.[0]?.ref_id !== "string") {
          throw new Error("image upload did not return a node ref_id")
        }
        // attached === false means the image uploaded but the edge insert
        // failed server-side — surface it rather than silently showing nothing.
        if (res.attached === false) {
          setError("Image uploaded but couldn't be attached — please try again")
          return
        }
        onAttached()
        setOpen(false)
      } catch (err) {
        setError(await describeError(err))
      } finally {
        setBusy(false)
      }
    },
    [nodeRefId, onAttached]
  )

  // Paste an image anywhere while the panel is open (e.g. a screenshot).
  useEffect(() => {
    if (!open) return
    const onPaste = (e: ClipboardEvent) => {
      const imageItem = Array.from(e.clipboardData?.items ?? []).find(
        (it) => it.kind === "file" && it.type.startsWith("image/")
      )
      const f = imageItem?.getAsFile()
      if (f) {
        e.preventDefault()
        handleFile(f)
      }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [open, handleFile])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (busy) return
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setError(null) }}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-card/40 px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border/80 hover:text-foreground"
      >
        <ImagePlus className="h-3.5 w-3.5" /> Add image
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/40 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <ImagePlus className="h-3.5 w-3.5" /> Add image
        </span>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null) }}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          if (f) handleFile(f)
        }}
      />

      {/* Drop / paste / browse zone */}
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-5 text-center transition-colors disabled:opacity-60",
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-border/80"
        )}
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <UploadCloud className="h-5 w-5 text-muted-foreground" />
        )}
        <span className="text-[11px] text-muted-foreground">
          {busy ? "Attaching…" : "Drag & drop, paste, or click to browse"}
        </span>
        <span className="text-[10px] text-muted-foreground/50">JPEG / PNG / WebP / GIF · max {maxMb} MB</span>
      </button>

      {error && (
        <p className="flex items-start gap-1 text-[11px] text-destructive">
          <X className="mt-0.5 h-3 w-3 shrink-0" /> {error}
        </p>
      )}
    </div>
  )
}
