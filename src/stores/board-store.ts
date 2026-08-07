"use client"

import { create } from "zustand"

/** Drives the episode-board overlay: which episode is open (null = closed). */
interface BoardState {
  episodeRefId: string | null
  openBoard: (refId: string) => void
  closeBoard: () => void
}

export const useBoardStore = create<BoardState>((set) => ({
  episodeRefId: null,
  openBoard: (refId) => set({ episodeRefId: refId }),
  closeBoard: () => set({ episodeRefId: null }),
}))
