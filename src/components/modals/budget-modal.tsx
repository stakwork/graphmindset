"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Copy, Check, Loader2, ArrowLeft, History, Key, RefreshCw, ArrowUpRight, Clock, ArrowDownLeft } from "lucide-react"
import { BulletIcon } from "@/components/ui/bullet-icon"
import { QRCodeSVG } from "qrcode.react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useModalStore } from "@/stores/modal-store"
import { useUserStore } from "@/stores/user-store"
import { isSphinx, hasWebLN, payInvoice, payL402, topUpLsat, fetchTransactionHistory, pollPaymentStatus, fetchBuyLsatChallenge, savePendingLsat, getPendingLsat, clearPendingLsat, topUpStatus, withdraw, TransactionRow, PendingLsatChallenge } from "@/lib/sphinx"
import { getActionDisplayLabel, getActionBadgeColor, isViewGrantRow } from "@/lib/transaction-display"
import { isMocksEnabled, MOCK_TRANSACTIONS } from "@/lib/mock-data"
import { cookieStorage, AUTH_COOKIE_DAYS } from "@/lib/cookie-storage"
import { api } from "@/lib/api"
import { decodeInvoiceExpiry, decodeInvoiceAmountSats } from "@/lib/invoice-utils"
import { formatCountdown } from "@/lib/format-countdown"
import { useInvoiceCountdown } from "@/hooks/use-invoice-countdown"

type Step = "balance" | "first-purchase" | "first-invoice" | "amount" | "invoice" | "success" | "history" | "manage-token" | "restore" | "withdraw"

const PRESET_AMOUNTS = [50, 100, 500, 1000]
const MINIMUM_WITHDRAWAL_SATS = 100

