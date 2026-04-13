"use client"

import { create } from "zustand"
import { getL402 } from "@/lib/sphinx"
import { api } from "@/lib/api"

interface UserState {
  isAdmin: boolean
  isAuthenticated: boolean
  pubKey: string
  budget: number | null
  nodeCount: number
}

interface UserActions {
  setIsAdmin: (val: boolean) => void
  setIsAuthenticated: (val: boolean) => void
  setPubKey: (val: string) => void
  setBudget: (val: number | null) => void
  incrementNodeCount: () => void
  resetNodeCount: () => void
  refreshBalance: () => Promise<void>
}

export type UserStore = UserState & UserActions

export const useUserStore = create<UserStore>((set) => ({
  isAdmin: false,
  isAuthenticated: false,
  pubKey: "",
  budget: 0,
  nodeCount: 0,
  setIsAdmin: (isAdmin) => set({ isAdmin }),
  setIsAuthenticated: (isAuthenticated) => set({ isAuthenticated }),
  setPubKey: (pubKey) => set({ pubKey }),
  setBudget: (budget) => set({ budget }),
  incrementNodeCount: () =>
    set((s) => ({ nodeCount: s.nodeCount + 1 })),
  resetNodeCount: () => set({ nodeCount: 0 }),
  refreshBalance: async () => {
    const l402 = await getL402()
    if (!l402) { set({ budget: 0 }); return }
    try {
      const bal = await api.get<{ balance: number }>("/balance", { Authorization: l402 })
      set({ budget: bal.balance })
    } catch {
      localStorage.removeItem("l402")
      set({ budget: 0 })
    }
  },
}))
