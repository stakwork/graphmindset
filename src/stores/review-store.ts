"use client"

import { create } from "zustand"

interface ReviewState {
  pendingCount: number
  setPendingCount: (n: number) => void
}

export const useReviewStore = create<ReviewState>((set) => ({
  pendingCount: 0,
  setPendingCount: (pendingCount) => set({ pendingCount }),
}))
