import { describe, it, expect } from "vitest"
import { decodeInvoiceExpiry, decodeInvoiceAmountSats } from "@/lib/invoice-utils"

// Valid invoice from light-bolt11-decoder test suite
// timestamp: 1648859703, expiry: 172800 → expires at 1649032503
const VALID_INVOICE =
  "lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567"

describe("decodeInvoiceExpiry", () => {
  it("returns correct Unix timestamp for a valid BOLT11 invoice", () => {
    const result = decodeInvoiceExpiry(VALID_INVOICE)
    // timestamp(1648859703) + expiry(172800) = 1649032503
    expect(result).toBe(1649032503)
  })

  it("returns null for a malformed invoice string", () => {
    expect(decodeInvoiceExpiry("not-a-bolt11-invoice")).toBeNull()
  })

  it("returns null for an empty string", () => {
    expect(decodeInvoiceExpiry("")).toBeNull()
  })

  it("returns null for a random string", () => {
    expect(decodeInvoiceExpiry("lnbc_invalid_garbage_xyz")).toBeNull()
  })
})

// lnbc20u = 20 * 100 μBTC = 2000 sats
// The VALID_INVOICE above encodes 20u = 2000 sats
describe("decodeInvoiceAmountSats", () => {
  it("returns correct sats for a valid BOLT11 invoice with amount", () => {
    // lnbc20u = 20 microBTC = 2000 sats (20 * 100,000 msats / 1000)
    const result = decodeInvoiceAmountSats(VALID_INVOICE)
    expect(result).toBe(2000)
  })

  it("returns null for a garbage string", () => {
    expect(decodeInvoiceAmountSats("not-a-bolt11")).toBeNull()
  })

  it("returns null for an empty string", () => {
    expect(decodeInvoiceAmountSats("")).toBeNull()
  })
})
