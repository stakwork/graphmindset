"use client"

import { create } from "zustand"

interface AppState {
  searchTerm: string
  sidebarOpen: boolean
  myContentOpen: boolean
  sourcesOpen: boolean
  clipsOpen: boolean
  graphName: string
  graphDescription: string
}

interface AppActions {
  setSearchTerm: (val: string) => void
  setSidebarOpen: (val: boolean) => void
  setMyContentOpen: (val: boolean) => void
  setSourcesOpen: (val: boolean) => void
  setClipsOpen: (val: boolean) => void
  toggleMyContent: () => void
  toggleSources: () => void
  closeAllPanels: () => void
  setGraphMeta: (name: string, description: string) => void
}

export type AppStore = AppState & AppActions

export const useAppStore = create<AppStore>((set) => ({
  searchTerm: "",
  sidebarOpen: true,
  myContentOpen: false,
  sourcesOpen: false,
  clipsOpen: false,
  graphName: "",
  graphDescription: "",
  setSearchTerm: (searchTerm) => set({ searchTerm }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setMyContentOpen: (myContentOpen) => set({ myContentOpen, sourcesOpen: false, clipsOpen: false }),
  setSourcesOpen: (sourcesOpen) => set({ sourcesOpen, myContentOpen: false, clipsOpen: false }),
  setClipsOpen: (clipsOpen) => set({ clipsOpen, sourcesOpen: false, myContentOpen: false }),
  toggleMyContent: () =>
    set((s) => ({ myContentOpen: !s.myContentOpen, sourcesOpen: false, clipsOpen: false })),
  toggleSources: () =>
    set((s) => ({ sourcesOpen: !s.sourcesOpen, myContentOpen: false, clipsOpen: false })),
  closeAllPanels: () => set({ sourcesOpen: false, myContentOpen: false, clipsOpen: false }),
  setGraphMeta: (graphName, graphDescription) =>
    set({ graphName, graphDescription }),
}))
