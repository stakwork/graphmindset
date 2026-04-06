"use client"

import { create } from "zustand"

type ModalId = "settings" | "addContent" | "budget" | null

interface ModalState {
  activeModal: ModalId
  open: (id: ModalId) => void
  close: () => void
}

export const useModalStore = create<ModalState>((set) => ({
  activeModal: null,
  open: (activeModal) => set({ activeModal }),
  close: () => set({ activeModal: null }),
}))
