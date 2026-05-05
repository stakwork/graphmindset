import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import React from "react"

// --- Modal store mock ---
const mockClose = vi.fn()

vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel?: (s: unknown) => unknown) => {
    const state = { activeModal: "budget", close: mockClose }
    return sel ? sel(state) : state
  },
}))

// --- User store mock ---
const mockSetBudget = vi.fn()
const mockRefreshBalance = vi.fn().mockResolvedValue(undefined)
let mockBudget = 270

vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel?: (s: unknown) => unknown) => {
    const state = {
      budget: mockBudget,
      setBudget: mockSetBudget,
      refreshBalance: mockRefreshBalance,
    }
    return sel ? sel(state) : state
  },
}))

// --- Sphinx mocks (hoisted so we can mutate) ---
const mockIsSphinx = vi.fn(() => false)
const mockHasWebLN = vi.fn(() => false)
const mockPayInvoice = vi.fn().mockResolvedValue(true)
const mockPayL402 = vi.fn().mockResolvedValue(undefined)
const mockTopUpLsat = vi.fn().mockResolvedValue({
  payment_request: "lnbctest123",
  payment_hash: "hash123",
})
const mockTopUpConfirm = vi.fn().mockResolvedValue(undefined)
const mockPollPaymentStatus = vi.fn().mockResolvedValue(true)
const mockFetchBuyLsatChallenge = vi.fn().mockResolvedValue({
  invoice: "lnbcbuy123",
  baseMacaroon: "macaroon123",
  paymentHash: "buyhash123",
  id: "lsatid123",
})
const mockFetchTransactionHistory = vi.fn().mockResolvedValue({ transactions: [], scope: "token" })

vi.mock("@/lib/sphinx", () => ({
  isSphinx: () => mockIsSphinx(),
  hasWebLN: () => mockHasWebLN(),
  payInvoice: (...args: unknown[]) => mockPayInvoice(...args),
  payL402: (...args: unknown[]) => mockPayL402(...args),
  topUpLsat: (...args: unknown[]) => mockTopUpLsat(...args),
  topUpConfirm: (...args: unknown[]) => mockTopUpConfirm(...args),
  pollPaymentStatus: (...args: unknown[]) => mockPollPaymentStatus(...args),
  fetchBuyLsatChallenge: (...args: unknown[]) => mockFetchBuyLsatChallenge(...args),
  fetchTransactionHistory: (...args: unknown[]) => mockFetchTransactionHistory(...args),
}))

// --- Mock data ---
vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => false,
  MOCK_TRANSACTIONS: { transactions: [], scope: "token" },
}))

// --- Transaction display ---
vi.mock("@/lib/transaction-display", () => ({
  getActionDisplayLabel: vi.fn((action: string) => action),
  getActionBadgeColor: vi.fn(() => ""),
}))

// --- API mock ---
const mockApiGet = vi.fn()

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  API_URL: "http://localhost:3000",
}))

import { cookieStorage } from "@/lib/cookie-storage"
import { BudgetModal } from "@/components/modals/budget-modal"

describe("BudgetModal success screen delta", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBudget = 270
    mockRefreshBalance.mockResolvedValue(undefined)
    mockPayL402.mockResolvedValue(undefined)
    mockPayInvoice.mockResolvedValue(true)
    mockTopUpLsat.mockResolvedValue({ payment_request: "lnbctest123", payment_hash: "hash123" })
    mockTopUpConfirm.mockResolvedValue(undefined)
    mockPollPaymentStatus.mockResolvedValue(true)
    mockFetchBuyLsatChallenge.mockResolvedValue({
      invoice: "lnbcbuy123",
      baseMacaroon: "macaroon123",
      paymentHash: "buyhash123",
      id: "lsatid123",
    })
    mockIsSphinx.mockReturnValue(false)
    mockHasWebLN.mockReturnValue(false)
    cookieStorage.removeItem("l402")
  })

  it("shows +N sats added after amount-picker top-up (Sphinx/WebLN path)", async () => {
    // Setup: has existing L402 + Sphinx connected
    cookieStorage.setItem("l402", JSON.stringify({ macaroon: "mac123", preimage: "" }))
    mockIsSphinx.mockReturnValue(true)

    render(<BudgetModal />)

    // Should start at balance step — click Top Up → goes to amount step
    fireEvent.click(screen.getByText("Top Up"))

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Custom amount")).toBeInTheDocument()
    })

    // Enter custom amount 200 via input
    const input = screen.getByPlaceholderText("Custom amount")
    fireEvent.change(input, { target: { value: "200" } })

    // Click Pay & Top Up
    const payBtn = screen.getByText("Pay & Top Up")
    fireEvent.click(payBtn)

    await waitFor(() => {
      expect(screen.getByText("Top-up complete")).toBeInTheDocument()
    })

    expect(screen.getByText("+200 sats added")).toBeInTheDocument()
    expect(screen.getByText(/270/)).toBeInTheDocument()
  })

  it("shows +N sats added from firstPurchaseAmount after first-purchase QR flow", async () => {
    // Setup: no L402, no Sphinx, no WebLN → first-purchase flow
    mockIsSphinx.mockReturnValue(false)
    mockHasWebLN.mockReturnValue(false)

    render(<BudgetModal />)

    // Click Top Up → first-purchase step
    fireEvent.click(screen.getByText("Top Up"))

    await waitFor(() => {
      expect(screen.getByText("Get Started")).toBeInTheDocument()
    })

    // Set custom amount to 500
    const input = screen.getByPlaceholderText("Custom amount")
    fireEvent.change(input, { target: { value: "500" } })

    // Click Generate Invoice
    fireEvent.click(screen.getByText("Generate Invoice"))

    await waitFor(() => {
      expect(screen.getByText("Top-up complete")).toBeInTheDocument()
    })

    expect(screen.getByText("+500 sats added")).toBeInTheDocument()
  })

  beforeEach(() => {
    mockApiGet.mockReset()
  })

  it("does NOT show delta line after direct payL402 path (no amount picker)", async () => {
    // Setup: no L402, Sphinx connected → direct payL402() call, no amount picker
    mockIsSphinx.mockReturnValue(true)
    // No L402 cookie

    render(<BudgetModal />)

    // Click Top Up → should go directly through payL402 (no amount step)
    fireEvent.click(screen.getByText("Top Up"))

    await waitFor(() => {
      expect(screen.getByText("Top-up complete")).toBeInTheDocument()
    })

    // No delta line should be rendered
    expect(screen.queryByText(/sats added/)).not.toBeInTheDocument()
    // Total balance still shows
    expect(screen.getByText(/270/)).toBeInTheDocument()
  })
})

