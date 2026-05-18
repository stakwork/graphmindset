"use client"

import { create } from "zustand"

interface AppState {
  searchTerm: string
  sidebarOpen: boolean
  myContentOpen: boolean
  sourcesOpen: boolean
  clipsOpen: boolean
  followingOpen: boolean
  agentOpen: boolean
  graphName: string
  graphDescription: string
  myContentRefreshKey: number
}

interface AppActions {
  setSearchTerm: (val: string) => void
  setSidebarOpen: (val: boolean) => void
  setMyContentOpen: (val: boolean) => void
  setSourcesOpen: (val: boolean) => void
  setClipsOpen: (val: boolean) => void
  setFollowingOpen: (open: boolean) => void
  setAgentOpen: (agentOpen: boolean) => void
  toggleMyContent: () => void
  toggleSources: () => void
  toggleFollowing: () => void
  toggleAgent: () => void
  closeAllPanels: () => void
  setGraphMeta: (name: string, description: string) => void
  bumpMyContentRefresh: () => void
}

export type AppStore = AppState & AppActions

export const useAppStore = create<AppStore>((set) => ({
  searchTerm: "",
  sidebarOpen: true,
  myContentOpen: false,
  sourcesOpen: false,
  clipsOpen: false,
  followingOpen: false,
  agentOpen: false,
  graphName: "",
  graphDescription: "",
  myContentRefreshKey: 0,
  setSearchTerm: (searchTerm) => set({ searchTerm }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setMyContentOpen: (myContentOpen) => set({ myContentOpen, sourcesOpen: false, clipsOpen: false, followingOpen: false, agentOpen: false }),
  setSourcesOpen: (sourcesOpen) => set({ sourcesOpen, myContentOpen: false, clipsOpen: false, followingOpen: false, agentOpen: false }),
  setClipsOpen: (clipsOpen) => set({ clipsOpen, sourcesOpen: false, myContentOpen: false, followingOpen: false, agentOpen: false }),
  setFollowingOpen: (open) => set({ followingOpen: open, sourcesOpen: false, myContentOpen: false, clipsOpen: false, agentOpen: false }),
  setAgentOpen: (agentOpen) => set({ agentOpen, sourcesOpen: false, myContentOpen: false, clipsOpen: false, followingOpen: false }),
  toggleMyContent: () =>
    set((s) => ({ myContentOpen: !s.myContentOpen, sourcesOpen: false, clipsOpen: false, followingOpen: false, agentOpen: false })),
  toggleSources: () =>
    set((s) => ({ sourcesOpen: !s.sourcesOpen, myContentOpen: false, clipsOpen: false, followingOpen: false, agentOpen: false })),
  toggleFollowing: () =>
    set((s) => ({ followingOpen: !s.followingOpen, sourcesOpen: false, myContentOpen: false, clipsOpen: false, agentOpen: false })),
  toggleAgent: () =>
    set((s) => ({ agentOpen: !s.agentOpen, sourcesOpen: false, myContentOpen: false, clipsOpen: false, followingOpen: false })),
  closeAllPanels: () => set({ sourcesOpen: false, myContentOpen: false, clipsOpen: false, followingOpen: false, agentOpen: false }),
  setGraphMeta: (graphName, graphDescription) =>
    set({ graphName, graphDescription }),
  bumpMyContentRefresh: () => set((s) => ({ myContentRefreshKey: s.myContentRefreshKey + 1 })),
}))
