"use client"

import { create } from "zustand"
import type { GraphNode } from "@/lib/graph-api"

type ModalId = "settings" | "addContent" | "budget" | "addNode" | "editNode" | null

interface ModalState {
  activeModal: ModalId
  editingNode: GraphNode | null
  open: (id: ModalId) => void
  openEdit: (node: GraphNode) => void
  close: () => void
}

export const useModalStore = create<ModalState>((set) => ({
  activeModal: null,
  editingNode: null,
  open: (activeModal) => set({ activeModal }),
  openEdit: (node) => set({ activeModal: "editNode", editingNode: node }),
  close: () => set({ activeModal: null, editingNode: null }),
}))
