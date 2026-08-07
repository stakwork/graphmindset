"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ZoomIn, ZoomOut, Maximize2, X, ExternalLink, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  nodeById,
  nodeLabel,
  typeColor,
  getChapters,
  formatMs,
  parseTimestampMs,
  boardNodes,
  boardEdges,
  getTypeCounts,
  setBoardData,
  resetBoardData,
  type BoardNode,
} from "@/lib/board-dataset"
import { fetchEpisodeBoardData } from "@/lib/episode-board-data"
import { BoardView } from "./board-view"
import type { ZoomApi } from "./view-types"

interface PlayableExplorerProps {
  /** Pull this episode's graph from the backend. Omit only in tests (dataset preloaded). */
  episodeRefId?: string
  /** Overlay mode: called on Escape-with-nothing-selected and the close button. */
  onClose?: () => void
}

export function PlayableExplorer({ episodeRefId, onClose }: PlayableExplorerProps = {}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [showRelations, setShowRelations] = useState(true)
  // Bumped after every dataset swap so BoardView recomputes its layout memos.
  const [dataVersion, setDataVersion] = useState(0)
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    episodeRefId ? "loading" : "ready"
  )
  const [error, setError] = useState<string | null>(null)
  const zoomApiRef = useRef<ZoomApi | null>(null)

  const registerZoomApi = useCallback((api: ZoomApi | null) => {
    zoomApiRef.current = api
  }, [])

  // Dataset switch, handled during render (React's adjust-state pattern):
  // changing episodes resets selection/status; no episode clears the dataset.
  const [prevEpisodeRef, setPrevEpisodeRef] = useState(episodeRefId)
  if (prevEpisodeRef !== episodeRefId) {
    setPrevEpisodeRef(episodeRefId)
    setSelectedId(null)
    if (episodeRefId) {
      setStatus("loading")
      setError(null)
    } else {
      resetBoardData()
      setDataVersion((v) => v + 1)
      setStatus("ready")
    }
  }

  // Live pull for overlay mode (tests preload the dataset, no fetch needed).
  useEffect(() => {
    if (!episodeRefId) return
    let cancelled = false
    fetchEpisodeBoardData(episodeRefId)
      .then(({ nodes, edges }) => {
        if (cancelled) return
        setBoardData(nodes, edges, episodeRefId)
        setDataVersion((v) => v + 1)
        setStatus("ready")
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus("error")
      })
    return () => {
      cancelled = true
    }
  }, [episodeRefId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      // Progressive dismiss: close the detail panel first, then the overlay.
      if (selectedId) setSelectedId(null)
      else onClose?.()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selectedId, onClose])

  const selectedNode = selectedId ? nodeById.get(selectedId) : undefined

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background noise-bg">
      <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none" />
      {/* Ambient color wash — keeps the canvas from feeling flat */}
      <div className="pointer-events-none absolute -top-32 left-1/4 h-96 w-[36rem] rounded-full bg-primary/[0.07] blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 h-80 w-[30rem] rounded-full bg-[#7209b7]/[0.08] blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 right-8 h-64 w-64 rounded-full bg-[#fb8500]/[0.05] blur-3xl" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, oklch(0.08 0.022 260 / 0.85) 100%)",
        }}
      />

      {status === "ready" && (
        <BoardView
          dataVersion={dataVersion}
          selectedId={selectedId}
          hoveredId={hoveredId}
          showRelations={showRelations}
          onSelect={setSelectedId}
          onHover={setHoveredId}
          registerZoomApi={registerZoomApi}
        />
      )}

      {status === "loading" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            pulling episode graph…
          </span>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#e63946]">
            failed to load episode
          </span>
          <span className="max-w-md font-mono text-[10px] leading-relaxed text-muted-foreground">
            {error}
          </span>
          {onClose && (
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      )}

      {/* HUD header */}
      <div className="absolute top-4 left-5 z-20 pointer-events-none">
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          {episodeRefId ? "Episode board · live" : "Episode board"}
        </div>
        <div className="mt-1 font-mono text-[9px] tracking-[0.18em] uppercase text-muted-foreground/60">
          {boardNodes.length} nodes · {boardEdges.length} edges
        </div>
      </div>

      {/* Zoom controls + relations toggle */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1">
        <button
          onClick={() => setShowRelations((v) => !v)}
          className={`mr-1 rounded-md border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
            showRelations
              ? "border-primary/70 bg-primary/15 text-primary"
              : "border-border bg-card/80 text-muted-foreground hover:text-card-foreground"
          }`}
        >
          relations
        </button>
        <Button variant="outline" size="icon" className="h-8 w-8 bg-card/80" onClick={() => zoomApiRef.current?.zoomIn()}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8 bg-card/80" onClick={() => zoomApiRef.current?.zoomOut()}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8 bg-card/80" onClick={() => zoomApiRef.current?.reset()}>
          <Maximize2 className="h-4 w-4" />
        </Button>
        {onClose && (
          <Button variant="outline" size="icon" className="h-8 w-8 bg-card/80" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Hint */}
      <div className="absolute bottom-4 left-5 z-20 pointer-events-none font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/50">
        <div>drag to pan · scroll to zoom · zoom in for detail</div>
        <div className="mt-1 flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block h-0 w-4 border-t border-[#2ec4b6]" /> supports
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0 w-4 border-t border-[#e63946]" /> contradicts
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0 w-4 border-t border-dashed border-[#ff006e]" /> made claim
          </span>
        </div>
      </div>

      {/* Type legend (frames are gone — chips are anchored by meaning, color = type) */}
      <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 flex flex-wrap justify-center gap-x-4 gap-y-1 px-4 max-w-3xl pointer-events-none">
        {getTypeCounts().map(([type, count]) => (
          <span key={type} className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: typeColor(type) }} />
            {type} <span className="text-muted-foreground/40">{count}</span>
          </span>
        ))}
      </div>

      {/* Detail panel */}
      {selectedNode && <DetailPanel node={selectedNode} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

function prop(node: BoardNode, key: string): string | null {
  const v = node.properties?.[key]
  return typeof v === "string" && v.length > 0 ? v : null
}

function DetailPanel({ node, onClose }: { node: BoardNode; onClose: () => void }) {
  const chapter = useMemo(
    () => getChapters().find((c) => c.node.ref_id === node.ref_id),
    [node.ref_id]
  )
  const description = prop(node, "description") ?? prop(node, "summary") ?? prop(node, "claim_text")
  const transcript = prop(node, "transcript")
  const sourceLink = prop(node, "source_link")
  const mediaUrl = prop(node, "media_url")
  const clipMs = parseTimestampMs(node.properties.timestamp)
  const speaker = prop(node, "speaker_name")
  const triplicateSubject = prop(node, "triplicate_subject")
  const triplicatePredicate = prop(node, "triplicate_predicate")
  const triplicateObject = prop(node, "triplicate_object")

  let timeLine: string | null = null
  if (chapter) {
    timeLine = `${formatMs(chapter.startMs)} – ${formatMs(chapter.endMs)}`
  } else if (node.node_type === "Clip" && clipMs != null) {
    timeLine = `at ${formatMs(clipMs)}`
  } else if (node.node_type === "Episode") {
    const dur = Number(node.properties.duration)
    if (!Number.isNaN(dur) && dur > 0) timeLine = `duration ${formatMs(dur * 1000)}`
  }

  return (
    <div className="absolute bottom-4 right-4 z-30 w-84 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-card/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground"
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: typeColor(node.node_type) }} />
            {node.node_type}
          </span>
          <h3 className="mt-2 text-sm font-medium leading-snug text-card-foreground">
            {nodeLabel(node)}
          </h3>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-card-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {timeLine && <p className="mt-1.5 font-mono text-[11px] text-primary">{timeLine}</p>}
      {speaker && (
        <p className="mt-1.5 font-mono text-[11px] text-foreground/60">— {speaker}</p>
      )}
      {description && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      {triplicateSubject && triplicatePredicate && triplicateObject && (
        <div className="mt-2 rounded border border-border bg-muted/40 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-foreground/70">
          <span className="text-foreground/90">{triplicateSubject}</span>
          <span className="text-primary"> {triplicatePredicate} </span>
          <span className="text-foreground/90">{triplicateObject}</span>
        </div>
      )}
      {transcript && (
        <p className="mt-2 max-h-36 overflow-y-auto border-l-2 border-border pl-2 text-[11px] italic leading-relaxed text-muted-foreground/80">
          {transcript}
        </p>
      )}

      {mediaUrl && (
        <video
          src={mediaUrl}
          controls
          preload="metadata"
          className="mt-3 w-full rounded border border-border"
        />
      )}

      <div className="mt-3 flex flex-col gap-1">
        {sourceLink && (
          <a
            href={sourceLink}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> Source
          </a>
        )}
        {mediaUrl && (
          <a
            href={mediaUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> Media
          </a>
        )}
      </div>
    </div>
  )
}
