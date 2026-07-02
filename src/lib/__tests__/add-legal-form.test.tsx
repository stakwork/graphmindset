import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"

// --- Modal store mock ---
const mockClose = vi.fn()
let mockAddTab = "legal"

vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel?: (s: unknown) => unknown) => {
    const state = {
      activeModal: "add",
      addTab: mockAddTab,
      close: mockClose,
      setAddTab: vi.fn(),
      open: vi.fn(),
      openAdd: vi.fn(),
    }
    return sel ? sel(state) : state
  },
}))

// --- App store mock ---
const mockSetMyContentOpen = vi.fn()
let mockActiveSkin = "legal"

vi.mock("@/stores/app-store", () => {
  const getState = () => ({
    setMyContentOpen: mockSetMyContentOpen,
    activeSkin: mockActiveSkin,
  })
  return {
    useAppStore: Object.assign(
      (sel?: (s: unknown) => unknown) => {
        const state = { activeSkin: mockActiveSkin, setMyContentOpen: mockSetMyContentOpen }
        return sel ? sel(state) : state
      },
      { getState }
    ),
  }
})

// --- Graph API mocks ---
const mockAddLegalDocument = vi.fn()
const mockAddLegalDocumentFile = vi.fn()

vi.mock("@/lib/graph-api", () => ({
  addLegalDocument: (...args: unknown[]) => mockAddLegalDocument(...args),
  addLegalDocumentFile: (...args: unknown[]) => mockAddLegalDocumentFile(...args),
}))

// --- UI component mocks ---
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    className,
    variant,
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    className?: string
    variant?: string
  }) => (
    <button onClick={onClick} disabled={disabled} className={className} data-variant={variant}>
      {children}
    </button>
  ),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(" "),
}))

// Import the component under test
import { AddLegalForm } from "@/components/modals/add-legal-form"
import { AddModal } from "@/components/modals/add-modal"

// --- Additional mocks needed for AddModal ---
vi.mock("@/components/modals/add-source-form", () => ({
  AddSourceForm: () => <div data-testid="add-source-form" />,
}))

vi.mock("@/components/modals/add-node-form", () => ({
  AddNodeForm: () => <div data-testid="add-node-form" />,
}))

vi.mock("@/components/modals/add-edge-form", () => ({
  AddEdgeForm: () => <div data-testid="add-edge-form" />,
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}))

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockActiveSkin = "legal"
  mockAddTab = "legal"
  mockAddLegalDocument.mockResolvedValue({ status: "Success", nodes: [], status_messages: [] })
  mockAddLegalDocumentFile.mockResolvedValue({ status: "Success", nodes: [], status_messages: [] })
})

