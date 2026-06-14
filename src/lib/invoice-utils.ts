import { decode } from "light-bolt11-decoder"

/**
 * Decodes a BOLT11 invoice and returns the amount in satoshis,
 * or null for amountless invoices or decode failures.
 */
export function decodeInvoiceAmountSats(bolt11: string): number | null {
  try {
    const decoded = decode(bolt11)
    const amountSection = decoded.sections.find((s) => s.name === "amount")
    if (!amountSection || amountSection.value == null) return null
    // value is in millisatoshis
    return Math.floor((amountSection.value as unknown as number) / 1000)
  } catch {
    return null
  }
}

/**
 * Decodes a BOLT11 invoice string and returns the absolute expiry
 * as a Unix timestamp in seconds, or null if decoding fails.
 */
export function decodeInvoiceExpiry(bolt11: string): number | null {
  try {
    const decoded = decode(bolt11)
    const timestamp = decoded.sections.find((s) => s.name === "timestamp")?.value as number | undefined
    const expiry = (decoded.sections.find((s) => s.name === "expiry")?.value as number | undefined) ?? 3600
    if (timestamp == null) return null
    return timestamp + expiry
  } catch {
    return null
  }
}
