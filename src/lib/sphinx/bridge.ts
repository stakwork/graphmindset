import type { SignedMessage } from "./types"
import { isSphinx } from "./detect"

// sphinx-bridge communicates via postMessage with the Sphinx webview host
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sphinx = require("sphinx-bridge")

let signingPromise: Promise<SignedMessage> | null = null
let l402Promise: Promise<string> | null = null

export async function enable(): Promise<{ pubkey: string } | null> {
  try {
    const result = await sphinx.enable()
    sessionStorage.setItem("isSphinx", result ? "true" : "false")
    return result
  } catch {
    sessionStorage.setItem("isSphinx", "false")
    return null
  }
}

export async function getSignedMessage(): Promise<SignedMessage> {
  const stored = localStorage.getItem("signature")
  if (stored) {
    const parsed = JSON.parse(stored) as SignedMessage
    return parsed
  }

  if (!isSphinx()) {
    return { message: "", signature: "" }
  }

  // Queue signing — sphinx bridge handles only one request at a time
  if (!signingPromise) {
    signingPromise = (async () => {
      try {
        const message = btoa(
          `${crypto.randomUUID()}${Date.now()}`
        )
        const result = await sphinx.signMessage(message)
        const signed = { message, signature: result.signature }
        localStorage.setItem("signature", JSON.stringify(signed))
        return signed
      } catch (error) {
        console.error("Failed to sign message:", error)
        return { message: "", signature: "" }
      } finally {
        signingPromise = null
      }
    })()
  }

  return signingPromise
}

export async function getL402(): Promise<string> {
  if (typeof window === "undefined") return ""

  const stored = localStorage.getItem("l402")
  if (stored) {
    const parsed = JSON.parse(stored)
    return `LSAT ${parsed.macaroon}:${parsed.preimage}`
  }

  if (!isSphinx()) return ""

  // Queue — sphinx bridge handles only one request at a time
  if (!l402Promise) {
    l402Promise = (async () => {
      try {
        const token = await sphinx.getLsat(window.location.host)
        if (token?.macaroon) {
          localStorage.setItem(
            "l402",
            JSON.stringify({
              macaroon: token.macaroon,
              identifier: token.identifier,
              preimage: token.preimage,
            })
          )
          return `LSAT ${token.macaroon}:${token.preimage}`
        }
        return ""
      } catch (error) {
        console.warn("Failed to get L402:", error)
        return ""
      } finally {
        l402Promise = null
      }
    })()
  }

  return l402Promise
}

export function hasWebLN(): boolean {
  if (typeof window === "undefined") return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(window as any).webln
}

export async function payInvoice(invoice: string): Promise<{ preimage: string } | null> {
  if (typeof window === "undefined") return null

  if (isSphinx()) {
    try {
      // Ensure Sphinx has budget allocated before paying
      let budget = await sphinx.setBudget()
      if (!budget?.budget) {
        budget = await sphinx.authorize()
      }
      console.log("[payInvoice] Sphinx budget:", budget?.budget)

      const result = await sphinx.sendPayment(invoice)
      console.log("[payInvoice] sphinx.sendPayment result:", JSON.stringify(result))
      if (result?.success) {
        return { preimage: result.preimage ?? "" }
      }
      return null
    } catch (error) {
      console.error("[payInvoice] Sphinx payment failed:", error)
      return null
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webln = (window as any).webln
  if (!webln) return null

  try {
    await webln.enable()
    const result = await webln.sendPayment(invoice)
    return { preimage: result.preimage }
  } catch (error) {
    console.error("WebLN payment failed:", error)
    return null
  }
}