afterEach(() => {
  // Ensure fake timers never leak between tests
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// AddLegalForm — URL mode
// ---------------------------------------------------------------------------

describe("AddLegalForm — URL mode", () => {
  it("renders URL input by default", () => {
    render(<AddLegalForm />)
    expect(screen.getByPlaceholderText(/https:\/\/example\.com\/document\.pdf/i)).toBeInTheDocument()
  })

  it("disables submit when URL is empty", () => {
    render(<AddLegalForm />)
    const btn = screen.getByRole("button", { name: /add document/i })
    expect(btn).toBeDisabled()
  })

  it("disables submit for malformed URL", async () => {
    render(<AddLegalForm />)
    const input = screen.getByPlaceholderText(/https:\/\/example\.com\/document\.pdf/i)
    await userEvent.type(input, "not-a-url")
    const btn = screen.getByRole("button", { name: /add document/i })
    expect(btn).toBeDisabled()
  })

  it("enables submit for valid URL", async () => {
    render(<AddLegalForm />)
    const input = screen.getByPlaceholderText(/https:\/\/example\.com\/document\.pdf/i)
    await userEvent.type(input, "https://example.com/doc.pdf")
    const btn = screen.getByRole("button", { name: /add document/i })
    expect(btn).not.toBeDisabled()
  })

  it("calls addLegalDocument with the entered URL on submit", async () => {
    render(<AddLegalForm />)
    const input = screen.getByPlaceholderText(/https:\/\/example\.com\/document\.pdf/i)
    await userEvent.type(input, "https://example.com/doc.pdf")
    await userEvent.click(screen.getByRole("button", { name: /add document/i }))
    await waitFor(() => {
      expect(mockAddLegalDocument).toHaveBeenCalledWith("https://example.com/doc.pdf")
    })
  })
})

// ---------------------------------------------------------------------------
// AddLegalForm — File mode
// ---------------------------------------------------------------------------

describe("AddLegalForm — File mode", () => {
  it("switches to file mode", async () => {
    render(<AddLegalForm />)
    await userEvent.click(screen.getByRole("button", { name: /file/i }))
    expect(screen.getByText(/click to select a pdf file/i)).toBeInTheDocument()
  })

  it("shows error for non-PDF file", async () => {
    // applyAccept: false lets the non-PDF through to our component's own validation
    const user = userEvent.setup({ applyAccept: false })
    render(<AddLegalForm />)
    await user.click(screen.getByRole("button", { name: /file/i }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const docxFile = new File(["content"], "resume.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })
    await user.upload(fileInput, docxFile)

    expect(await screen.findByText(/only pdf files are accepted/i)).toBeInTheDocument()
  })

  it("shows error for oversized PDF", async () => {
    render(<AddLegalForm />)
    await userEvent.click(screen.getByRole("button", { name: /file/i }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    // 21 MB PDF
    const bigFile = new File([new ArrayBuffer(21 * 1024 * 1024)], "big.pdf", {
      type: "application/pdf",
    })
    await userEvent.upload(fileInput, bigFile)

    expect(await screen.findByText(/exceeds the 20 mb limit/i)).toBeInTheDocument()
  })

  it("enables submit for valid PDF ≤ 20 MB", async () => {
    render(<AddLegalForm />)
    await userEvent.click(screen.getByRole("button", { name: /file/i }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const pdfFile = new File(["pdf content"], "doc.pdf", { type: "application/pdf" })
    await userEvent.upload(fileInput, pdfFile)

    const btn = screen.getByRole("button", { name: /add document/i })
    expect(btn).not.toBeDisabled()
  })

  it("calls addLegalDocumentFile on submit with a valid PDF", async () => {
    render(<AddLegalForm />)
    await userEvent.click(screen.getByRole("button", { name: /file/i }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const pdfFile = new File(["pdf content"], "doc.pdf", { type: "application/pdf" })
    await userEvent.upload(fileInput, pdfFile)

    await userEvent.click(screen.getByRole("button", { name: /add document/i }))

    await waitFor(() => {
      expect(mockAddLegalDocumentFile).toHaveBeenCalledWith(pdfFile)
    })
  })
})

// ---------------------------------------------------------------------------
// AddLegalForm — Success path
// ---------------------------------------------------------------------------

describe("AddLegalForm — success path", () => {
  it("calls close() and setMyContentOpen(true) after 1200 ms on success", async () => {
    // shouldAdvanceTime: true lets real time still pass so waitFor/promises work
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

    render(<AddLegalForm />)
    const input = screen.getByPlaceholderText(/https:\/\/example\.com\/document\.pdf/i)
    await user.type(input, "https://example.com/doc.pdf")
    await user.click(screen.getByRole("button", { name: /add document/i }))

    await waitFor(() => {
      expect(mockAddLegalDocument).toHaveBeenCalled()
    })

    // Fast-forward past the 1200 ms delay
    await vi.advanceTimersByTimeAsync(1200)

    await waitFor(() => {
      expect(mockClose).toHaveBeenCalled()
      expect(mockSetMyContentOpen).toHaveBeenCalledWith(true)
    })
  })
})

// ---------------------------------------------------------------------------
// AddLegalForm — Error path
// ---------------------------------------------------------------------------

describe("AddLegalForm — error path", () => {
  it("shows error message and keeps modal open on API failure", async () => {
    mockAddLegalDocument.mockRejectedValue(
      Object.assign(new Response(JSON.stringify({ message: "Server error" }), { status: 500 }), {})
    )

    render(<AddLegalForm />)
    const input = screen.getByPlaceholderText(/https:\/\/example\.com\/document\.pdf/i)
    await userEvent.type(input, "https://example.com/doc.pdf")
    await userEvent.click(screen.getByRole("button", { name: /add document/i }))

    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeInTheDocument()
    })
    expect(mockClose).not.toHaveBeenCalled()
  })

  it("shows fallback error message for generic errors", async () => {
    mockAddLegalDocument.mockRejectedValue(new Error("Network failure"))

    render(<AddLegalForm />)
    const input = screen.getByPlaceholderText(/https:\/\/example\.com\/document\.pdf/i)
    await userEvent.type(input, "https://example.com/doc.pdf")
    await userEvent.click(screen.getByRole("button", { name: /add document/i }))

    await waitFor(() => {
      expect(screen.getByText(/failed to submit document/i)).toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// AddModal — Skin guard integration
// ---------------------------------------------------------------------------

describe("AddModal — skin guard", () => {
  it("shows Legal tab first when activeSkin === 'legal'", () => {
    mockActiveSkin = "legal"
    mockAddTab = "legal"
    render(<AddModal />)
    expect(screen.getByRole("button", { name: /legal/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /other/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^smart$/i })).not.toBeInTheDocument()
  })

  it("shows Smart tab (no Legal) when activeSkin !== 'legal'", () => {
    mockActiveSkin = "default"
    mockAddTab = "source"
    render(<AddModal />)
    expect(screen.getByRole("button", { name: /^smart$/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^legal$/i })).not.toBeInTheDocument()
  })

  it("stale-tab guard: falls back to 'source' when legal tab active but skin switches to default", () => {
    // Tab is "legal" but skin is now "default" — should render Smart tab as active
    mockActiveSkin = "default"
    mockAddTab = "legal" // stale value
    render(<AddModal />)
    // The AddSourceForm should be rendered (source tab is the fallback first tab)
    expect(screen.getByTestId("add-source-form")).toBeInTheDocument()
  })
})
