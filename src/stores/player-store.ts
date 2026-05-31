"use client"

import { create } from "zustand"
import type { GraphNode } from "@/lib/graph-api"

interface PlayerState {
  playingNode: GraphNode | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  // When set, the MediaPlayer portals its card into this DOM node instead of
  // rendering as a floating bottom-right overlay. Set by whatever UI wants to
  // host the player inline (e.g. NodePreviewPanel when its node is playing).
  host: HTMLElement | null
  // When true, the player takes over the full viewport regardless of host.
  isExpanded: boolean
  setPlayingNode: (node: GraphNode | null) => void
  setIsPlaying: (val: boolean) => void
  setCurrentTime: (val: number) => void
  setDuration: (val: number) => void
  setVolume: (val: number) => void
  setHost: (host: HTMLElement | null) => void
  setIsExpanded: (val: boolean) => void
  stop: () => void
}

export const usePlayerStore = create<PlayerState>((set) => ({
  playingNode: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  host: null,
  isExpanded: false,
  setPlayingNode: (playingNode) =>
    set({ playingNode, isPlaying: !!playingNode, currentTime: 0 }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => set({ volume }),
  setHost: (host) => set({ host }),
  setIsExpanded: (isExpanded) => set({ isExpanded }),
  stop: () => set({ playingNode: null, isPlaying: false, currentTime: 0, duration: 0, isExpanded: false }),
}))
