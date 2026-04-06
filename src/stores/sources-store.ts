"use client"

import { create } from "zustand"

export interface Source {
  ref_id: string
  source: string
  source_type: string
}

interface SourcesState {
  sources: Source[]
  loading: boolean
  setSources: (sources: Source[]) => void
  setLoading: (loading: boolean) => void
  removeSource: (refId: string) => void
}

export const useSourcesStore = create<SourcesState>((set) => ({
  sources: [],
  loading: false,
  setSources: (sources) => set({ sources }),
  setLoading: (loading) => set({ loading }),
  removeSource: (refId) =>
    set((s) => ({ sources: s.sources.filter((src) => src.ref_id !== refId) })),
}))