function WithdrawStep({
  invoice,
  onInvoiceChange,
  error,
  loading,
  onConfirm,
}: {
  invoice: string
  onInvoiceChange: (val: string) => void
  error: string
  loading: boolean
  onConfirm: () => void
}) {
  const decodedAmountSats = invoice.trim() ? decodeInvoiceAmountSats(invoice) : null
  const withdrawExpiresAt = invoice.trim() ? decodeInvoiceExpiry(invoice) : null
  const { secondsLeft, expired } = useInvoiceCountdown(withdrawExpiresAt)

  return (
    <>
      <textarea
        value={invoice}
        onChange={(e) => onInvoiceChange(e.target.value)}
        placeholder="Paste Lightning invoice (payment_request)…"
        rows={4}
        className="w-full rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:border-primary/40 focus:outline-none resize-none"
      />

      {invoice.trim() && (
        <div className="rounded-md border border-border/30 bg-muted/20 px-3 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Amount</span>
            <span className={`font-mono font-medium ${decodedAmountSats !== null ? "text-foreground" : "text-destructive"}`}>
              {decodedAmountSats !== null ? `${decodedAmountSats.toLocaleString()} bullets` : "Amountless — not supported"}
            </span>
          </div>
          {withdrawExpiresAt !== null && (
            <div className={`flex items-center gap-1.5 text-xs font-mono ${
              expired ? "text-destructive" : secondsLeft < 60 ? "text-red-400" : "text-amber"
            }`}>
              <Clock className="h-3 w-3" />
              {expired ? "Invoice expired" : `${formatCountdown(secondsLeft)} remaining`}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive text-center">{error}</p>
      )}

      <Button
        onClick={onConfirm}
        disabled={loading || !invoice.trim()}
        className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
      >
        {loading ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <ArrowDownLeft className="mr-2 h-3.5 w-3.5" />
        )}
        {loading ? "Processing..." : "Confirm Withdrawal"}
      </Button>
    </>
  )
}

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

  // Manage Token state
  const [tokenCopied, setTokenCopied] = useState(false)
  const [restoreInput, setRestoreInput] = useState("")

  // Amount & invoice state
  const [amount, setAmount] = useState<number | null>(null)
  const [paymentRequest, setPaymentRequest] = useState("")
  const [paymentHash, setPaymentHash] = useState("")
  const [copied, setCopied] = useState(false)
  const pollAbortRef = useRef<AbortController | null>(null)

  // Invoice expiry state
  const [invoiceExpiresAt, setInvoiceExpiresAt] = useState<number | null>(null)
  const { secondsLeft, expired } = useInvoiceCountdown(invoiceExpiresAt)

  // Withdraw state
  const [withdrawInvoice, setWithdrawInvoice] = useState("")
  const [isWithdrawSuccess, setIsWithdrawSuccess] = useState(false)

  // First-purchase state (non-Sphinx, non-WebLN, no existing L402)
  const [firstPurchaseAmount, setFirstPurchaseAmount] = useState<number>(1000)
  const [firstPurchaseRequest, setFirstPurchaseRequest] = useState("")
  const [firstPurchaseCopied, setFirstPurchaseCopied] = useState(false)
  const [reachedViaFirstPurchase, setReachedViaFirstPurchase] = useState(false)
  const [pendingChallenge, setPendingChallenge] = useState<PendingLsatChallenge | null>(null)

  const sphinxConnected = typeof window !== "undefined" && isSphinx()
  const weblnAvailable = typeof window !== "undefined" && hasWebLN()
  const hasExistingL402 =
    typeof window !== "undefined" && !!cookieStorage.getItem("l402")

  const formattedBudget =
    budget !== null && budget !== undefined
      ? budget.toLocaleString()
      : "--"

  const cancelPoll = useCallback(() => {
    pollAbortRef.current?.abort()
    pollAbortRef.current = null
    setLoading(false)
    setError("")
  }, [])

  const resetState = useCallback(() => {
    cancelPoll()
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
    setReachedViaFirstPurchase(false)
    setPendingChallenge(null)
    setRestoreInput("")
    setInvoiceExpiresAt(null)
    setWithdrawInvoice("")
    setIsWithdrawSuccess(false)
    setTokenCopied(false)
  }, [])

  useEffect(() => {
    if (activeModal !== "budget") resetState()
  }, [activeModal, resetState])

  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort()
    }
  }, [])

  // Surface any pending first-purchase LSAT so the user can choose between
  // resuming it or generating a new one — instead of silently auto-resuming.
  const resumeAttemptedRef = useRef(false)
  useEffect(() => {
    if (activeModal !== "budget") {
      resumeAttemptedRef.current = false
      return
    }
    if (resumeAttemptedRef.current) return
    resumeAttemptedRef.current = true

    if (cookieStorage.getItem("l402")) {
      clearPendingLsat()
      return
    }
    const pending = getPendingLsat()
    if (!pending) return

    const MAX_AGE_MS = 24 * 60 * 60 * 1000
    if (Date.now() - pending.createdAt > MAX_AGE_MS) {
      clearPendingLsat()
      return
    }

    setPendingChallenge(pending)
    setFirstPurchaseAmount(pending.amount)
    setStep("first-purchase")
  }, [activeModal])

  // Resume polling for the stored pending invoice. Does a single quick status
  // check first — if the invoice was already paid while the user was away,
  // promote directly to success without flashing the QR.
  const handleResumePending = useCallback(async () => {
    if (!pendingChallenge) return
    setError("")
    setLoading(true)

    const promote = async () => {
      cookieStorage.setItem(
        "l402",
        JSON.stringify({
          macaroon: pendingChallenge.baseMacaroon,
          identifier: pendingChallenge.id,
          preimage: "",
        }),
        AUTH_COOKIE_DAYS
      )
      clearPendingLsat()
      setPendingChallenge(null)
      await refreshBalance()
      setReachedViaFirstPurchase(true)
      setStep("success")
    }

    try {
      const alreadyPaid = await topUpStatus(pendingChallenge.paymentHash).catch(() => false)
      if (alreadyPaid) {
        await promote()
        return
      }

      setFirstPurchaseRequest(pendingChallenge.invoice)
      setStep("first-invoice")

      const controller = new AbortController()
      pollAbortRef.current = controller
      const paid = await pollPaymentStatus(pendingChallenge.paymentHash, 1800, 2000, controller.signal)
      if (controller.signal.aborted) return
      if (!paid) {
        setError("Still waiting for your payment — we'll credit your balance automatically as soon as it lands. You can close this safely.")
        return
      }
      await promote()
    } catch {
      setError("Failed to check payment status. Try again.")
    } finally {
      setLoading(false)
    }
  }, [pendingChallenge, refreshBalance])



  const handleExportToken = useCallback(async () => {
    const stored = cookieStorage.getItem("l402")
    if (!stored) return
    const encoded = btoa(stored)
    await navigator.clipboard.writeText(encoded)
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 2000)
  }, [])

  const handleImportToken = useCallback(async () => {
    setError("")
    let parsed: { macaroon: string; identifier?: string; preimage?: string }
    try {
      const decoded = atob(restoreInput.trim())
      parsed = JSON.parse(decoded)
    } catch {
      setError("Invalid token.")
      return
    }
    if (!parsed || typeof parsed.macaroon !== "string" || !parsed.macaroon) {
      setError("Invalid token.")
      return
    }
    setLoading(true)
    try {
      await api.get<{ balance: number }>("/balance", {
        Authorization: `LSAT ${parsed.macaroon}:`,
      })
      cookieStorage.setItem("l402", JSON.stringify(parsed), AUTH_COOKIE_DAYS)
      await refreshBalance()
      setStep("success")
    } catch {
      setError("Token not recognised or expired.")
    } finally {
      setLoading(false)
    }
  }, [restoreInput, refreshBalance])

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
    const stored = cookieStorage.getItem("l402")

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
    const controller = new AbortController()
    pollAbortRef.current = controller
    try {
      const challenge = await fetchBuyLsatChallenge(firstPurchaseAmount)
      setPendingChallenge(savePendingLsat(challenge, firstPurchaseAmount))
      setFirstPurchaseRequest(challenge.invoice)
      setInvoiceExpiresAt(decodeInvoiceExpiry(challenge.invoice))
      setStep("first-invoice")

      const paid = await pollPaymentStatus(challenge.paymentHash, 1800, 2000, controller.signal)
      if (controller.signal.aborted) return
      if (!paid) {
        setError("Still waiting for your payment — we'll credit your balance automatically as soon as it lands. You can close this safely.")
        return
      }

      cookieStorage.setItem(
        "l402",
        JSON.stringify({
          macaroon: challenge.baseMacaroon,
          identifier: challenge.id,
          preimage: "",
        }),
        AUTH_COOKIE_DAYS
      )
      clearPendingLsat()
      setPendingChallenge(null)

      await refreshBalance()
      setReachedViaFirstPurchase(true)
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
      setError("Enter an amount between 1 and 10,000 bullets.")
      return
    }

    setError("")
    setLoading(true)

    const stored = cookieStorage.getItem("l402")
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
        console.log("[topUp] confirmed, refreshing balance...")
        await refreshBalance()
        setStep("success")
        return
      }

      // Manual: show QR code and poll for payment confirmation
      setPaymentRequest(result.payment_request)
      setPaymentHash(result.payment_hash)
      setInvoiceExpiresAt(decodeInvoiceExpiry(result.payment_request))
      setStep("invoice")

      const manualController = new AbortController()
      pollAbortRef.current = manualController
      const paid = await pollPaymentStatus(result.payment_hash, 1200, 3000, manualController.signal)
      if (manualController.signal.aborted) return
      if (!paid) {
        setError("Still waiting for your payment — we'll credit your balance automatically as soon as it lands. You can close this safely.")
        return
      }
      await refreshBalance()
      setStep("success")
    } catch (err) {
      console.error("[topUp] error:", err)
      setError("Failed to generate invoice. Try again.")
    } finally {
      setLoading(false)
    }
  }, [amount, sphinxConnected, weblnAvailable, refreshBalance])

  const handleWithdraw = useCallback(async () => {
    setError("")
    const decodedAmountSats = decodeInvoiceAmountSats(withdrawInvoice)
    const expiresAt = decodeInvoiceExpiry(withdrawInvoice)
    const isExpired = expiresAt !== null && expiresAt < Math.floor(Date.now() / 1000)

    if (decodedAmountSats === null) {
      setError("Invoice must specify an amount")
      return
    }
    if (isExpired) {
      setError("Invoice has expired")
      return
    }
    if (decodedAmountSats < MINIMUM_WITHDRAWAL_SATS) {
      setError("Minimum withdrawal is 100 bullets")
      return
    }
    if (decodedAmountSats > (budget ?? 0)) {
      setError("Insufficient balance for withdrawal")
      return
    }

    setLoading(true)
    try {
      await withdraw(withdrawInvoice)
      await refreshBalance()
      setIsWithdrawSuccess(true)
      setStep("success")
    } catch (err: unknown) {
      const errorCode = (err as { errorCode?: string })?.errorCode
      if (errorCode === "BELOW_MINIMUM") {
        setError("Minimum withdrawal is 100 bullets")
      } else if (errorCode === "INSUFFICIENT_BALANCE") {
        setError("Insufficient balance for withdrawal")
      } else if (errorCode === "INVOICE_EXPIRED") {
        setError("Invoice has expired")
      } else if (errorCode === "AMOUNTLESS_INVOICE") {
        setError("Invoice must specify an amount")
      } else if (errorCode === "ALREADY_WITHDRAWN") {
        setError("This invoice has already been paid")
      } else if (errorCode === "PAYMENT_FAILED") {
        setError("Payment failed — your balance has been refunded")
      } else {
        setError("Withdrawal failed. Please try again.")
      }
    } finally {
      setLoading(false)
    }
  }, [withdrawInvoice, budget, refreshBalance])

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


  const successDelta = amount ?? (reachedViaFirstPurchase ? firstPurchaseAmount : null)

  return (
    <Dialog open={activeModal === "budget"} onOpenChange={() => close()}>
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg tracking-wide flex items-center gap-2">
            {step !== "balance" && (
              <button
                aria-label="Go back"
                onClick={() => {
                  if (step === "first-invoice") {
                    cancelPoll()
                    setStep("first-purchase")
                  } else if (step === "invoice") {
                    cancelPoll()
                    setPaymentRequest("")
                    setStep("amount")
                  } else if (step === "history" || step === "manage-token" || step === "withdraw") {
                    setStep("balance")
                  } else if (step === "restore") {
                    setStep("manage-token")
                  } else {
                    setStep(step === "amount" ? "balance" : "balance")
                    if (step === "amount") setAmount(null)
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
            {step === "manage-token" && "Manage Token"}
            {step === "restore" && "Restore Token"}
            {step === "withdraw" && "Withdraw"}
          </DialogTitle>
          <DialogDescription>
            {step === "balance" && "Manage your balance."}
            {step === "first-purchase" && "Buy your first L402 with any Lightning wallet."}
            {step === "first-invoice" && "Scan or copy the invoice to pay."}
            {step === "amount" && "Choose an amount to add."}
            {step === "invoice" && "Scan or copy the invoice to pay."}
            {step === "success" && "Your balance has been updated."}
            {step === "history" && "Your payment activity."}
            {step === "manage-token" && "Back up or restore your L402 token."}
            {step === "restore" && "Paste a previously copied token to regain access."}
            {step === "withdraw" && "Paste a Lightning invoice to cash out your balance."}
          </DialogDescription>
        </DialogHeader>

        <div className="relative z-10 space-y-5 pt-2">
          {/* Step: Balance */}
          {step === "balance" && (
            <>
              <div className="relative overflow-hidden rounded-lg border border-border/50 bg-gradient-to-br from-muted/40 to-muted/10 p-5">
                <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-amber/5 blur-2xl" />
                <div className="relative flex items-center justify-between">
                  <div className="flex items-baseline gap-2">
                    <span className="font-heading text-5xl font-bold leading-none text-foreground">
                      {formattedBudget}
                    </span>
                    <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      bullets
                    </span>
                  </div>
                  <BulletIcon className="h-10 w-10 text-amber glow-text-amber" strokeWidth={1.5} />
                </div>
              </div>

              {error && (
                <p className="text-xs text-destructive text-center">{error}</p>
              )}

              <button
                onClick={handleTopUp}
                disabled={loading}
                className="group flex w-full items-center justify-between rounded-lg bg-primary px-4 py-2.5 text-primary-foreground transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex items-center gap-2">
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BulletIcon className="h-4 w-4" />
                  )}
                  <span className="text-sm font-medium">
                    {loading ? "Processing..." : "Top Up"}
                  </span>
                </div>
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </button>

              <button
                onClick={() => { setWithdrawInvoice(""); setError(""); setStep("withdraw") }}
                disabled={loading || !hasExistingL402}
                className="group flex w-full items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-4 py-2.5 text-foreground transition-all hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex items-center gap-2">
                  <ArrowDownLeft className="h-4 w-4" />
                  <span className="text-sm font-medium">Withdraw</span>
                </div>
                <ArrowDownLeft className="h-4 w-4 text-muted-foreground" />
              </button>

              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={handleRefreshBalance}
                  disabled={loading}
                  className="flex flex-col items-center gap-1.5 rounded-md border border-border/30 bg-muted/20 px-2 py-2.5 text-muted-foreground transition-all hover:border-border/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-medium">Refresh</span>
                </button>
                <button
                  onClick={handleShowHistory}
                  disabled={(!hasExistingL402 && !isMocksEnabled()) || loading}
                  className="flex flex-col items-center gap-1.5 rounded-md border border-border/30 bg-muted/20 px-2 py-2.5 text-muted-foreground transition-all hover:border-border/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <History className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-medium">History</span>
                </button>
                <button
                  onClick={() => setStep("manage-token")}
                  className="flex flex-col items-center gap-1.5 rounded-md border border-border/30 bg-muted/20 px-2 py-2.5 text-muted-foreground transition-all hover:border-border/60 hover:text-foreground"
                >
                  <Key className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-medium">Manage Token</span>
                </button>
              </div>
            </>
          )}

          {/* Step: First Purchase — amount input */}
          {step === "first-purchase" && (
            <>
              {pendingChallenge && (
                <>
                  <div className="rounded-md border border-amber/30 bg-amber/5 p-3 space-y-2.5">
                    <div className="flex items-start gap-2">
                      <BulletIcon className="h-4 w-4 text-amber shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-0.5">
                        <p className="text-xs font-medium text-foreground">
                          Pending invoice for {pendingChallenge.amount.toLocaleString()} bullets
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          You started a top-up earlier. Pay this invoice or generate a new one below.
                        </p>
                      </div>
                    </div>
                    <Button
                      onClick={handleResumePending}
                      disabled={loading}
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
                    >
                      {loading ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <BulletIcon className="mr-2 h-3.5 w-3.5" />
                      )}
                      {loading ? "Checking..." : "Pay Pending Invoice"}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
                    <div className="h-px flex-1 bg-border/40" />
                    <span>or generate new</span>
                    <div className="h-px flex-1 bg-border/40" />
                  </div>
                </>
              )}

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
                    <span className="block text-[10px] font-mono uppercase tracking-wider opacity-60">bullets</span>
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
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground/50">bullets</span>
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
                  <BulletIcon className="mr-2 h-3.5 w-3.5" />
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

                {invoiceExpiresAt && (
                  <div className={`flex items-center justify-center gap-1.5 text-xs font-mono ${
                    expired ? "text-destructive" : secondsLeft < 60 ? "text-red-400" : "text-amber"
                  }`}>
                    <Clock className="h-3 w-3" />
                    {expired ? "Invoice expired" : `${formatCountdown(secondsLeft)} remaining`}
                  </div>
                )}

                {!expired ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber" />
                    <span className="text-xs text-muted-foreground">Waiting for payment...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <span className="rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive ring-1 ring-destructive/20">
                      Expired
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => {
                        cancelPoll()
                        handleFirstPurchaseInvoice()
                      }}
                    >
                      <RefreshCw className="mr-1.5 h-3 w-3" />
                      Get New Invoice
                    </Button>
                  </div>
                )}

                {error && (
                  <p className="text-xs text-muted-foreground text-center">{error}</p>
                )}
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
                      bullets
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
                  bullets
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
                  <BulletIcon className="mr-2 h-3.5 w-3.5" />
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

                {invoiceExpiresAt && (
                  <div className={`flex items-center justify-center gap-1.5 text-xs font-mono ${
                    expired ? "text-destructive" : secondsLeft < 60 ? "text-red-400" : "text-amber"
                  }`}>
                    <Clock className="h-3 w-3" />
                    {expired ? "Invoice expired" : `${formatCountdown(secondsLeft)} remaining`}
                  </div>
                )}

                {!expired ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber" />
                    <span className="text-xs text-muted-foreground">
                      Waiting for payment...
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <span className="rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive ring-1 ring-destructive/20">
                      Expired
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => {
                        cancelPoll()
                        handlePay()
                      }}
                    >
                      <RefreshCw className="mr-1.5 h-3 w-3" />
                      Get New Invoice
                    </Button>
                  </div>
                )}

                {error && (
                  <p className="text-xs text-muted-foreground text-center">{error}</p>
                )}
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
                    .filter(tx =>
                    tx.action !== 'refund' &&
                    tx.action !== 'boost_refund' &&
                    tx.amount > 0 &&
                    !isViewGrantRow(tx)
                  )
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
                        {tx.refunded ? '—' : `${tx.type === 'credit' ? '+' : '-'}${tx.amount} bullets`}
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

          {/* Step: Manage Token */}
          {step === "manage-token" && (
            <>
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  onClick={handleExportToken}
                  disabled={!hasExistingL402}
                  className="w-full text-xs"
                >
                  {tokenCopied ? (
                    <Check className="mr-2 h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="mr-2 h-3.5 w-3.5" />
                  )}
                  {tokenCopied ? "Copied!" : "Copy Token"}
                </Button>

                {!hasExistingL402 && (
                  <p className="text-[10px] text-muted-foreground/60 text-center">
                    No active L402 token to copy.
                  </p>
                )}

                <Button
                  variant="ghost"
                  onClick={() => setStep("restore")}
                  className="w-full text-xs text-muted-foreground"
                >
                  <Key className="mr-2 h-3.5 w-3.5" />
                  Restore Token
                </Button>
              </div>
            </>
          )}

          {/* Step: Restore */}
          {step === "restore" && (
            <>
              <textarea
                value={restoreInput}
                onChange={(e) => setRestoreInput(e.target.value)}
                placeholder="Paste your token here…"
                rows={4}
                className="w-full rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:border-primary/40 focus:outline-none resize-none"
              />

              {error && (
                <p className="text-xs text-destructive text-center">{error}</p>
              )}

              <Button
                onClick={handleImportToken}
                disabled={loading || !restoreInput.trim()}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
              >
                {loading ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Key className="mr-2 h-3.5 w-3.5" />
                )}
                {loading ? "Validating..." : "Restore Access"}
              </Button>
            </>
          )}

          {/* Step: Withdraw */}
          {step === "withdraw" && (
            <WithdrawStep
              invoice={withdrawInvoice}
              onInvoiceChange={(val) => { setWithdrawInvoice(val); setError("") }}
              error={error}
              loading={loading}
              onConfirm={handleWithdraw}
            />
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
                    {isWithdrawSuccess ? "Withdrawal complete" : "Top-up complete"}
                  </p>
                  {!isWithdrawSuccess && successDelta !== null && (
                    <p className="text-sm font-mono text-emerald-400">
                      +{successDelta.toLocaleString()} bullets added
                    </p>
                  )}
                  <p className="mt-1 text-2xl font-heading font-bold text-foreground">
                    {formattedBudget}
                    <span className="ml-1.5 text-xs font-mono text-muted-foreground uppercase">
                      bullets
                    </span>
                  </p>
                </div>
              </div>

              {reachedViaFirstPurchase && !isWithdrawSuccess && (
                <div className="flex flex-col gap-2 rounded-md border border-border/50 bg-muted/30 p-3">
                  <p className="text-xs text-foreground/80">
                    This token is the key to your balance. Store it somewhere safe — you'll need it to restore access if you clear your cookies or switch devices.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportToken}
                    className="w-full text-xs"
                  >
                    {tokenCopied ? (
                      <Check className="mr-2 h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="mr-2 h-3.5 w-3.5" />
                    )}
                    {tokenCopied ? "Copied!" : "Copy Token"}
                  </Button>
                  <p className="text-[10px] text-muted-foreground text-center">
                    You can back this up anytime under Manage Token.
                  </p>
                </div>
              )}

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
