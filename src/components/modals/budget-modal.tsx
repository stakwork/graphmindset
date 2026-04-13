"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Zap, Copy, Check, Loader2, ArrowLeft } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
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
import { isSphinx, getL402, hasWebLN, payInvoice, payL402, topUpLsat, topUpConfirm } from "@/lib/sphinx"
import { api } from "@/lib/api"

type Step = "balance" | "amount" | "invoice" | "success"

const PRESET_AMOUNTS = [50, 100, 500, 1000]

export function BudgetModal() {
  const { activeModal, close } = useModalStore()
  const { budget, setBudget } = useUserStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [step, setStep] = useState<Step>("balance")

  // Amount & invoice state
  const [amount, setAmount] = useState<number | null>(null)
  const [paymentRequest, setPaymentRequest] = useState("")
  const [paymentHash, setPaymentHash] = useState("")
  const [copied, setCopied] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const sphinxConnected = typeof window !== "undefined" && isSphinx()
  const weblnAvailable = typeof window !== "undefined" && hasWebLN()
  const hasExistingL402 =
    typeof window !== "undefined" && !!localStorage.getItem("l402")

  const formattedBudget =
    budget !== null && budget !== undefined
      ? budget.toLocaleString()
      : "--"

  const resetState = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setStep("balance")
    setAmount(null)
    setPaymentRequest("")
    setPaymentHash("")
    setCopied(false)
    setError("")
    setLoading(false)
  }, [])

  useEffect(() => {
    if (activeModal !== "budget") resetState()
  }, [activeModal, resetState])

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const refreshBalance = useCallback(async () => {
    const l402 = await getL402()
    if (l402) {
      const bal = await api.get<{ balance: number }>("/balance", {
        Authorization: l402,
      })
      setBudget(bal.balance)
    }
  }, [setBudget])

  // Route "Top Up" to the right flow
  const handleTopUp = useCallback(async () => {
    const stored = localStorage.getItem("l402")

    if (stored) {
      // Has existing L402 — go to amount step to top up
      setStep("amount")
      return
    }

    // No L402 — need to buy one first
    if (!sphinxConnected && !weblnAvailable) {
      setError("Connect a Lightning wallet to get started.")
      return
    }

    setLoading(true)
    setError("")
    try {
      await payL402(setBudget)
      await refreshBalance()
    } catch {
      setError("Payment was cancelled or failed. Try again.")
    } finally {
      setLoading(false)
    }
  }, [sphinxConnected, weblnAvailable, setBudget, refreshBalance])

  // Pay with selected amount — same flow for Sphinx, WebLN, and manual
  const handlePay = useCallback(async () => {
    if (!amount || amount < 1 || amount > 10000) {
      setError("Enter an amount between 1 and 10,000 sats.")
      return
    }

    setError("")
    setLoading(true)

    const stored = localStorage.getItem("l402")
    if (!stored) {
      // No L402 — shouldn't happen (handleTopUp guards this), but handle it
      setError("No L402 token. Go back and connect a wallet first.")
      setLoading(false)
      return
    }

    const { macaroon } = JSON.parse(stored)

    try {
      const result = await topUpLsat(macaroon, amount)

      // Sphinx or WebLN: pay the invoice directly
      if (sphinxConnected || weblnAvailable) {
        const payment = await payInvoice(result.payment_request, macaroon)
        if (!payment) {
          setError("Payment was cancelled or failed.")
          setLoading(false)
          return
        }
        await topUpConfirm(result.payment_hash, macaroon)
        await refreshBalance()
        setStep("success")
        return
      }

      // Manual: show QR code and poll for payment confirmation
      setPaymentRequest(result.payment_request)
      setPaymentHash(result.payment_hash)
      setStep("invoice")

      let attempts = 0
      intervalRef.current = setInterval(async () => {
        if (++attempts > 100) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          setError("Payment not detected. Try again.")
          setStep("amount")
          return
        }
        try {
          // topUpConfirm checks if the LN invoice is paid and increments balance
          await topUpConfirm(result.payment_hash, macaroon)
          if (intervalRef.current) clearInterval(intervalRef.current)
          await refreshBalance()
          setStep("success")
        } catch {
          // Invoice not paid yet — keep polling
        }
      }, 3000)
    } catch {
      setError("Failed to generate invoice. Try again.")
    } finally {
      setLoading(false)
    }
  }, [amount, sphinxConnected, weblnAvailable, refreshBalance])

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(paymentRequest)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [paymentRequest])

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

  const canTopUp = sphinxConnected || weblnAvailable || hasExistingL402

  return (
    <Dialog open={activeModal === "budget"} onOpenChange={() => close()}>
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg tracking-wide flex items-center gap-2">
            {step !== "balance" && (
              <button
                onClick={() => {
                  if (step === "invoice" && intervalRef.current)
                    clearInterval(intervalRef.current)
                  setStep(step === "invoice" ? "amount" : "balance")
                  if (step === "amount") setAmount(null)
                  if (step === "invoice") setPaymentRequest("")
                  setError("")
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            {step === "balance" && "Budget"}
            {step === "amount" && "Top Up"}
            {step === "invoice" && "Pay Invoice"}
            {step === "success" && "Budget"}
          </DialogTitle>
          <DialogDescription>
            {step === "balance" && "Manage your Lightning L402 balance."}
            {step === "amount" && "Choose an amount to add."}
            {step === "invoice" && "Scan or copy the invoice to pay."}
            {step === "success" && "Your balance has been updated."}
          </DialogDescription>
        </DialogHeader>

        <div className="relative z-10 space-y-5 pt-2">
          {/* Step: Balance */}
          {step === "balance" && (
            <>
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

              <div className="flex items-center gap-2 rounded-md border border-border/30 bg-muted/20 px-3 py-2.5">
                <div
                  className={`h-2 w-2 rounded-full ${
                    sphinxConnected || weblnAvailable
                      ? "bg-emerald-400 shadow-[0_0_4px_theme(colors.emerald.400)]"
                      : hasExistingL402
                        ? "bg-amber shadow-[0_0_4px_oklch(0.8_0.16_75/0.4)]"
                        : "bg-muted-foreground/40"
                  }`}
                />
                <span className="text-xs text-muted-foreground">
                  {sphinxConnected
                    ? "Connected via Sphinx"
                    : weblnAvailable
                      ? "WebLN detected (Alby, etc.)"
                      : hasExistingL402
                        ? "L402 token active"
                        : "No Lightning wallet detected"}
                </span>
              </div>

              {error && (
                <p className="text-xs text-destructive text-center">{error}</p>
              )}

              <Separator className="bg-border/30" />

              <div className="flex flex-col gap-2">
                {canTopUp ? (
                  <Button
                    onClick={handleTopUp}
                    disabled={loading}
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
                  >
                    {loading ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Zap className="mr-2 h-3.5 w-3.5" />
                    )}
                    {loading ? "Processing..." : "Top Up"}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    Install a Lightning wallet extension (like Alby) or connect
                    via the Sphinx app to top up your balance.
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
            </>
          )}

          {/* Step: Amount */}
          {step === "amount" && (
            <>
              <div className="grid grid-cols-4 gap-2">
                {PRESET_AMOUNTS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setAmount(preset)}
                    className={`rounded-lg border px-3 py-3 text-center transition-all ${
                      amount === preset
                        ? "border-primary/60 bg-primary/10 text-primary shadow-[0_0_8px_oklch(0.72_0.14_200/0.15)]"
                        : "border-border/40 bg-muted/20 text-muted-foreground hover:border-border/60 hover:text-foreground"
                    }`}
                  >
                    <span className="block text-lg font-heading font-bold">
                      {preset}
                    </span>
                    <span className="block text-[10px] font-mono uppercase tracking-wider opacity-60">
                      sats
                    </span>
                  </button>
                ))}
              </div>

              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={amount ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, "")
                    setAmount(v ? Number(v) : null)
                  }}
                  placeholder="Custom amount"
                  className="h-10 w-full rounded-md border border-border/50 bg-muted/30 px-3 pr-12 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:border-primary/40 focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground/50">
                  sats
                </span>
              </div>

              {error && (
                <p className="text-xs text-destructive text-center">{error}</p>
              )}

              <Button
                onClick={handlePay}
                disabled={loading || !amount}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
              >
                {loading ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="mr-2 h-3.5 w-3.5" />
                )}
                {loading
                  ? "Processing..."
                  : sphinxConnected || weblnAvailable
                    ? "Pay & Top Up"
                    : "Generate Invoice"}
              </Button>
            </>
          )}

          {/* Step: Invoice (manual payment) */}
          {step === "invoice" && (
            <>
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-xl bg-white p-3">
                  <QRCodeSVG
                    value={paymentRequest}
                    size={200}
                    level="M"
                    bgColor="#ffffff"
                    fgColor="#0a0a14"
                  />
                </div>

                <div className="flex w-full items-center gap-2 rounded-md border border-border/30 bg-muted/20 px-3 py-2.5">
                  <code className="flex-1 truncate text-xs font-mono text-muted-foreground">
                    {paymentRequest.slice(0, 20)}…{paymentRequest.slice(-8)}
                  </code>
                  <button
                    onClick={handleCopy}
                    className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber" />
                  <span className="text-xs text-muted-foreground">
                    Waiting for payment...
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Step: Success */}
          {step === "success" && (
            <>
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/20">
                  <Check className="h-6 w-6 text-emerald-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">
                    Top-up complete
                  </p>
                  <p className="mt-1 text-2xl font-heading font-bold text-foreground">
                    {formattedBudget}
                    <span className="ml-1.5 text-xs font-mono text-muted-foreground uppercase">
                      sats
                    </span>
                  </p>
                </div>
              </div>

              <Button
                onClick={resetState}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
              >
                Done
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
