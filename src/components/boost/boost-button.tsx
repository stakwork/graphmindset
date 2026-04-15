"use client"

import { useCallback, useState } from "react"
import { Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useMocks } from "@/lib/mock-data"
import { adminKeysend, isSphinx, payL402 } from "@/lib/sphinx"
import { useUserStore } from "@/stores/user-store"
import { parsePubkeyWithHint } from "@/lib/pubkey-utils"

const DEFAULT_BOOST_AMOUNT = 10

interface BoostButtonProps {
  refId: string
  pubkey: string
  routeHint?: string
  boostCount?: number
  className?: string
}

export function BoostButton({ refId, pubkey, routeHint, boostCount = 0, className }: BoostButtonProps) {
  const [count, setCount] = useState(boostCount)
  const [boosting, setBoosting] = useState(false)
  const [flash, setFlash] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAdmin = useUserStore((s) => s.isAdmin)
  const setBudget = useUserStore((s) => s.setBudget)
  const refreshBalance = useUserStore((s) => s.refreshBalance)

  const handleBoost = useCallback(async () => {
    if (boosting) return
    setBoosting(true)
    setError(null)

    // Prefer separate pubkey + route_hint props (new split storage);
    // fall back to parsing a compound pubkey for legacy callers.
    const dest = routeHint ? { pubkey, route_hint: routeHint } : parsePubkeyWithHint(pubkey)
    console.log("[boost] parsed dest:", dest)

    try {
      if (!useMocks()) {
        if (isAdmin && isSphinx()) {
          // Admin path: pay directly from Sphinx wallet, then record
          await adminKeysend(dest.pubkey, DEFAULT_BOOST_AMOUNT)
          await api.post("/boost/record", { refid: refId, amount: DEFAULT_BOOST_AMOUNT, ...dest })
        } else {
          // Regular user path: L402-gated boost
          try {
            await api.post("/boost", { refid: refId, amount: DEFAULT_BOOST_AMOUNT, ...dest })
          } catch (err) {
            // 402 = insufficient LSAT balance — buy/top-up and retry
            if (err instanceof Response && err.status === 402) {
              await payL402(setBudget)
              await api.post("/boost", { refid: refId, amount: DEFAULT_BOOST_AMOUNT, ...dest })
            } else {
              throw err
            }
          }
        }
      }

      setCount((c) => c + DEFAULT_BOOST_AMOUNT)
      setFlash(true)
      setTimeout(() => setFlash(false), 600)
      refreshBalance()
    } catch (err) {
      console.error("Boost failed:", err)
      setError("Boost failed. Please try again.")
    } finally {
      setBoosting(false)
    }
  }, [refId, pubkey, routeHint, boosting, isAdmin, setBudget, refreshBalance])

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={handleBoost}
        disabled={boosting}
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-all",
          flash
            ? "border-amber/50 bg-amber/10 text-amber"
            : "border-border/50 bg-muted/30 text-muted-foreground hover:border-amber/30 hover:text-amber",
          boosting && "opacity-50 cursor-wait",
          className
        )}
      >
        <Zap
          className={cn(
            "h-3 w-3 transition-transform",
            flash && "scale-125",
            count > 0 && "text-amber"
          )}
        />
        <span className="font-mono">
          {count > 0 ? count : DEFAULT_BOOST_AMOUNT}
        </span>
        <span className="text-[10px]">
          {count > 0 ? "sats" : "boost"}
        </span>
      </button>
      {error && (
        <span className="text-[10px] text-red-400">{error}</span>
      )}
    </div>
  )
}
