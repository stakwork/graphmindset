"use client"

import { useCallback, useRef, useEffect } from "react"
import { Play, Pause, X, Volume2, VolumeX, Maximize2, Minimize2 } from "lucide-react"
import { usePlayerStore } from "@/stores/player-store"
import { useSchemaStore } from "@/stores/schema-store"

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

  const getMedia = () => isVideo ? videoRef.current : audioRef.current

  // Sync play/pause with media element
  useEffect(() => {
    const media = getMedia()
    if (!media) return
    if (isPlaying) {
      media.play().catch(() => setIsPlaying(false))
    } else {
      media.pause()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, setIsPlaying, isVideo])

  // Update volume
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

  const controlBar = (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-sm">
      {/* Progress bar — clickable */}
      <div
        ref={progressRef}
        onClick={handleSeek}
        className="h-1 w-full cursor-pointer bg-muted group"
      >
        <div
          className="h-full bg-primary transition-[width] duration-100 group-hover:h-1.5"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-4 px-5 py-2.5">
        {/* Play/Pause */}
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

        {/* Track info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {title}
          </p>
          <p className="text-[10px] text-muted-foreground font-mono">
            {nodeType}
            {duration > 0 && (
              <span className="ml-2">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            )}
          </p>
        </div>

        {/* Volume */}
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

        {/* Close */}
        <button
          onClick={stop}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )

  if (isVideo) {
    return (
      <>
        {/* Floating video overlay */}
        {isExpanded ? (
          <div className="fixed inset-0 z-50 bg-black flex flex-col">
            {/* Overlay controls */}
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
              <button
                onClick={() => setIsExpanded(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
              <button
                onClick={stop}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <video
              ref={videoRef}
              src={mediaUrl}
              className="w-full h-full object-contain pb-12"
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={handleEnded}
            />
          </div>
        ) : (
          <div className="fixed bottom-16 right-4 z-50 w-72 rounded-lg overflow-hidden shadow-2xl border border-border">
            <div className="relative aspect-video bg-black">
              <video
                ref={videoRef}
                src={mediaUrl}
                className="w-full h-full object-contain"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={handleEnded}
              />
              {/* Mini overlay controls */}
              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                <button
                  onClick={() => setIsExpanded(true)}
                  className="flex h-6 w-6 items-center justify-center rounded bg-black/60 text-white hover:bg-black/80 transition-colors"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={stop}
                  className="flex h-6 w-6 items-center justify-center rounded bg-black/60 text-white hover:bg-black/80 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bottom control bar for video */}
        {controlBar}
      </>
    )
  }

  // Audio mode
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-sm">
      <audio
        ref={audioRef}
        src={mediaUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />

      {/* Progress bar — clickable */}
      <div
        ref={progressRef}
        onClick={handleSeek}
        className="h-1 w-full cursor-pointer bg-muted group"
      >
        <div
          className="h-full bg-primary transition-[width] duration-100 group-hover:h-1.5"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-4 px-5 py-2.5">
        {/* Play/Pause */}
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

        {/* Track info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {title}
          </p>
          <p className="text-[10px] text-muted-foreground font-mono">
            {nodeType}
            {duration > 0 && (
              <span className="ml-2">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            )}
          </p>
        </div>

        {/* Volume */}
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

        {/* Close */}
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
