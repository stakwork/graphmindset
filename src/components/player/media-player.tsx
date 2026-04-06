"use client"

import { useCallback, useRef, useEffect } from "react"
import { Play, Pause, X, Volume2, VolumeX } from "lucide-react"
import { usePlayerStore } from "@/stores/player-store"

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
    setIsPlaying,
    setCurrentTime,
    setDuration,
    setVolume,
    stop,
  } = usePlayerStore()

  const audioRef = useRef<HTMLAudioElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)

  const mediaUrl =
    (playingNode?.properties?.media_url as string) ??
    (playingNode?.properties?.link as string) ??
    null

  const title =
    playingNode?.name ??
    (playingNode?.properties?.name as string) ??
    "Unknown"

  const nodeType = playingNode?.node_type ?? ""

  // Sync play/pause with audio element
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.play().catch(() => setIsPlaying(false))
    } else {
      audio.pause()
    }
  }, [isPlaying, setIsPlaying])

  // Update volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
    }
  }, [setCurrentTime])

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration)
    }
  }, [setDuration])

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const bar = progressRef.current
      if (!bar || !audioRef.current || !duration) return
      const rect = bar.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      audioRef.current.currentTime = ratio * duration
      setCurrentTime(ratio * duration)
    },
    [duration, setCurrentTime]
  )

  const handleEnded = useCallback(() => {
    setIsPlaying(false)
    setCurrentTime(0)
  }, [setIsPlaying, setCurrentTime])

  if (!playingNode || !mediaUrl) return null

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

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
