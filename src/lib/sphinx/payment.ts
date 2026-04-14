import { Lsat } from "lsat-js"
import { isSphinx } from "./detect"
import { api } from "../api"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sphinx = require("sphinx-bridge")

export async function payL402(
  setBudget: (value: number | null) => void,
  amount?: number
): Promise<void> {
  if (isSphinx()) {
    await payViaSphinx(setBudget)
    return
  }

  await payViaWebLN(setBudget, amount)
}

async function payViaSphinx(
  setBudget: (value: number | null) => void
): Promise<void> {
  // Clear any existing expired L402
  const existing = localStorage.getItem("l402")
  if (existing) {
    localStorage.removeItem("l402")
    const parsed = JSON.parse(existing)
    try {
      await sphinx.updateLsat(parsed.identifier, "expired")
    } catch {
      // ignore
    }
  }

  // Ask Sphinx for a budget approval
  let budgetAmount: number
  try {
    const budget = await sphinx.setBudget()
    budgetAmount = budget?.budget
    if (!budgetAmount) {
      const details = await sphinx.authorize()
      budgetAmount = details.budget
    }
  } catch {
    throw new Error("Budget approval failed")
  }

  // Buy L402 — expects a 402 back with the invoice
  try {
    await api.post("/buy_lsat", { amount: budgetAmount })
  } catch (error: unknown) {
    if (error instanceof Response && error.status === 402) {
      const header = error.headers.get("www-authenticate")
      if (!header) throw new Error("No www-authenticate header in 402")

      const lsat = Lsat.fromHeader(header)

      // Pay via Sphinx bridge
      const result = await sphinx.saveLsat(
        lsat.invoice,
        lsat.baseMacaroon,
        window.location.host
      )
      if (!result?.success) throw new Error("Sphinx saveLsat failed")

      // saveLsat does not return a preimage — fetch the stored LSAT to get it
      const stored = await sphinx.getLsat(window.location.host)
      if (!stored?.preimage) throw new Error("getLsat returned no preimage after saveLsat")

      localStorage.setItem(
        "l402",
        JSON.stringify({
          macaroon: lsat.baseMacaroon,
          identifier: lsat.id,
          preimage: stored.preimage,
        })
      )
      setBudget(budgetAmount)
      return
    }
    throw error
  }
}

async function payViaWebLN(
  setBudget: (value: number | null) => void,
  amount?: number
): Promise<void> {
  localStorage.removeItem("l402")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webln = (window as any).webln
  if (!webln) throw new Error("No WebLN provider available")
  await webln.enable()

  const budgetAmount = amount ?? 50

  try {
    await api.post("/buy_lsat", { amount: budgetAmount })
  } catch (error: unknown) {
    if (error instanceof Response && error.status === 402) {
      const header = error.headers.get("www-authenticate")
      if (!header) throw new Error("No www-authenticate header in 402")

      const lsat = Lsat.fromHeader(header)
      const payment = await webln.sendPayment(lsat.invoice)

      if (payment?.preimage) {
        localStorage.setItem(
          "l402",
          JSON.stringify({
            macaroon: lsat.baseMacaroon,
            identifier: lsat.id,
            preimage: payment.preimage,
          })
        )
      }
      setBudget(budgetAmount)
      return
    }
    throw error
  }
}

export type TopUpResponse = {
  success: boolean
  payment_request: string
  payment_hash: string
}

export async function topUpLsat(
  macaroon: string,
  amount: number
): Promise<TopUpResponse> {
  return api.post<TopUpResponse>("/top_up_lsat", { macaroon, amount })
}

export async function topUpConfirm(
  paymentHash: string,
  macaroon: string
): Promise<void> {
  await api.post("/top_up_confirm", { payment_hash: paymentHash, macaroon })
}

export interface TransactionRow {
  endpoint: string
  amount: number
  created_at: string | null
  label: string
}

export function getTransactionLabel(endpoint: string): string {
  if (!endpoint) return 'Other'
  const e = endpoint.toLowerCase()
  if (e.includes('nodes/') || e === 'v2/nodes/:ref_id') return 'Purchase'
  if (['search', 'v2/search', 'graph/search', 'graph/search/latest'].includes(e)) return 'Search'
  if (e === 'boost') return 'Boost'
  if (e === 'top_up_confirm' || e === 'buy_lsat') return 'Top Up'
  if (e === 'v2/content' || e === 'add_node') return 'Add Content'
  return 'Other'
}

export async function fetchTransactionHistory(): Promise<{
  transactions: TransactionRow[]
  scope: 'pubkey' | 'token'
}> {
  try {
    const res = await api.get<{
      success: boolean
      scope: 'pubkey' | 'token'
      transactions: Omit<TransactionRow, 'label'>[]
    }>('/transactions')
    return {
      transactions: res.transactions.map(tx => ({ ...tx, label: getTransactionLabel(tx.endpoint) })),
      scope: res.scope,
    }
  } catch {
    return { transactions: [], scope: 'token' }
  }
}

export async function getPrice(endpoint: string): Promise<number> {
  try {
    const res = await api.get<{
      data: { price: number; endpoint: string; method: string }
    }>(`/getprice?endpoint=${endpoint}&method=post`)
    return res.data.price
  } catch {
    return 0
  }
}
