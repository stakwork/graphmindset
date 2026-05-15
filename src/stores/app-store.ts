"use client"

import { create } from "zustand"

interface AppState {
  searchTerm: string
  sidebarOpen: boolean
  myContentOpen: boolean
  sourcesOpen: boolean
  clipsOpen: boolean
  followingOpen: boolean
  graphName: string
  graphDescription: string
}

interface AppActions {
  setSearchTerm: (val: string) => void
  setSidebarOpen: (val: boolean) => void
  setMyContentOpen: (val: boolean) => void
  setSourcesOpen: (val: boolean) => void
  setClipsOpen: (val: boolean) => void
  setFollowingOpen: (open: boolean) => void
  toggleMyContent: () => void
  toggleSources: () => void
  toggleFollowing: () => void
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
  followingOpen: false,
  graphName: "",
  graphDescription: "",
  setSearchTerm: (searchTerm) => set({ searchTerm }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setMyContentOpen: (myContentOpen) => set({ myContentOpen, sourcesOpen: false, clipsOpen: false, followingOpen: false }),
  setSourcesOpen: (sourcesOpen) => set({ sourcesOpen, myContentOpen: false, clipsOpen: false, followingOpen: false }),
  setClipsOpen: (clipsOpen) => set({ clipsOpen, sourcesOpen: false, myContentOpen: false, followingOpen: false }),
  setFollowingOpen: (open) => set({ followingOpen: open, sourcesOpen: false, myContentOpen: false, clipsOpen: false }),
  toggleMyContent: () =>
    set((s) => ({ myContentOpen: !s.myContentOpen, sourcesOpen: false, clipsOpen: false, followingOpen: false })),
  toggleSources: () =>
    set((s) => ({ sourcesOpen: !s.sourcesOpen, myContentOpen: false, clipsOpen: false, followingOpen: false })),
  toggleFollowing: () =>
    set((s) => ({ followingOpen: !s.followingOpen, sourcesOpen: false, myContentOpen: false, clipsOpen: false })),
  closeAllPanels: () => set({ sourcesOpen: false, myContentOpen: false, clipsOpen: false, followingOpen: false }),
  setGraphMeta: (graphName, graphDescription) =>
    set({ graphName, graphDescription }),
}))
