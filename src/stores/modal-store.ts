"use client"

import { create } from "zustand"
import type { GraphNode } from "@/lib/graph-api"

type ModalId = "add" | "budget" | "editNode" | null
export type AddTab = "source" | "node" | "edge"

interface ModalState {
  activeModal: ModalId
  // Which tab the unified Add modal opens on. Persisted across the modal's
  // lifetime so deep-links (e.g. "Add Edge" from a node) can target a tab.
  addTab: AddTab
  editingNode: GraphNode | null
  sourceNode: GraphNode | null
  open: (id: ModalId) => void
  openAdd: (tab?: AddTab) => void
  setAddTab: (tab: AddTab) => void
  openEdit: (node: GraphNode) => void
  openAddEdge: (sourceNode?: GraphNode) => void
  close: () => void
}

export const useModalStore = create<ModalState>((set) => ({
  activeModal: null,
  addTab: "source",
  editingNode: null,
  sourceNode: null,
  open: (activeModal) => set({ activeModal }),
  openAdd: (tab) => set({ activeModal: "add", addTab: tab ?? "source", sourceNode: null }),
  setAddTab: (tab) => set({ addTab: tab }),
  openEdit: (node) => set({ activeModal: "editNode", editingNode: node }),
  openAddEdge: (sourceNode?: GraphNode) =>
    set({ activeModal: "add", addTab: "edge", sourceNode: sourceNode ?? null }),
  close: () =>
    set({ activeModal: null, addTab: "source", editingNode: null, sourceNode: null }),
}))
