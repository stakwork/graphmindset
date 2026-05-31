"use client"

import { create } from "zustand"
import type { GraphNode } from "@/lib/graph-api"

type ModalId = "settings" | "addContent" | "budget" | "addNode" | "editNode" | "addEdge" | null

interface ModalState {
  activeModal: ModalId
  editingNode: GraphNode | null
  sourceRefId: string | null
  open: (id: ModalId) => void
  openEdit: (node: GraphNode) => void
  openAddEdge: (sourceRefId?: string) => void
  close: () => void
}

export const useModalStore = create<ModalState>((set) => ({
  activeModal: null,
  editingNode: null,
  sourceRefId: null,
  open: (activeModal) => set({ activeModal }),
  openEdit: (node) => set({ activeModal: "editNode", editingNode: node }),
  openAddEdge: (sourceRefId?: string) => set({ activeModal: "addEdge", sourceRefId: sourceRefId ?? null }),
  close: () => set({ activeModal: null, editingNode: null, sourceRefId: null }),
}))
