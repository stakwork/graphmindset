import { Lsat } from "lsat-js"
import { isSphinx } from "./detect"
import { api } from "../api"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sphinx = require("sphinx-bridge")

export async function payL402(
  setBudget: (value: number | null) => void
): Promise<void> {
  if (isSphinx()) {
    await payViaSphinx(setBudget)
    return
  }

  await payViaWebLN(setBudget)
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

      if (result?.lsat) {
        localStorage.setItem(
          "l402",
          JSON.stringify({
            macaroon: lsat.baseMacaroon,
            identifier: lsat.id,
            preimage: result.lsat.split(":")[1],
          })
        )
        setBudget(budgetAmount)
      }
      return
    }
    throw error
  }
}

async function payViaWebLN(
  setBudget: (value: number | null) => void
): Promise<void> {
  localStorage.removeItem("l402")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webln = (window as any).webln
  if (!webln) throw new Error("No WebLN provider available")
  await webln.enable()

  const budgetAmount = 50

  try {
    await api.post("/buy_lsat", { amount: budgetAmount })
  } catch (error: unknown) {
    console.log("[payViaWebLN] caught error:", error instanceof Response, error instanceof Response && error.status)

    if (error instanceof Response && error.status === 402) {
      const header = error.headers.get("www-authenticate")
      console.log("[payViaWebLN] www-authenticate header:", header ? `${header.slice(0, 80)}...` : null)

      if (!header) throw new Error("No www-authenticate header in 402")

      const lsat = Lsat.fromHeader(header)
      console.log("[payViaWebLN] parsed invoice:", lsat.invoice ? `${lsat.invoice.slice(0, 40)}...` : null)

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
