import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.mock calls are hoisted — declare factory functions using vi.hoisted
const { mockApiPostHoisted, mockIsMocksEnabledHoisted, mockMockTransactionsHoisted, mockDecodeInvoiceAmountSatsHoisted } = vi.hoisted(() => {
  const mockApiPost = vi.fn()
  let isMocksEnabled = false
  const mockTransactions: { transactions: Array<{ action: string; type: string; amount: number; created_at: string }> } = { transactions: [] }
  const mockDecodeInvoiceAmountSats = vi.fn().mockReturnValue(500)
  return {
    mockApiPostHoisted: mockApiPost,
    mockIsMocksEnabledHoisted: { value: isMocksEnabled },
    mockMockTransactionsHoisted: mockTransactions,
    mockDecodeInvoiceAmountSatsHoisted: mockDecodeInvoiceAmountSats,
  }
})

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: (...args: unknown[]) => mockApiPostHoisted(...args),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock("@/lib/invoice-utils", () => ({
  decodeInvoiceExpiry: vi.fn().mockReturnValue(null),
  decodeInvoiceAmountSats: (...args: unknown[]) => mockDecodeInvoiceAmountSatsHoisted(...args),
}))

vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => mockIsMocksEnabledHoisted.value,
  MOCK_TRANSACTIONS: mockMockTransactionsHoisted,
}))

// Also need bridge/detect mocks since payment.ts imports them indirectly
vi.mock("@/lib/sphinx/bridge", () => ({
  getL402: vi.fn().mockResolvedValue(""),
  getSignedMessage: vi.fn().mockResolvedValue({ signature: "", message: "" }),
  hasWebLN: vi.fn(),
  payInvoice: vi.fn(),
  enable: vi.fn(),
}))

vi.mock("@/lib/sphinx/detect", () => ({
  isSphinx: vi.fn(() => false),
  isAndroid: vi.fn(() => false),
}))

import { withdraw } from "@/lib/sphinx/payment"

describe("withdraw()", () => {
  beforeEach(() => {
    mockApiPostHoisted.mockReset()
    mockIsMocksEnabledHoisted.value = false
    mockMockTransactionsHoisted.transactions = []
    mockDecodeInvoiceAmountSatsHoisted.mockReturnValue(500)
  })

  it("calls api.post('/withdraw', { payment_request }) in live mode", async () => {
    mockApiPostHoisted.mockResolvedValue({ success: true })
    const result = await withdraw("lnbc500...")
    expect(mockApiPostHoisted).toHaveBeenCalledWith("/withdraw", { payment_request: "lnbc500..." })
    expect(result).toEqual({ success: true })
  })

  it("short-circuits and returns { success: true } in mock mode", async () => {
    mockIsMocksEnabledHoisted.value = true
    const result = await withdraw("lnbc500...")
    expect(mockApiPostHoisted).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true })
  })

  it("appends a withdrawal row to MOCK_TRANSACTIONS in mock mode", async () => {
    mockIsMocksEnabledHoisted.value = true
    mockDecodeInvoiceAmountSatsHoisted.mockReturnValue(500)
    await withdraw("lnbc500...")
    expect(mockMockTransactionsHoisted.transactions).toHaveLength(1)
    expect(mockMockTransactionsHoisted.transactions[0]).toMatchObject({
      action: "withdrawal",
      type: "debit",
      amount: 500,
    })
  })

  it("does not append to MOCK_TRANSACTIONS when decodeInvoiceAmountSats returns null", async () => {
    mockIsMocksEnabledHoisted.value = true
    mockDecodeInvoiceAmountSatsHoisted.mockReturnValue(null)
    await withdraw("lnbcamountless...")
    expect(mockMockTransactionsHoisted.transactions).toHaveLength(0)
  })
})
