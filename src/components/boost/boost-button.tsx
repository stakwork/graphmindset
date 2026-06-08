"use client"

import { useCallback, useState } from "react"
import { BulletIcon } from "@/components/ui/bullet-icon"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { isMocksEnabled } from "@/lib/mock-data"
import { adminKeysend, hasWebLN, isSphinx, payL402 } from "@/lib/sphinx"
import { useUserStore } from "@/stores/user-store"
import { useModalStore } from "@/stores/modal-store"
import { parsePubkeyWithHint } from "@/lib/pubkey-utils"

const DEFAULT_BOOST_AMOUNT = 10

interface BoostButtonProps {
  refId: string
  ownerReference: string
  /** Optional — only used for the admin direct-keysend path. After phase-4d this
   *  field disappears from the API; admin boosts then fall through to /boost. */
  pubkey?: string
  routeHint?: string
  boostCount?: number
  className?: string
  /** "default" = labelled button; "compact" = single glassy pill that always
   *  shows the current total and doubles as the trigger (for image overlays). */
  variant?: "default" | "compact"
}

export function BoostButton({
  refId,
  ownerReference,
  pubkey,
  routeHint,
  boostCount = 0,
  className,
  variant = "default",
}: BoostButtonProps) {
  const [count, setCount] = useState(boostCount)
  const [boosting, setBoosting] = useState(false)
  const [flash, setFlash] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAdmin = useUserStore((s) => s.isAdmin)
  const setBudget = useUserStore((s) => s.setBudget)
  const refreshBalance = useUserStore((s) => s.refreshBalance)
  const openModal = useModalStore((s) => s.open)

  const handleBoost = useCallback(async () => {
    if (boosting) return
    setBoosting(true)
    setError(null)

    try {
      if (!isMocksEnabled()) {
        const adminDirect = isAdmin && isSphinx() && !!pubkey
        if (adminDirect) {
          // Admin path: pay directly from Sphinx wallet, then record. Requires a
          // real pubkey — when pubkey is unavailable (post-4d), falls through to
          // the /boost path below where boltwall keysends from its own node.
          const dest = routeHint ? { pubkey, route_hint: routeHint } : parsePubkeyWithHint(pubkey!)
          await adminKeysend(dest.pubkey, DEFAULT_BOOST_AMOUNT, dest.route_hint)
          await api.post("/boost/record", { refid: refId, amount: DEFAULT_BOOST_AMOUNT, ...dest })
        } else {
          // Regular path: L402-gated boost. Server resolves contributor identity
          // (keysend vs anon-credit) from the owner_reference_id.
          const body = { refid: refId, amount: DEFAULT_BOOST_AMOUNT, owner_reference_id: ownerReference }
          try {
            await api.post("/boost", body)
          } catch (err) {
            if (err instanceof Response && err.status === 402) {
              // 402 means no L402 token or insufficient balance. payL402 can
              // settle this inline only when a wallet is present (Sphinx app or
              // WebLN extension). Otherwise the user needs the QR top-up flow —
              // open the budget modal rather than throwing "No WebLN provider".
              if (!isSphinx() && !hasWebLN()) {
                openModal("budget")
                setError("Top up your balance to boost.")
                return
              }
              await payL402(setBudget)
              await api.post("/boost", body)
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
  }, [refId, ownerReference, pubkey, routeHint, boosting, isAdmin, setBudget, refreshBalance, openModal])

  if (variant === "compact") {
    // Single pill: always shows the current total and is itself the trigger.
    // Lives as an overlay on image tiles / the lightbox, so keep it tiny and
    // glassy. Errors are surfaced via the title tooltip (the no-wallet case
    // opens the budget modal from handleBoost).
    return (
      <button
        type="button"
        onClick={handleBoost}
        disabled={boosting}
        title={error ?? "Boost +" + DEFAULT_BOOST_AMOUNT}
        aria-label={`Boost — ${count} bullets`}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] backdrop-blur-sm transition-all",
          flash
            ? "bg-amber/20 text-amber"
            : "bg-black/70 text-amber-400 hover:bg-black/85 hover:text-amber",
          boosting && "cursor-wait opacity-60",
          className
        )}
      >
        <BulletIcon
          className={cn("h-3 w-3 transition-transform", flash && "scale-125")}
        />
        {count}
      </button>
    )
  }

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
        <BulletIcon
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
          {count > 0 ? "bullets" : "boost"}
        </span>
      </button>
      {error && (
        <span className="text-[10px] text-red-400">{error}</span>
      )}
    </div>
  )
}
