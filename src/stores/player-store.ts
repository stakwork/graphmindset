"use client"

import { create } from "zustand"
import type { GraphNode } from "@/lib/graph-api"

interface PlayerState {
  playingNode: GraphNode | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  setPlayingNode: (node: GraphNode | null) => void
  setIsPlaying: (val: boolean) => void
  setCurrentTime: (val: number) => void
  setDuration: (val: number) => void
  setVolume: (val: number) => void
  stop: () => void
}

export const usePlayerStore = create<PlayerState>((set) => ({
  playingNode: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  setPlayingNode: (playingNode) =>
    set({ playingNode, isPlaying: !!playingNode, currentTime: 0 }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => set({ volume }),
  stop: () => set({ playingNode: null, isPlaying: false, currentTime: 0, duration: 0 }),
}))
