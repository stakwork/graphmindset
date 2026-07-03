import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"

// --- Modal store mock ---
const mockClose = vi.fn()
const mockOpenModal = vi.fn()

vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel?: (s: unknown) => unknown) => {
    const state = { close: mockClose, open: mockOpenModal }
    return sel ? sel(state) : state
  },
}))

// --- App store mock ---
const mockSetMyContentOpen = vi.fn()

vi.mock("@/stores/app-store", () => {
  const getState = () => ({ setMyContentOpen: mockSetMyContentOpen })
  return {
    useAppStore: Object.assign(
      (sel?: (s: unknown) => unknown) => {
        const state = { setMyContentOpen: mockSetMyContentOpen }
        return sel ? sel(state) : state
      },
      { getState }
    ),
  }
})

// --- User store mock ---
const mockSetBudget = vi.fn()
const mockRefreshBalance = vi.fn().mockResolvedValue(undefined)
let mockIsAdmin = false
let mockOwnerReferenceId = ""

vi.mock("@/stores/user-store", () => ({
  useUserStore: Object.assign(
    (sel?: (s: unknown) => unknown) => {
      const state = {
        isAdmin: mockIsAdmin,
        ownerReferenceId: mockOwnerReferenceId,
        refreshBalance: mockRefreshBalance,
        setBudget: mockSetBudget,
      }
      return sel ? sel(state) : state
    },
    {
      getState: () => ({ setBudget: mockSetBudget }),
    }
  ),
}))

// --- graph-api mocks ---
const mockCheckNodeExists = vi.fn()
const mockCheckNodeExistsByHash = vi.fn()
const mockReprocessContent = vi.fn()
const mockAddLegalDocument = vi.fn()
const mockAddLegalDocumentFile = vi.fn()

vi.mock("@/lib/graph-api", () => ({
  checkNodeExists: (...args: unknown[]) => mockCheckNodeExists(...args),
  checkNodeExistsByHash: (...args: unknown[]) => mockCheckNodeExistsByHash(...args),
  reprocessContent: (...args: unknown[]) => mockReprocessContent(...args),
  addLegalDocument: (...args: unknown[]) => mockAddLegalDocument(...args),
  addLegalDocumentFile: (...args: unknown[]) => mockAddLegalDocumentFile(...args),
}))

// --- sphinx mocks ---
const mockGetPrice = vi.fn().mockResolvedValue(10)
const mockPayL402 = vi.fn().mockResolvedValue(undefined)

vi.mock("@/lib/sphinx", () => ({
  getPrice: (...args: unknown[]) => mockGetPrice(...args),
  payL402: (...args: unknown[]) => mockPayL402(...args),
  getL402: vi.fn().mockResolvedValue(null),
}))

// --- crypto.subtle mock ---
const mockDigest = vi.fn()

Object.defineProperty(globalThis, "crypto", {
  value: {
    subtle: {
      digest: (...args: unknown[]) => mockDigest(...args),
    },
  },
  writable: true,
})

import { AddLegalForm } from "@/components/modals/add-legal-form"

const EXISTING_NODE = {
  exists: true,
  ref_id: "legal-ref-1",
  status: "completed",
  owner_reference_id: "lsat:owner-uuid",
}

const NO_EXISTING_NODE = {
  exists: false,
  ref_id: null,
  status: null,
  owner_reference_id: null,
}

