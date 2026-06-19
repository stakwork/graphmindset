"use client"

import { create } from "zustand"
import type { GraphNode } from "@/lib/graph-api"

type ModalId = "add" | "budget" | "editNode" | null
export type AddTab = "source" | "node" | "edge"

interface ModalState {
  activeModal: ModalId
  // The budget/top-up modal is an independent OVERLAY (not part of activeModal)
  // so it can appear on top of another modal — e.g. when an in-form paid action
  // hits a 402 — without closing it. Keeping it separate means the underlying
  // form (Add Edge, Add Node, …) stays mounted and keeps its progress.
  budgetOpen: boolean
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
  openBudget: () => void
  closeBudget: () => void
  close: () => void
}

export const useModalStore = create<ModalState>((set) => ({
  activeModal: null,
  budgetOpen: false,
  addTab: "source",
  editingNode: null,
  sourceNode: null,
  // Route "budget" to the overlay so existing open("budget") callers show it on
  // top of whatever is open instead of replacing it.
  open: (id) => set(id === "budget" ? { budgetOpen: true } : { activeModal: id }),
  openAdd: (tab) => set({ activeModal: "add", addTab: tab ?? "source", sourceNode: null }),
  setAddTab: (tab) => set({ addTab: tab }),
  openEdit: (node) => set({ activeModal: "editNode", editingNode: node }),
  openAddEdge: (sourceNode?: GraphNode) =>
    set({ activeModal: "add", addTab: "edge", sourceNode: sourceNode ?? null }),
  openBudget: () => set({ budgetOpen: true }),
  // Dismiss only the budget overlay, leaving any underlying modal (and its
  // in-progress form state) intact.
  closeBudget: () => set({ budgetOpen: false }),
  close: () =>
    set({
      activeModal: null,
      addTab: "source",
      editingNode: null,
      sourceNode: null,
      budgetOpen: false,
    }),
}))
