"use client"

import { useCallback, useEffect, useState } from "react"
import { enable, isAndroid, getL402 } from "@/lib/sphinx"
import type { IsAdminResponse } from "@/lib/sphinx"
import { api } from "@/lib/api"
import { useUserStore } from "@/stores/user-store"
import { useFeatureFlagStore } from "@/stores/feature-flag-store"
import { useAppStore } from "@/stores/app-store"
import { useMocks } from "@/lib/mock-data"

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [unauthorized, setUnauthorized] = useState(false)
  const [loading, setLoading] = useState(true)
  const { setBudget, setIsAdmin, setPubKey, setIsAuthenticated } = useUserStore()
  const setFlags = useFeatureFlagStore((s) => s.setFlags)
  const setGraphMeta = useAppStore((s) => s.setGraphMeta)

  const handleAuth = useCallback(async () => {
    localStorage.removeItem("admin")
    localStorage.removeItem("signature")

    try {
      if (isAndroid()) {
        await new Promise((r) => setTimeout(r, 5000))
      }

      // sphinx-bridge uses postMessage — works in Sphinx webview, no-ops in browser
      const result = await enable()
      if (result?.pubkey) {
        setPubKey(result.pubkey)
      }
    } catch {
      setPubKey("")
    }

    // Update budget from L402 balance
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
      setBudget(0)
    }
  }, [setBudget, setPubKey])

  const handleIsAdmin = useCallback(async () => {
    try {
      const res = await api.get<IsAdminResponse>("/isAdmin")

      if (!res.isPublic && !res.isAdmin && !res.isMember) {
        setUnauthorized(true)
        return
      }

      setIsAdmin(!!res.isAdmin)
      localStorage.setItem("admin", JSON.stringify({ isAdmin: res.isAdmin }))

      setFlags({
        trendingTopics: res.trendingTopics,
        queuedSources: res.queuedSources,
        customSchema: res.customSchema,
        realtimeGraph: res.realtimeGraph ?? false,
        chatInterface: res.chatInterface ?? false,
      })

      setIsAuthenticated(true)
    } catch {
      setIsAuthenticated(true)
    }
  }, [setIsAdmin, setFlags, setIsAuthenticated])

  const fetchGraphMeta = useCallback(async () => {
    try {
      const res = await api.get<{
        title?: string
        description?: string
      }>("/about")
      setGraphMeta(res.title ?? "Knowledge Graph", res.description ?? "")
    } catch {
      setGraphMeta("Knowledge Graph", "")
    }
  }, [setGraphMeta])

  useEffect(() => {
    const init = async () => {
      if (useMocks()) {
        // Dev mode: skip real auth, set admin + all flags
        setIsAdmin(true)
        setIsAuthenticated(true)
        setBudget(5000)
        setFlags({
          trendingTopics: true,
          queuedSources: true,
          customSchema: true,
          realtimeGraph: true,
          chatInterface: true,
          addItem: true,
          addContent: true,
          settings: true,
        })
        setGraphMeta("Dev Graph", "Local development instance")
        setLoading(false)
        return
      }

      // Always try sphinx-bridge enable — it uses postMessage internally.
      // In Sphinx webview: succeeds and sets isSphinx=true
      // In plain browser: times out silently and sets isSphinx=false
      await handleAuth()
      await Promise.all([handleIsAdmin(), fetchGraphMeta()])
      setLoading(false)
    }
    init()
  }, [handleAuth, handleIsAdmin, fetchGraphMeta, setIsAdmin, setIsAuthenticated, setBudget, setFlags, setGraphMeta])

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
        <p className="text-2xl font-semibold text-foreground text-center px-8">
          This is a private Graph. Contact the admin for access.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
