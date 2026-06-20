"use client"

import { create } from "zustand"
import type { SkinId } from "@/skins/index"

interface AppState {
  searchTerm: string
  sidebarOpen: boolean
  myContentOpen: boolean
  sourcesOpen: boolean
  clipsOpen: boolean
  followingOpen: boolean
  agentOpen: boolean
  workflowsOpen: boolean
  graphName: string
  graphDescription: string
  myContentRefreshKey: number
  activeSkin: SkinId
}

interface AppActions {
  setSearchTerm: (val: string) => void
  setSidebarOpen: (val: boolean) => void
  setMyContentOpen: (val: boolean) => void
  setSourcesOpen: (val: boolean) => void
  setClipsOpen: (val: boolean) => void
  setFollowingOpen: (open: boolean) => void
  setAgentOpen: (agentOpen: boolean) => void
  setWorkflowsOpen: (val: boolean) => void
  toggleMyContent: () => void
  toggleSources: () => void
  toggleFollowing: () => void
  toggleAgent: () => void
  toggleWorkflows: () => void
  closeAllPanels: () => void
  setGraphMeta: (name: string, description: string) => void
  bumpMyContentRefresh: () => void
  setActiveSkin: (skin: SkinId) => void
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
  workflowsOpen: false,
  graphName: "",
  graphDescription: "",
  myContentRefreshKey: 0,
  activeSkin: "default" as SkinId,
  setSearchTerm: (searchTerm) => set({ searchTerm }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setMyContentOpen: (myContentOpen) => set({ myContentOpen, sourcesOpen: false, clipsOpen: false, followingOpen: false, agentOpen: false, workflowsOpen: false }),
  setSourcesOpen: (sourcesOpen) => set({ sourcesOpen, myContentOpen: false, clipsOpen: false, followingOpen: false, agentOpen: false, workflowsOpen: false }),
  setClipsOpen: (clipsOpen) => set({ clipsOpen, sourcesOpen: false, myContentOpen: false, followingOpen: false, agentOpen: false, workflowsOpen: false }),
  setFollowingOpen: (open) => set({ followingOpen: open, sourcesOpen: false, myContentOpen: false, clipsOpen: false, agentOpen: false, workflowsOpen: false }),
  setAgentOpen: (agentOpen) => set({ agentOpen, sourcesOpen: false, myContentOpen: false, clipsOpen: false, followingOpen: false, workflowsOpen: false }),
  setWorkflowsOpen: (workflowsOpen) => set({ workflowsOpen, sourcesOpen: false, myContentOpen: false, clipsOpen: false, followingOpen: false, agentOpen: false }),
  toggleMyContent: () =>
    set((s) => ({ myContentOpen: !s.myContentOpen, sourcesOpen: false, clipsOpen: false, followingOpen: false, agentOpen: false, workflowsOpen: false })),
  toggleSources: () =>
    set((s) => ({ sourcesOpen: !s.sourcesOpen, myContentOpen: false, clipsOpen: false, followingOpen: false, agentOpen: false, workflowsOpen: false })),
  toggleFollowing: () =>
    set((s) => ({ followingOpen: !s.followingOpen, sourcesOpen: false, myContentOpen: false, clipsOpen: false, agentOpen: false, workflowsOpen: false })),
  toggleAgent: () =>
    set((s) => ({ agentOpen: !s.agentOpen, sourcesOpen: false, myContentOpen: false, clipsOpen: false, followingOpen: false, workflowsOpen: false })),
  toggleWorkflows: () =>
    set((s) => ({ workflowsOpen: !s.workflowsOpen, sourcesOpen: false, myContentOpen: false, clipsOpen: false, followingOpen: false, agentOpen: false })),
  closeAllPanels: () => set({ sourcesOpen: false, myContentOpen: false, clipsOpen: false, followingOpen: false, agentOpen: false, workflowsOpen: false }),
  setGraphMeta: (graphName, graphDescription) =>
    set({ graphName, graphDescription }),
  bumpMyContentRefresh: () => set((s) => ({ myContentRefreshKey: s.myContentRefreshKey + 1 })),
  setActiveSkin: (activeSkin) => set({ activeSkin }),
}))
