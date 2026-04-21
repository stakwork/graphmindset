"use client"

import { useCallback, useRef, useEffect, useState } from "react"
import { Play, Pause, X, Volume2, VolumeX, Maximize2, Minimize2 } from "lucide-react"
import { usePlayerStore } from "@/stores/player-store"
import { useSchemaStore } from "@/stores/schema-store"
import { cn } from "@/lib/utils"

function pickString(props: Record<string, unknown> | undefined, key: string | undefined): string | undefined {
  if (!props || !key) return undefined
  const v = props[key]
  return typeof v === "string" && v.length > 0 ? v : undefined
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function MediaPlayer() {
  const {
    playingNode,
    isPlaying,
    currentTime,
    duration,
    volume,
    host,
    isExpanded,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    setVolume,
    setIsExpanded,
    stop,
  } = usePlayerStore()

  const audioRef = useRef<HTMLAudioElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const [hostRect, setHostRect] = useState<DOMRect | null>(null)

  // Track the host element's position so the (always top-level) card can be
  // laid over it. Using one stable mount + CSS repositioning instead of a
  // portal avoids remounting the <video> element when the host disappears,
  // which would otherwise tear down playback.
  useEffect(() => {
    if (!host) {
      setHostRect(null)
      return
    }
    const update = () => setHostRect(host.getBoundingClientRect())
    update()
    const ro = new ResizeObserver(update)
    ro.observe(host)
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      ro.disconnect()
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [host])

  const mediaUrl =
    (playingNode?.properties?.media_url as string) ??
    (playingNode?.properties?.link as string) ??
    null

  const schemas = useSchemaStore((s) => s.schemas)
  const schema = schemas.find((s) => s.type === playingNode?.node_type)
  const props = playingNode?.properties
  const title =
    pickString(props, schema?.title_key) ??
    pickString(props, schema?.index) ??
    (props?.name as string) ??
    "Unknown"

  const nodeType = playingNode?.node_type ?? ""
  const isVideo = typeof mediaUrl === "string" && /\.(mp4|webm|mov)/i.test(mediaUrl)
  const getMedia = () => (isVideo ? videoRef.current : audioRef.current)

  useEffect(() => {
    const media = getMedia()
    if (!media) return
    if (isPlaying) media.play().catch(() => setIsPlaying(false))
    else media.pause()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, setIsPlaying, isVideo])

  useEffect(() => {
    const media = getMedia()
    if (media) media.volume = volume
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, isVideo])

  const handleTimeUpdate = useCallback(() => {
    const media = getMedia()
    if (media) setCurrentTime(media.currentTime)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setCurrentTime, isVideo])

  const handleLoadedMetadata = useCallback(() => {
    const media = getMedia()
    if (media) setDuration(media.duration)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setDuration, isVideo])

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const bar = progressRef.current
      const media = getMedia()
      if (!bar || !media || !duration) return
      const rect = bar.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      media.currentTime = ratio * duration
      setCurrentTime(ratio * duration)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [duration, setCurrentTime, isVideo]
  )

  const handleEnded = useCallback(() => {
    setIsPlaying(false)
    setCurrentTime(0)
  }, [setIsPlaying, setCurrentTime])

  if (!playingNode || !mediaUrl) return null

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  const style: React.CSSProperties = isExpanded
    ? {
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 60,
      }
    : hostRect
    ? {
        position: "fixed",
        top: hostRect.top,
        left: hostRect.left,
        width: hostRect.width,
        zIndex: 50,
      }
    : {
        position: "fixed",
        bottom: 16,
        right: 16,
        width: 320,
        zIndex: 50,
      }

  return (
    <div
      style={style}
      className={cn(
        "overflow-hidden bg-card/95 backdrop-blur-sm flex flex-col",
        isExpanded
          ? "bg-black"
          : cn("border border-border rounded-md", hostRect ? "" : "shadow-xl")
      )}
    >
      {isVideo ? (
        <video
          ref={videoRef}
          src={mediaUrl}
          className={cn(
            "w-full object-contain bg-black",
            isExpanded ? "flex-1 min-h-0" : "aspect-video"
          )}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
        />
      ) : (
        <audio
          ref={audioRef}
          src={mediaUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
        />
      )}

      <div
        ref={progressRef}
        onClick={handleSeek}
        className="h-1 w-full cursor-pointer bg-muted group shrink-0"
      >
        <div
          className="h-full bg-primary transition-[width] duration-100 group-hover:h-1.5"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-3 px-3 py-2 shrink-0">
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {isPlaying ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5 ml-0.5" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate">{title}</p>
          <p className="text-[10px] text-muted-foreground font-mono truncate">
            {nodeType}
            {duration > 0 && (
              <span className="ml-2">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            )}
          </p>
        </div>

        <button
          onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {volume > 0 ? (
            <Volume2 className="h-4 w-4" />
          ) : (
            <VolumeX className="h-4 w-4" />
          )}
        </button>

        {isVideo && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {isExpanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        )}

        <button
          onClick={stop}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