describe("AddLegalForm — URL mode duplicate detection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAdmin = false
    mockOwnerReferenceId = ""
    mockGetPrice.mockResolvedValue(10)
    mockCheckNodeExists.mockResolvedValue(NO_EXISTING_NODE)
    mockCheckNodeExistsByHash.mockResolvedValue(NO_EXISTING_NODE)
    mockReprocessContent.mockResolvedValue({})
    mockAddLegalDocument.mockResolvedValue({ status: "ok", nodes: [], status_messages: [] })
    mockAddLegalDocumentFile.mockResolvedValue({ status: "ok", nodes: [], status_messages: [] })
  })

  it("calls checkNodeExists('LegalDocument', url) when URL becomes valid", async () => {
    render(<AddLegalForm />)

    const input = screen.getByPlaceholderText(/https:\/\/example.com\/document.pdf/i)
    await userEvent.type(input, "https://example.com/contract.pdf")

    await waitFor(() => {
      expect(mockCheckNodeExists).toHaveBeenCalledWith(
        "LegalDocument",
        "https://example.com/contract.pdf",
        expect.any(AbortSignal)
      )
    })
  })

  it("shows yellow callout when URL matches existing LegalDocument", async () => {
    mockCheckNodeExists.mockResolvedValue(EXISTING_NODE)

    render(<AddLegalForm />)
    const input = screen.getByPlaceholderText(/https:\/\/example.com\/document.pdf/i)
    await userEvent.type(input, "https://example.com/contract.pdf")

    await waitFor(() => {
      expect(screen.getByText(/This content is already in the graph/i)).toBeInTheDocument()
    })
  })

  it("shows no callout when URL has no match", async () => {
    mockCheckNodeExists.mockResolvedValue(NO_EXISTING_NODE)

    render(<AddLegalForm />)
    const input = screen.getByPlaceholderText(/https:\/\/example.com\/document.pdf/i)
    await userEvent.type(input, "https://example.com/newdoc.pdf")

    await waitFor(() => {
      expect(mockCheckNodeExists).toHaveBeenCalled()
    })

    expect(screen.queryByText(/This content is already in the graph/i)).not.toBeInTheDocument()
  })

  it("URL callout: non-admin, non-owner sees contact admin hint, no button", async () => {
    mockCheckNodeExists.mockResolvedValue({
      ...EXISTING_NODE,
      owner_reference_id: "lsat:someone-else",
    })
    mockIsAdmin = false
    mockOwnerReferenceId = "lsat:me"

    render(<AddLegalForm />)
    const input = screen.getByPlaceholderText(/https:\/\/example.com\/document.pdf/i)
    await userEvent.type(input, "https://example.com/contract.pdf")

    await waitFor(() => {
      expect(screen.getByText(/Contact an admin to re-process/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole("button", { name: /re-process/i })).not.toBeInTheDocument()
  })

  it("URL callout: admin sees Re-process button", async () => {
    mockCheckNodeExists.mockResolvedValue(EXISTING_NODE)
    mockIsAdmin = true

    render(<AddLegalForm />)
    const input = screen.getByPlaceholderText(/https:\/\/example.com\/document.pdf/i)
    await userEvent.type(input, "https://example.com/contract.pdf")

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /re-process/i })).toBeInTheDocument()
    })
  })

  it("URL callout: owner sees Re-process button", async () => {
    mockCheckNodeExists.mockResolvedValue({
      ...EXISTING_NODE,
      owner_reference_id: "lsat:owner-uuid",
    })
    mockIsAdmin = false
    mockOwnerReferenceId = "lsat:owner-uuid"

    render(<AddLegalForm />)
    const input = screen.getByPlaceholderText(/https:\/\/example.com\/document.pdf/i)
    await userEvent.type(input, "https://example.com/contract.pdf")

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /re-process/i })).toBeInTheDocument()
    })
  })

  it("calls reprocessContent with source_link and legal_document on Re-process click", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

    mockCheckNodeExists.mockResolvedValue(EXISTING_NODE)
    mockIsAdmin = true
    mockReprocessContent.mockResolvedValue({})

    render(<AddLegalForm />)
    const input = screen.getByPlaceholderText(/https:\/\/example.com\/document.pdf/i)
    await user.type(input, "https://example.com/contract.pdf")

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /re-process/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: /re-process/i }))

    await waitFor(() => {
      expect(mockReprocessContent).toHaveBeenCalledWith(
        "legal-ref-1",
        expect.objectContaining({
          source_link: "https://example.com/contract.pdf",
          content_type: "legal_document",
        })
      )
    })

    vi.useRealTimers()
  })
})