describe("BudgetModal Manage Token flow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBudget = 500
    mockRefreshBalance.mockResolvedValue(undefined)
    mockIsSphinx.mockReturnValue(false)
    mockHasWebLN.mockReturnValue(false)
    mockApiGet.mockReset()
    // Mock clipboard
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    cookieStorage.removeItem("l402")
  })

  it("exports base64 token to clipboard", async () => {
    const tokenPayload = { macaroon: "mac123", identifier: "id1", preimage: "pre1" }
    cookieStorage.setItem("l402", JSON.stringify(tokenPayload))

    render(<BudgetModal />)

    // Navigate to Manage Token
    fireEvent.click(screen.getByText("Manage Token"))
    await waitFor(() => {
      expect(screen.getByText("Manage Token")).toBeInTheDocument()
    })

    // Click Copy Token
    fireEvent.click(screen.getByText("Copy Token"))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    })

    const calledWith = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    const decoded = JSON.parse(atob(calledWith))
    expect(decoded).toEqual(tokenPayload)
  })

  it("imports a valid token, writes cookie, refreshes balance, shows success", async () => {
    mockApiGet.mockResolvedValue({ balance: 500 })

    const tokenPayload = { macaroon: "validmac", identifier: "id2", preimage: "pre2" }
    const encoded = btoa(JSON.stringify(tokenPayload))

    render(<BudgetModal />)

    // Navigate: balance → manage-token → restore
    fireEvent.click(screen.getByText("Manage Token"))
    await waitFor(() => expect(screen.getByText("Restore Token")).toBeInTheDocument())

    fireEvent.click(screen.getByText("Restore Token"))
    await waitFor(() => expect(screen.getByPlaceholderText("Paste your token here…")).toBeInTheDocument())

    // Paste token
    fireEvent.change(screen.getByPlaceholderText("Paste your token here…"), {
      target: { value: encoded },
    })

    fireEvent.click(screen.getByText("Restore Access"))

    await waitFor(() => {
      expect(screen.getByText("Top-up complete")).toBeInTheDocument()
    })

    expect(mockApiGet).toHaveBeenCalledWith("/balance", {
      Authorization: `LSAT ${tokenPayload.macaroon}:`,
    })
    expect(cookieStorage.getItem("l402")).toBe(JSON.stringify(tokenPayload))
    expect(mockRefreshBalance).toHaveBeenCalled()
  })

  it("rejects a malformed base64 string without making a network call", async () => {
    render(<BudgetModal />)

    fireEvent.click(screen.getByText("Manage Token"))
    await waitFor(() => expect(screen.getByText("Restore Token")).toBeInTheDocument())

    fireEvent.click(screen.getByText("Restore Token"))
    await waitFor(() => expect(screen.getByPlaceholderText("Paste your token here…")).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText("Paste your token here…"), {
      target: { value: "!!!not-valid-base64!!!" },
    })

    fireEvent.click(screen.getByText("Restore Access"))

    await waitFor(() => {
      expect(screen.getByText("Invalid token.")).toBeInTheDocument()
    })

    expect(mockApiGet).not.toHaveBeenCalled()
    expect(cookieStorage.getItem("l402")).toBeNull()
  })

  it("rejects a server-rejected token and does not write cookie", async () => {
    mockApiGet.mockRejectedValue(new Error("Unauthorized"))

    const tokenPayload = { macaroon: "badmac", identifier: "id3", preimage: "" }
    const encoded = btoa(JSON.stringify(tokenPayload))

    render(<BudgetModal />)

    fireEvent.click(screen.getByText("Manage Token"))
    await waitFor(() => expect(screen.getByText("Restore Token")).toBeInTheDocument())

    fireEvent.click(screen.getByText("Restore Token"))
    await waitFor(() => expect(screen.getByPlaceholderText("Paste your token here…")).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText("Paste your token here…"), {
      target: { value: encoded },
    })

    fireEvent.click(screen.getByText("Restore Access"))

    await waitFor(() => {
      expect(screen.getByText("Token not recognised or expired.")).toBeInTheDocument()
    })

    expect(cookieStorage.getItem("l402")).toBeNull()
  })
})
