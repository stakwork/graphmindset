"use client"

import { create } from "zustand"

interface AppState {
  searchTerm: string
  sidebarOpen: boolean
  myContentOpen: boolean
  sourcesOpen: boolean
  graphName: string
  graphDescription: string
}

interface AppActions {
  setSearchTerm: (val: string) => void
  setSidebarOpen: (val: boolean) => void
  setMyContentOpen: (val: boolean) => void
  setSourcesOpen: (val: boolean) => void
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
  graphName: "",
  graphDescription: "",
  setSearchTerm: (searchTerm) => set({ searchTerm }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setMyContentOpen: (myContentOpen) => set({ myContentOpen, sourcesOpen: false }),
  setSourcesOpen: (sourcesOpen) => set({ sourcesOpen, myContentOpen: false }),
  toggleMyContent: () =>
    set((s) => ({ myContentOpen: !s.myContentOpen, sourcesOpen: false })),
  toggleSources: () =>
    set((s) => ({ sourcesOpen: !s.sourcesOpen, myContentOpen: false })),
  closeAllPanels: () => set({ sourcesOpen: false, myContentOpen: false }),
  setGraphMeta: (graphName, graphDescription) =>
    set({ graphName, graphDescription }),
}))
