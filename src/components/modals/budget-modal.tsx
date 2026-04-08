"use client"

import { useCallback, useState } from "react"
import { Zap } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useModalStore } from "@/stores/modal-store"
import { useUserStore } from "@/stores/user-store"
import { isSphinx, getL402, hasWebLN, payL402 } from "@/lib/sphinx"
import { api } from "@/lib/api"

export function BudgetModal() {
  const { activeModal, close } = useModalStore()
  const { budget, setBudget } = useUserStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const sphinxConnected = typeof window !== "undefined" && isSphinx()
  const weblnAvailable = typeof window !== "undefined" && hasWebLN()

  const formattedBudget =
    budget !== null && budget !== undefined
      ? budget.toLocaleString()
      : "--"

  // Top up via Sphinx bridge (L402 flow)
  const handleSphinxTopUp = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      localStorage.removeItem("l402")
      const l402 = await getL402()
      if (!l402) {
        setError("Payment was not completed.")
        return
      }
      const balance = await api.get<{ balance: number }>("/balance", {
        Authorization: l402,
      })
      setBudget(balance.balance)
    } catch {
      setError("Failed to process payment. Try again.")
    } finally {
      setLoading(false)
    }
  }, [setBudget])

  // Top up via WebLN (browser extension like Alby)
  const handleWebLNTopUp = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      await payL402(setBudget)

      // Refresh balance after successful payment
      const l402 = await getL402()
      if (l402) {
        const balance = await api.get<{ balance: number }>("/balance", {
          Authorization: l402,
        })
        setBudget(balance.balance)
      }
    } catch {
      setError("Payment was cancelled or failed.")
    } finally {
      setLoading(false)
    }
  }, [setBudget])

  const handleRefreshBalance = useCallback(async () => {
    setLoading(true)
    try {
      const l402 = await getL402()
      if (!l402) {
        setBudget(0)
        return
      }
      const balance = await api.get<{ balance: number }>("/balance", {
        Authorization: l402,
      })
      setBudget(balance.balance)
    } catch {
      // keep existing budget
    } finally {
      setLoading(false)
    }
  }, [setBudget])

  const canTopUp = sphinxConnected || weblnAvailable

  return (
    <Dialog open={activeModal === "budget"} onOpenChange={() => close()}>
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg tracking-wide">
            Budget
          </DialogTitle>
          <DialogDescription>
            Manage your Lightning L402 balance.
          </DialogDescription>
        </DialogHeader>

        <div className="relative z-10 space-y-5 pt-2">
          {/* Balance display */}
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border/50 bg-muted/30 p-6">
            <Zap className="h-6 w-6 text-amber glow-text-amber" />
            <div className="text-center">
              <p className="text-3xl font-heading font-bold tracking-tight text-foreground">
                {formattedBudget}
              </p>
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mt-1">
                satoshis
              </p>
            </div>
          </div>

          {/* Connection status */}
          <div className="flex items-center gap-2 rounded-md border border-border/30 bg-muted/20 px-3 py-2.5">
            <div
              className={`h-2 w-2 rounded-full ${
                canTopUp
                  ? "bg-emerald-400 shadow-[0_0_4px_theme(colors.emerald.400)]"
                  : "bg-muted-foreground/40"
              }`}
            />
            <span className="text-xs text-muted-foreground">
              {sphinxConnected
                ? "Connected via Sphinx"
                : weblnAvailable
                  ? "WebLN detected (Alby, etc.)"
                  : "No Lightning wallet detected"}
            </span>
          </div>

          {error && (
            <p className="text-xs text-destructive text-center">{error}</p>
          )}

          <Separator className="bg-border/30" />

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {sphinxConnected && (
              <Button
                onClick={handleSphinxTopUp}
                disabled={loading}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
              >
                <Zap className="mr-2 h-3.5 w-3.5" />
                {loading ? "Processing..." : "Top Up via Sphinx"}
              </Button>
            )}

            {weblnAvailable && !sphinxConnected && (
              <Button
                onClick={handleWebLNTopUp}
                disabled={loading}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
              >
                <Zap className="mr-2 h-3.5 w-3.5" />
                {loading ? "Processing..." : "Top Up via WebLN"}
              </Button>
            )}

            {!canTopUp && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Install a Lightning wallet extension (like Alby) or connect via
                the Sphinx app to top up your balance.
              </p>
            )}

            <Button
              variant="ghost"
              onClick={handleRefreshBalance}
              disabled={loading}
              className="w-full text-xs text-muted-foreground"
            >
              Refresh Balance
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
