"use client"

import { useCallback, useState } from "react"
import { Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { isSphinx } from "@/lib/sphinx/detect"
import { api } from "@/lib/api"
import { useMocks } from "@/lib/mock-data"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sphinx = require("sphinx-bridge")

const SPHINX_PUBKEY = process.env.NEXT_PUBLIC_BOOST_PUBKEY ?? ""

const DEFAULT_BOOST_AMOUNT = 5

interface BoostButtonProps {
  refId: string
  boostCount?: number
  className?: string
}

export function BoostButton({ refId, boostCount = 0, className }: BoostButtonProps) {
  const [count, setCount] = useState(boostCount)
  const [boosting, setBoosting] = useState(false)
  const [flash, setFlash] = useState(false)

  const handleBoost = useCallback(async () => {
    if (boosting) return
    setBoosting(true)

    try {
      if (isSphinx()) {
        // Lightning keysend via Sphinx
        let res = await sphinx.enable(true)
        if (!res) throw new Error("Sphinx enable failed")

        res = await sphinx.keysend(SPHINX_PUBKEY, DEFAULT_BOOST_AMOUNT)

        if (!res?.success) {
          // Ask for topup then retry
          res = await sphinx.topup()
          if (!res) res = await sphinx.authorize()
          if (!res?.budget || res.budget < DEFAULT_BOOST_AMOUNT) {
            throw new Error("Insufficient budget")
          }
          res = await sphinx.keysend(SPHINX_PUBKEY, DEFAULT_BOOST_AMOUNT)
          if (!res?.success) throw new Error("Keysend failed")
        }
      }

      // Record boost on backend
      if (!useMocks()) {
        await api.post("/boost", {
          amount: DEFAULT_BOOST_AMOUNT,
          refid: refId,
        })
      }

      setCount((c) => c + DEFAULT_BOOST_AMOUNT)
      setFlash(true)
      setTimeout(() => setFlash(false), 600)
    } catch (err) {
      console.error("Boost failed:", err)
    } finally {
      setBoosting(false)
    }
  }, [refId, boosting])

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
