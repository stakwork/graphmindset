"use client"

import { create } from "zustand"

interface CaseBoardState {
  // ref_id of the focal node; null = no case board ever opened or fully closed
  selectedRefId: string | null
  // 0 = pre-morph (3D scene), 1 = fully morphed (case board). Eased by the
  // CaseBoardAnimator each frame; read by CaseCard for opacity + drop-in.
  morphProgress: number
  // Target progress the animator eases toward. open() sets to 1, close() to 0.
  morphTarget: number
  open: (refId: string) => void
  close: () => void
  setProgress: (p: number) => void
}

export const useCaseBoardStore = create<CaseBoardState>((set) => ({
  selectedRefId: null,
  morphProgress: 0,
  morphTarget: 0,
  open: (refId) =>
    set((s) => ({
      selectedRefId: refId,
      morphTarget: 1,
      // Re-focusing on a different node mid-morph keeps the existing progress
      // so the camera/card animation continues without a visible reset.
      morphProgress: s.selectedRefId === refId ? s.morphProgress : s.morphProgress,
    })),
  close: () => set({ morphTarget: 0 }),
  setProgress: (p) =>
    set((s) => {
      // Once the close animation has fully settled, drop the selection so the
      // 3D scene can fully reclaim the node and the animator goes idle.
      if (p <= 0.001 && s.morphTarget <= 0.001) {
        return { morphProgress: 0, selectedRefId: null }
      }
      return { morphProgress: p }
    }),
}))
