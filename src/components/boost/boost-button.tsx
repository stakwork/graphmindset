"use client"

import { useCallback, useState } from "react"
import { Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useMocks } from "@/lib/mock-data"

const DEFAULT_BOOST_AMOUNT = 10

interface BoostButtonProps {
  refId: string
  boostCount?: number
  className?: string
}

export function BoostButton({ refId, boostCount = 0, className }: BoostButtonProps) {
  const [count, setCount] = useState(boostCount)
  const [boosting, setBoosting] = useState(false)
  const [flash, setFlash] = useState(false)
  const mocks = useMocks()

  const handleBoost = useCallback(async () => {
    if (boosting) return
    setBoosting(true)
    try {
      if (!mocks) {
        await api.post('/boost', { refid: refId, amount: DEFAULT_BOOST_AMOUNT })
      }
      setCount((c) => c + DEFAULT_BOOST_AMOUNT)
      setFlash(true)
      setTimeout(() => setFlash(false), 600)
    } catch (err) {
      console.error('Boost failed:', err)
    } finally {
      setBoosting(false)
    }
  }, [refId, boosting, mocks])

  return (
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
  )
}
