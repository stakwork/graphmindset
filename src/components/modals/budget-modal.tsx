"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Zap, Copy, Check, Loader2, ArrowLeft, History } from "lucide-react"
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
import { isSphinx, hasWebLN, payInvoice, payL402, topUpLsat, topUpConfirm, fetchTransactionHistory, pollPaymentStatus, fetchBuyLsatChallenge, TransactionRow } from "@/lib/sphinx"
import { getActionDisplayLabel, getActionBadgeColor } from "@/lib/transaction-display"
import { isMocksEnabled, MOCK_TRANSACTIONS } from "@/lib/mock-data"

type Step = "balance" | "first-purchase" | "first-invoice" | "amount" | "invoice" | "success" | "history"

const PRESET_AMOUNTS = [50, 100, 500, 1000]

export function BudgetModal() {
  const { activeModal, close } = useModalStore()
  const { budget, setBudget } = useUserStore()
  const refreshBalance = useUserStore((s) => s.refreshBalance)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [step, setStep] = useState<Step>("balance")

  // History state
  const [transactions, setTransactions] = useState<TransactionRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyScope, setHistoryScope] = useState<'pubkey' | 'token' | null>(null)

  // Amount & invoice state
  const [amount, setAmount] = useState<number | null>(null)
  const [paymentRequest, setPaymentRequest] = useState("")
  const [paymentHash, setPaymentHash] = useState("")
  const [copied, setCopied] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // First-purchase state (non-Sphinx, non-WebLN, no existing L402)
  const [firstPurchaseAmount, setFirstPurchaseAmount] = useState<number>(1000)
  const [firstPurchaseRequest, setFirstPurchaseRequest] = useState("")
  const [firstPurchaseCopied, setFirstPurchaseCopied] = useState(false)

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
    setTransactions([])
    setHistoryLoading(false)
    setHistoryScope(null)
    setFirstPurchaseAmount(1000)
    setFirstPurchaseRequest("")
    setFirstPurchaseCopied(false)
  }, [])

  useEffect(() => {
    if (activeModal !== "budget") resetState()
  }, [activeModal, resetState])

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])



  const handleShowHistory = useCallback(async () => {
    setStep('history')
    setHistoryLoading(true)
    try {
      if (isMocksEnabled()) {
        setTransactions(MOCK_TRANSACTIONS.transactions)
        setHistoryScope(MOCK_TRANSACTIONS.scope)
      } else {
        const result = await fetchTransactionHistory()
        setTransactions(result.transactions)
        setHistoryScope(result.scope)
      }
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  // Route "Top Up" to the right flow
  const handleTopUp = useCallback(async () => {
    const stored = localStorage.getItem("l402")

    if (stored) {
      // Has existing L402 — go to amount step to top up
      setStep("amount")
      return
    }

    // No L402, no Sphinx, no WebLN → first-purchase QR flow
    if (!sphinxConnected && !weblnAvailable) {
      setStep("first-purchase")
      return
    }

    setLoading(true)
    setError("")
    try {
      await payL402(setBudget)
      await refreshBalance()
      setStep("success")
    } catch {
      setError("Payment was cancelled or failed. Try again.")
    } finally {
      setLoading(false)
    }
  }, [sphinxConnected, weblnAvailable, setBudget, refreshBalance])

  // First-purchase QR flow (non-Sphinx, non-WebLN, no existing L402).
  //
  // Standard L402 protocol:
  //   1. POST /buy_lsat → server returns 402 with LSAT challenge in
  //      www-authenticate (parsed via lsat-js into { invoice, baseMacaroon, paymentHash, id }).
  //   2. Display the invoice as a QR + copyable text.
  //   3. Poll /top_up_status/:paymentHash. The route falls back to Lightning
  //      when no top_up row exists, so it works for the 402 challenge case.
  //   4. Persist the L402 with empty preimage. The QR user can't capture a
  //      preimage from an external wallet — fine here, because Boltwall's
  //      auth path looks up by macaroon string and ensureDynamicLsat
  //      activates by Lightning lookup, not preimage proof.
  //   5. refreshBalance → /balance → ensureDynamicLsat activates the LSAT
  //      server-side (creates the DynamicLsat row + initial_purchase credit).
  const handleFirstPurchaseInvoice = useCallback(async () => {
    if (!firstPurchaseAmount || firstPurchaseAmount < 1) {
      setError("Enter a valid amount.")
      return
    }
    setError("")
    setLoading(true)
    try {
      const challenge = await fetchBuyLsatChallenge(firstPurchaseAmount)
      setFirstPurchaseRequest(challenge.invoice)
      setStep("first-invoice")

      const paid = await pollPaymentStatus(challenge.paymentHash)
      if (!paid) {
        setError("Payment not detected. Try again.")
        setStep("first-purchase")
        return
      }

      localStorage.setItem(
        "l402",
        JSON.stringify({
          macaroon: challenge.baseMacaroon,
          identifier: challenge.id,
          preimage: "",
        }),
      )

      await refreshBalance()
      setStep("success")
    } catch {
      setError("Failed to generate invoice. Try again.")
      setStep("first-purchase")
    } finally {
      setLoading(false)
    }
  }, [firstPurchaseAmount, refreshBalance])

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
        const payment = await payInvoice(result.payment_request)
        if (!payment) {
          setError("Payment was cancelled or failed.")
          setLoading(false)
          return
        }
        console.log("[topUp] payment succeeded, waiting for LN confirmation...")
        const paid = await pollPaymentStatus(result.payment_hash)
        if (!paid) {
          setError("Payment sent but confirmation timed out. Try refreshing balance.")
          setLoading(false)
          return
        }
        await topUpConfirm(result.payment_hash, macaroon)
        console.log("[topUp] confirmed, refreshing balance...")
        await refreshBalance()
        setStep("success")
        return
      }

      // Manual: show QR code and poll for payment confirmation
      setPaymentRequest(result.payment_request)
      setPaymentHash(result.payment_hash)
      setStep("invoice")

      let confirming = false
      const paid = await pollPaymentStatus(result.payment_hash, 100, 3000)
      if (!paid) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        setError("Payment not detected. Try again.")
        setStep("amount")
        return
      }
      if (!confirming) {
        confirming = true
        try {
          await topUpConfirm(result.payment_hash, macaroon)
          await refreshBalance()
          setStep("success")
        } catch {
          setError("Payment received but confirmation failed. Try refreshing balance.")
          setStep("amount")
        }
      }
    } catch (err) {
      console.error("[topUp] error:", err)
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
      await refreshBalance()
    } finally {
      setLoading(false)
    }
  }, [refreshBalance])

  const handleFirstPurchaseCopy = useCallback(async () => {
    await navigator.clipboard.writeText(firstPurchaseRequest)
    setFirstPurchaseCopied(true)
    setTimeout(() => setFirstPurchaseCopied(false), 2000)
  }, [firstPurchaseRequest])


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
                  if (step === "history") {
                    setStep("balance")
                  } else if (step === "first-invoice") {
                    setStep("first-purchase")
                  } else {
                    setStep(step === "invoice" ? "amount" : "balance")
                    if (step === "amount") setAmount(null)
                    if (step === "invoice") setPaymentRequest("")
                  }
                  setError("")
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            {step === "balance" && "Budget"}
            {step === "first-purchase" && "Get Started"}
            {step === "first-invoice" && "Pay Invoice"}
            {step === "amount" && "Top Up"}
            {step === "invoice" && "Pay Invoice"}
            {step === "success" && "Budget"}
            {step === "history" && "History"}
          </DialogTitle>
          <DialogDescription>
            {step === "balance" && "Manage your Lightning L402 balance."}
            {step === "first-purchase" && "Buy your first L402 with any Lightning wallet."}
            {step === "first-invoice" && "Scan or copy the invoice to pay."}
            {step === "amount" && "Choose an amount to add."}
            {step === "invoice" && "Scan or copy the invoice to pay."}
            {step === "success" && "Your balance has been updated."}
            {step === "history" && "Your payment activity."}
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
                        : "Pay via Lightning invoice (any wallet)"}
                </span>
              </div>

              {error && (
                <p className="text-xs text-destructive text-center">{error}</p>
              )}

              <Separator className="bg-border/30" />

              <div className="flex flex-col gap-2">
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

                <Button
                  variant="ghost"
                  onClick={handleRefreshBalance}
                  disabled={loading}
                  className="w-full text-xs text-muted-foreground"
                >
                  Refresh Balance
                </Button>

                <Button
                  variant="ghost"
                  onClick={handleShowHistory}
                  disabled={(!hasExistingL402 && !isMocksEnabled()) || loading}
                  className="w-full text-xs text-muted-foreground"
                >
                  <History className="mr-2 h-3.5 w-3.5" />
                  History
                </Button>
              </div>
            </>
          )}

          {/* Step: First Purchase — amount input */}
          {step === "first-purchase" && (
            <>
              <p className="text-xs text-muted-foreground text-center">
                Pay a Lightning invoice with any wallet to create your L402 balance.
              </p>

              <div className="grid grid-cols-4 gap-2">
                {PRESET_AMOUNTS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setFirstPurchaseAmount(preset)}
                    className={`rounded-lg border px-3 py-3 text-center transition-all ${
                      firstPurchaseAmount === preset
                        ? "border-primary/60 bg-primary/10 text-primary shadow-[0_0_8px_oklch(0.72_0.14_200/0.15)]"
                        : "border-border/40 bg-muted/20 text-muted-foreground hover:border-border/60 hover:text-foreground"
                    }`}
                  >
                    <span className="block text-lg font-heading font-bold">{preset}</span>
                    <span className="block text-[10px] font-mono uppercase tracking-wider opacity-60">sats</span>
                  </button>
                ))}
              </div>

              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={firstPurchaseAmount}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, "")
                    setFirstPurchaseAmount(v ? Number(v) : 1000)
                  }}
                  placeholder="Custom amount"
                  className="h-10 w-full rounded-md border border-border/50 bg-muted/30 px-3 pr-12 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:border-primary/40 focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground/50">sats</span>
              </div>

              {error && <p className="text-xs text-destructive text-center">{error}</p>}

              <Button
                onClick={handleFirstPurchaseInvoice}
                disabled={loading || !firstPurchaseAmount}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
              >
                {loading ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="mr-2 h-3.5 w-3.5" />
                )}
                {loading ? "Generating Invoice..." : "Generate Invoice"}
              </Button>
            </>
          )}

          {/* Step: First Invoice — QR + poll */}
          {step === "first-invoice" && (
            <>
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-xl bg-white p-3">
                  <QRCodeSVG
                    value={firstPurchaseRequest}
                    size={200}
                    level="M"
                    bgColor="#ffffff"
                    fgColor="#0a0a14"
                  />
                </div>

                <div className="flex w-full items-center gap-2 rounded-md border border-border/30 bg-muted/20 px-3 py-2.5">
                  <code className="flex-1 truncate text-xs font-mono text-muted-foreground">
                    {firstPurchaseRequest.slice(0, 20)}…{firstPurchaseRequest.slice(-8)}
                  </code>
                  <button
                    onClick={handleFirstPurchaseCopy}
                    className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {firstPurchaseCopied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber" />
                  <span className="text-xs text-muted-foreground">Waiting for payment...</span>
                </div>
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

          {/* Step: History */}
          {step === "history" && (
            <>
              {historyLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : transactions.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No transactions yet.</p>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                  {transactions
                    .filter(tx => tx.action !== 'refund' && tx.action !== 'boost_refund' && tx.amount > 0)
                    .map((tx, i) => (
                    <div key={i} className="flex items-center justify-between rounded-md px-3 py-2 bg-muted/20">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${getActionBadgeColor(tx.action)}`}>
                          {getActionDisplayLabel(tx.action)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {tx.created_at ? new Date(tx.created_at).toLocaleDateString() : '—'}
                          {tx.created_at && (
                            <span className="ml-1.5 text-[10px] text-muted-foreground/60">
                              {new Date(tx.created_at).toLocaleTimeString()}
                            </span>
                          )}
                        </span>
                      </div>
                      <span className={`text-xs font-mono font-medium ${
                        tx.refunded ? 'text-muted-foreground' :
                        tx.type === 'credit' ? 'text-emerald-400' : 'text-muted-foreground'
                      }`}>
                        {tx.refunded ? '—' : `${tx.type === 'credit' ? '+' : '-'}${tx.amount} sats`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {historyScope === 'token' && !historyLoading && (
                <p className="text-[10px] text-muted-foreground/60 text-center">
                  Showing current token only
                </p>
              )}
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
