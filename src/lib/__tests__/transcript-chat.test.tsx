import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import React from "react"

// ── mock agent-api ────────────────────────────────────────────────────────────
const { mockStreamAgent } = vi.hoisted(() => ({
  mockStreamAgent: vi.fn(),
}))
vi.mock("@/lib/agent-api", () => ({
  streamAgent: (...args: unknown[]) => mockStreamAgent(...args),
}))

// ── mock modal-store (for L402 budget modal path) ────────────────────────────
const mockOpenModal = vi.fn()
vi.mock("@/stores/modal-store", () => ({
  useModalStore: (sel: (s: { open: typeof mockOpenModal }) => unknown) =>
    sel({ open: mockOpenModal }),
}))

// ── mock MessageList so we don't pull in the whole graph-rendering stack ──────
vi.mock("@/components/agent/message-list", () => ({
  MessageList: ({ messages }: { messages: { role: string; content: string }[] }) => (
    <div data-testid="message-list">
      {messages.map((m, i) => (
        <div key={i} data-testid={`msg-${m.role}`}>{m.content}</div>
      ))}
    </div>
  ),
}))

import { TranscriptChatWidget } from "@/components/agent/transcript-chat"
import type { AgentChatContext } from "@/components/agent/transcript-chat"
import userEvent from "@testing-library/user-event"

const CONTEXT: AgentChatContext = {
  selectedRefId: "ep-123",
  nodeType: "Episode",
  title: "Test Episode",
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: streamAgent resolves silently (will be overridden per test)
  mockStreamAgent.mockResolvedValue(undefined)
})

// ─── Collapsed / Expand ───────────────────────────────────────────────────────

describe("TranscriptChatWidget – collapsed state", () => {
  it("renders the 'Ask about this content' button by default", () => {
    render(<TranscriptChatWidget context={CONTEXT} />)
    expect(
      screen.getByRole("button", { name: /ask about this content/i })
    ).toBeInTheDocument()
  })

  it("does NOT show the textarea while collapsed", () => {
    render(<TranscriptChatWidget context={CONTEXT} />)
    expect(screen.queryByPlaceholderText(/ask a question/i)).toBeNull()
  })
})

describe("TranscriptChatWidget – expanded state", () => {
  it("clicking the collapsed button expands the widget and shows the textarea", async () => {
    const user = userEvent.setup()
    render(<TranscriptChatWidget context={CONTEXT} />)

    await user.click(screen.getByRole("button", { name: /ask about this content/i }))

    expect(
      screen.getByPlaceholderText(/ask a question about this transcript/i)
    ).toBeInTheDocument()
  })

  it("shows the Send button in expanded state", async () => {
    const user = userEvent.setup()
    render(<TranscriptChatWidget context={CONTEXT} />)
    await user.click(screen.getByRole("button", { name: /ask about this content/i }))
    expect(screen.getByRole("button", { name: /send message/i })).toBeInTheDocument()
  })

  it("clicking Collapse button hides the textarea again", async () => {
    const user = userEvent.setup()
    render(<TranscriptChatWidget context={CONTEXT} />)

    await user.click(screen.getByRole("button", { name: /ask about this content/i }))
    expect(screen.getByPlaceholderText(/ask a question/i)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /collapse chat/i }))
    expect(screen.queryByPlaceholderText(/ask a question/i)).toBeNull()
  })
})

// ─── Interaction: submit calls streamAgent with correct context ───────────────

describe("TranscriptChatWidget – submit", () => {
  it("calls streamAgent with context.selectedRefId when a message is submitted", async () => {
    const user = userEvent.setup()
    let capturedOpts: Parameters<typeof mockStreamAgent>[1] | undefined

    mockStreamAgent.mockImplementation((_prompt: string, opts: Parameters<typeof mockStreamAgent>[1]) => {
      capturedOpts = opts
      opts.onDone({ answer: "A great answer.", cited_ref_ids: [] })
      return Promise.resolve()
    })

    render(<TranscriptChatWidget context={CONTEXT} />)
    await user.click(screen.getByRole("button", { name: /ask about this content/i }))

    const textarea = screen.getByPlaceholderText(/ask a question/i)
    await user.type(textarea, "What is this about?")
    await user.click(screen.getByRole("button", { name: /send message/i }))

    await waitFor(() => {
      expect(mockStreamAgent).toHaveBeenCalledOnce()
    })

    expect(capturedOpts?.context?.selectedRefId).toBe("ep-123")
    expect(capturedOpts?.context?.nodeType).toBe("Episode")
    expect(capturedOpts?.context?.title).toBe("Test Episode")
  })

  it("submits on Enter key press", async () => {
    const user = userEvent.setup()
    mockStreamAgent.mockImplementation((_p: string, opts: Parameters<typeof mockStreamAgent>[1]) => {
      opts.onDone({ answer: "Done.", cited_ref_ids: [] })
      return Promise.resolve()
    })

    render(<TranscriptChatWidget context={CONTEXT} />)
    await user.click(screen.getByRole("button", { name: /ask about this content/i }))
    const textarea = screen.getByPlaceholderText(/ask a question/i)
    await user.type(textarea, "Question{Enter}")

    await waitFor(() => {
      expect(mockStreamAgent).toHaveBeenCalledOnce()
    })
  })
})

// ─── Session reset on selectedRefId change ───────────────────────────────────

describe("TranscriptChatWidget – session reset on context change", () => {
  it("collapses and clears messages when selectedRefId changes", async () => {
    const user = userEvent.setup()
    mockStreamAgent.mockImplementation((_p: string, opts: Parameters<typeof mockStreamAgent>[1]) => {
      opts.onDone({ answer: "Reply.", cited_ref_ids: [] })
      return Promise.resolve()
    })

    const { rerender } = render(<TranscriptChatWidget context={CONTEXT} />)
    await user.click(screen.getByRole("button", { name: /ask about this content/i }))
    const textarea = screen.getByPlaceholderText(/ask a question/i)
    await user.type(textarea, "Hello{Enter}")

    // Wait for the message list to appear
    await waitFor(() => expect(screen.getByTestId("message-list")).toBeInTheDocument())

    // Switch to a different node
    rerender(
      <TranscriptChatWidget
        context={{ selectedRefId: "ep-999", nodeType: "Episode", title: "Other" }}
      />
    )

    // Widget should collapse and messages should be cleared
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/ask a question/i)).toBeNull()
    })
    expect(screen.queryByTestId("message-list")).toBeNull()
  })
})
