"use client"

import { create } from "zustand"

interface AppState {
  searchTerm: string
  sidebarOpen: boolean
  graphName: string
  graphDescription: string
}

interface AppActions {
  setSearchTerm: (val: string) => void
  setSidebarOpen: (val: boolean) => void
  setGraphMeta: (name: string, description: string) => void
}

export type AppStore = AppState & AppActions

export const useAppStore = create<AppStore>((set) => ({
  searchTerm: "",
  sidebarOpen: true,
  graphName: "",
  graphDescription: "",
  setSearchTerm: (searchTerm) => set({ searchTerm }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setGraphMeta: (graphName, graphDescription) =>
    set({ graphName, graphDescription }),
}))
