"use client"

import { create } from "zustand"
import type { GraphNode } from "@/lib/graph-api"

type ModalId = "addContent" | "budget" | "addNode" | "editNode" | "addEdge" | null

interface ModalState {
  activeModal: ModalId
  editingNode: GraphNode | null
  sourceNode: GraphNode | null
  open: (id: ModalId) => void
  openEdit: (node: GraphNode) => void
  openAddEdge: (sourceNode?: GraphNode) => void
  close: () => void
}

export const useModalStore = create<ModalState>((set) => ({
  activeModal: null,
  editingNode: null,
  sourceNode: null,
  open: (activeModal) => set({ activeModal }),
  openEdit: (node) => set({ activeModal: "editNode", editingNode: node }),
  openAddEdge: (sourceNode?: GraphNode) => set({ activeModal: "addEdge", sourceNode: sourceNode ?? null }),
  close: () => set({ activeModal: null, editingNode: null, sourceNode: null }),
}))
