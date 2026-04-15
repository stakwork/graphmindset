"use client"

import { create } from "zustand"

interface AppState {
  searchTerm: string
  sidebarOpen: boolean
  myContentOpen: boolean
  graphName: string
  graphDescription: string
}

interface AppActions {
  setSearchTerm: (val: string) => void
  setSidebarOpen: (val: boolean) => void
  setMyContentOpen: (val: boolean) => void
  setGraphMeta: (name: string, description: string) => void
}

export type AppStore = AppState & AppActions

export const useAppStore = create<AppStore>((set) => ({
  searchTerm: "",
  sidebarOpen: true,
  myContentOpen: false,
  graphName: "",
  graphDescription: "",
  setSearchTerm: (searchTerm) => set({ searchTerm }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setMyContentOpen: (myContentOpen) => set({ myContentOpen }),
  setGraphMeta: (graphName, graphDescription) =>
    set({ graphName, graphDescription }),
}))