describe("AddLegalForm — file mode hash-based dedup", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAdmin = false
    mockOwnerReferenceId = ""
    mockGetPrice.mockResolvedValue(10)
    mockCheckNodeExists.mockResolvedValue(NO_EXISTING_NODE)
    mockCheckNodeExistsByHash.mockResolvedValue(NO_EXISTING_NODE)
    mockReprocessContent.mockResolvedValue({})
    mockAddLegalDocumentFile.mockResolvedValue({ status: "ok", nodes: [], status_messages: [] })

    // Mock crypto.subtle.digest to return a fixed hash buffer
    const hashBytes = new Uint8Array(32).fill(0xab)
    mockDigest.mockResolvedValue(hashBytes.buffer)
  })

  const makePdfFile = (name = "test.pdf", sizeKB = 10) => {
    const content = new Uint8Array(sizeKB * 1024).fill(0x25) // 0x25 = '%'
    return new File([content], name, { type: "application/pdf" })
  }

  it("invokes crypto.subtle.digest on file selection", async () => {
    render(<AddLegalForm />)

    // Switch to file mode
    await userEvent.click(screen.getByRole("button", { name: /file/i }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = makePdfFile()
    await userEvent.upload(fileInput, file)

    await waitFor(() => {
      expect(mockDigest).toHaveBeenCalledWith("SHA-256", expect.any(ArrayBuffer))
    })
  })

  it("calls checkNodeExistsByHash('LegalDocument', hash) after file selection", async () => {
    render(<AddLegalForm />)
    await userEvent.click(screen.getByRole("button", { name: /file/i }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = makePdfFile()
    await userEvent.upload(fileInput, file)

    await waitFor(() => {
      expect(mockCheckNodeExistsByHash).toHaveBeenCalledWith(
        "LegalDocument",
        expect.any(String)
      )
    })
  })

  it("shows yellow callout when file hash matches existing node", async () => {
    mockCheckNodeExistsByHash.mockResolvedValue(EXISTING_NODE)

    render(<AddLegalForm />)
    await userEvent.click(screen.getByRole("button", { name: /file/i }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(fileInput, makePdfFile())

    await waitFor(() => {
      expect(screen.getByText(/This content is already in the graph/i)).toBeInTheDocument()
    })
  })

  it("no callout when hash has no match", async () => {
    mockCheckNodeExistsByHash.mockResolvedValue(NO_EXISTING_NODE)

    render(<AddLegalForm />)
    await userEvent.click(screen.getByRole("button", { name: /file/i }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(fileInput, makePdfFile())

    await waitFor(() => {
      expect(mockCheckNodeExistsByHash).toHaveBeenCalled()
    })
    expect(screen.queryByText(/This content is already in the graph/i)).not.toBeInTheDocument()
  })

  it("file callout: non-admin, non-owner sees contact admin hint", async () => {
    mockCheckNodeExistsByHash.mockResolvedValue({
      ...EXISTING_NODE,
      owner_reference_id: "lsat:someone-else",
    })
    mockIsAdmin = false
    mockOwnerReferenceId = "lsat:me"

    render(<AddLegalForm />)
    await userEvent.click(screen.getByRole("button", { name: /file/i }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(fileInput, makePdfFile())

    await waitFor(() => {
      expect(screen.getByText(/Contact an admin to re-process/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole("button", { name: /re-process/i })).not.toBeInTheDocument()
  })

  it("file callout: admin sees Re-process button", async () => {
    mockCheckNodeExistsByHash.mockResolvedValue(EXISTING_NODE)
    mockIsAdmin = true

    render(<AddLegalForm />)
    await userEvent.click(screen.getByRole("button", { name: /file/i }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(fileInput, makePdfFile())

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /re-process/i })).toBeInTheDocument()
    })
  })

  it("file callout: owner sees Re-process button", async () => {
    mockCheckNodeExistsByHash.mockResolvedValue({
      ...EXISTING_NODE,
      owner_reference_id: "lsat:owner-uuid",
    })
    mockIsAdmin = false
    mockOwnerReferenceId = "lsat:owner-uuid"

    render(<AddLegalForm />)
    await userEvent.click(screen.getByRole("button", { name: /file/i }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(fileInput, makePdfFile())

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /re-process/i })).toBeInTheDocument()
    })
  })

  it("calls reprocessContent with content_hash and legal_document on Re-process click", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

    mockCheckNodeExistsByHash.mockResolvedValue(EXISTING_NODE)
    mockIsAdmin = true
    mockReprocessContent.mockResolvedValue({})

    render(<AddLegalForm />)
    await user.click(screen.getByRole("button", { name: /file/i }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(fileInput, makePdfFile())

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /re-process/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole("button", { name: /re-process/i }))

    await waitFor(() => {
      expect(mockReprocessContent).toHaveBeenCalledWith(
        "legal-ref-1",
        expect.objectContaining({
          content_type: "legal_document",
          content_hash: expect.any(String),
        })
      )
    })
    // Should NOT have source_link for file mode
    expect(mockReprocessContent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source_link: expect.anything() })
    )

    vi.useRealTimers()
  })
})
