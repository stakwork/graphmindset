"use client"

import { useCallback, useEffect, useState } from "react"
import { Lock } from "lucide-react"
import { enable, isAndroid, getL402 } from "@/lib/sphinx"
import type { IsAdminResponse } from "@/lib/sphinx"
import { api } from "@/lib/api"
import { useUserStore } from "@/stores/user-store"
import { useAppStore } from "@/stores/app-store"
import { useMocks } from "@/lib/mock-data"
import { Separator } from "@/components/ui/separator"

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [unauthorized, setUnauthorized] = useState(false)
  const [loading, setLoading] = useState(true)
  const { setBudget, setIsAdmin, setPubKey, setRouteHint, setIsAuthenticated } = useUserStore()
  const setGraphMeta = useAppStore((s) => s.setGraphMeta)

  const handleAuth = useCallback(async () => {
    try {
      if (isAndroid()) {
        await new Promise((r) => setTimeout(r, 5000))
      }

      const result = await enable()
      console.log("[auth] enable() result:", JSON.stringify(result))

      if (result?.pubkey) {
        console.log("[auth] setting pubKey:", result.pubkey, "routeHint:", result.routeHint)
        setPubKey(result.pubkey)
        setRouteHint(result.routeHint ?? "")
      } else {
        console.log("[auth] no pubkey in enable() result")
      }
    } catch (err) {
      console.error("[auth] enable() failed:", err)
      setPubKey("")
      setRouteHint("")
    }

    const l402 = await getL402()
    if (!l402) {
      setBudget(0)
      return
    }

    try {
      const balance = await api.get<{ balance: number }>("/balance", {
        Authorization: l402,
      })
      setBudget(balance.balance)
    } catch {
      // L402 is stale or invalid — clear it so top-up/buy flows start fresh
      localStorage.removeItem("l402")
      setBudget(0)
    }
  }, [setBudget, setPubKey, setRouteHint])

  const handleIsAdmin = useCallback(async () => {
    // Local dev: skip /isAdmin call, grant admin
    if (process.env.NEXT_PUBLIC_DEV_ADMIN === "true") {
      setIsAdmin(true)
      setIsAuthenticated(true)
      return
    }

    try {
      const res = await api.get<{ data: IsAdminResponse }>("/isAdmin")
      const d = res.data

      if (!d.isPublic && !d.isAdmin && !d.isMember) {
        setUnauthorized(true)
        return
      }

      setIsAdmin(!!d.isAdmin)
      localStorage.setItem("admin", JSON.stringify({ isAdmin: d.isAdmin }))
      setIsAuthenticated(true)
    } catch {
      setIsAuthenticated(true)
    }
  }, [setIsAdmin, setIsAuthenticated])

  const fetchGraphMeta = useCallback(async () => {
    try {
      const res = await api.get<{
        title?: string
        description?: string
        mission_statement?: string
        search_term?: string
        app_version?: string
        seed_questions?: string
        limit?: number
        depth?: number
        sort_by?: string
        top_node_count?: number
      }>("/about")
      setGraphMeta(res.title ?? "Knowledge Graph", res.description ?? "")
    } catch {
      setGraphMeta("Knowledge Graph", "")
    }
  }, [setGraphMeta])

  useEffect(() => {
    const init = async () => {
      if (useMocks()) {
        setIsAdmin(true)
        setIsAuthenticated(true)
        setBudget(5000)
        setPubKey("mock-pub-key")
        setGraphMeta("Dev Graph", "Local development instance")
        setLoading(false)
        return
      }

      try {
        console.log("[auth] starting handleAuth...")
        await handleAuth()
        console.log("[auth] handleAuth done, starting isAdmin + graphMeta...")
        await Promise.all([handleIsAdmin(), fetchGraphMeta()])
        console.log("[auth] all done")
      } catch (err) {
        console.error("[auth] init failed:", err)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [handleAuth, handleIsAdmin, fetchGraphMeta, setIsAdmin, setIsAuthenticated, setBudget, setGraphMeta])

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (unauthorized) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="relative bg-card border border-border/50 rounded-2xl p-10 flex flex-col items-center gap-5 max-w-xs w-full mx-4 noise-bg glow-border">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
            <Lock className="h-5 w-5 text-primary" />
          </div>

          <div className="flex flex-col items-center gap-1">
            <span className="font-heading font-semibold text-xl tracking-wide text-foreground">GraphMindset</span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50">Knowledge Graph Explorer</span>
          </div>

          <Separator className="bg-border/30" />

          <div className="flex flex-col items-center gap-2">
            <span className="font-heading font-semibold text-base text-foreground">Members Only</span>
            <p className="text-sm text-muted-foreground text-center leading-relaxed">
              This graph is private and only accessible to its members.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
