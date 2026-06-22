import { describe, it, expect, vi, beforeEach } from "vitest"

// ── mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/mock-data", () => ({ isMocksEnabled: () => false }))

vi.mock("@/lib/sphinx", () => ({
  getSignedMessage: vi.fn().mockResolvedValue({ signature: "sig1", message: "msg1" }),
  getL402: vi.fn().mockResolvedValue("LSAT tok"),
  payL402: vi.fn(),
}))

vi.mock("@/stores/modal-store", () => ({
  useModalStore: { getState: vi.fn(() => ({ open: vi.fn() })) },
}))

// Capture fetch calls
const mockFetch = vi.fn()
global.fetch = mockFetch

import { streamAgent } from "@/lib/agent-api"
import type { StreamAgentOpts } from "@/lib/agent-api"

function makeOpts(overrides: Partial<StreamAgentOpts> = {}): StreamAgentOpts {
  return {
    onChunk: vi.fn(),
    onToolCall: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

function makeSseResponse(chunks: object[]): Promise<Response> {
  const encoder = new TextEncoder()
  const lines = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")
  const bytes = encoder.encode(lines)

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })

  return Promise.resolve(
    new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
  )
}

const defaultSseChunks = [
  { type: "text-delta", textDelta: "hello " },
  { type: "finish-message" },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockImplementation(() => makeSseResponse(defaultSseChunks))
})

// ─── context field in POST body ──────────────────────────────────────────────

describe("streamAgent – context in POST body", () => {
  it("includes context in body when opts.context is provided", async () => {
    const opts = makeOpts({
      context: { selectedRefId: "ep-42", nodeType: "Episode", title: "My Episode" },
    })
    await streamAgent("Tell me about it", opts)

    expect(mockFetch).toHaveBeenCalledOnce()
    const [, fetchOpts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(fetchOpts.body as string)

    expect(body.context).toEqual({
      selectedRefId: "ep-42",
      nodeType: "Episode",
      title: "My Episode",
    })
  })

  it("omits context key when opts.context is not provided", async () => {
    const opts = makeOpts()
    await streamAgent("General question", opts)

    const [, fetchOpts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(fetchOpts.body as string)

    expect(body).not.toHaveProperty("context")
  })

  it("includes sessionId alongside context when both provided", async () => {
    const opts = makeOpts({
      sessionId: "sess-99",
      context: { selectedRefId: "vid-1", nodeType: "Video" },
    })
    await streamAgent("Explain this video", opts)

    const [, fetchOpts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(fetchOpts.body as string)

    expect(body.sessionId).toBe("sess-99")
    expect(body.context?.selectedRefId).toBe("vid-1")
  })

  it("includes stream: true in POST body", async () => {
    const opts = makeOpts()
    await streamAgent("Q?", opts)

    const [, fetchOpts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(fetchOpts.body as string)
    expect(body.stream).toBe(true)
  })

  it("sends Accept: text/event-stream header", async () => {
    const opts = makeOpts()
    await streamAgent("Q?", opts)

    const [, fetchOpts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = fetchOpts.headers as Record<string, string>
    expect(headers["Accept"]).toBe("text/event-stream")
  })
})

// ─── SSE streaming behaviour ──────────────────────────────────────────────────

describe("streamAgent – SSE streaming", () => {
  it("text-delta chunk calls onChunk with the delta string", async () => {
    const onChunk = vi.fn()
    await streamAgent(
      "Q?",
      makeOpts({
        onChunk,
        ...await makeSseResponse([
          { type: "text-delta", textDelta: "Hello!" },
          { type: "finish-message" },
        ]).then(() => ({})),
      })
    )
    // Use a dedicated fetch mock for this test
    const onChunk2 = vi.fn()
    mockFetch.mockImplementationOnce(() =>
      makeSseResponse([
        { type: "text-delta", textDelta: "Hello!" },
        { type: "finish-message" },
      ])
    )
    await streamAgent("Q?", makeOpts({ onChunk: onChunk2 }))
    expect(onChunk2).toHaveBeenCalledWith("Hello!")
  })

  it("tool-input-available calls onToolCall with status in-flight", async () => {
    const onToolCall = vi.fn()
    mockFetch.mockImplementationOnce(() =>
      makeSseResponse([
        {
          type: "tool-input-available",
          toolCallId: "tc-1",
          toolName: "graph_search",
          input: { q: "bitcoin" },
        },
        { type: "finish-message" },
      ])
    )
    await streamAgent("Q?", makeOpts({ onToolCall }))
    expect(onToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tc-1",
        tool: "graph_search",
        params: { q: "bitcoin" },
        status: "in-flight",
      })
    )
  })

  it("finish-step after tool-input-available calls onToolCall with status done", async () => {
    const onToolCall = vi.fn()
    mockFetch.mockImplementationOnce(() =>
      makeSseResponse([
        {
          type: "tool-input-available",
          toolCallId: "tc-2",
          toolName: "graph_node",
          input: { ref_id: "node-1" },
        },
        { type: "finish-step" },
        { type: "finish-message" },
      ])
    )
    await streamAgent("Q?", makeOpts({ onToolCall }))

    const calls = onToolCall.mock.calls.map((c) => c[0])
    const inFlight = calls.find((c) => c.id === "tc-2" && c.status === "in-flight")
    const done = calls.find((c) => c.id === "tc-2" && c.status === "done")
    expect(inFlight).toBeDefined()
    expect(done).toBeDefined()
  })

  it("finish-message calls onDone with accumulated text and empty cited_ref_ids", async () => {
    const onDone = vi.fn()
    mockFetch.mockImplementationOnce(() =>
      makeSseResponse([
        { type: "text-delta", textDelta: "Foo " },
        { type: "text-delta", textDelta: "bar." },
        { type: "finish-message" },
      ])
    )
    await streamAgent("Q?", makeOpts({ onDone }))
    expect(onDone).toHaveBeenCalledWith({ answer: "Foo bar.", cited_ref_ids: [] })
  })

  it("fallback onDone called when stream ends without finish-message", async () => {
    const onDone = vi.fn()
    mockFetch.mockImplementationOnce(() =>
      makeSseResponse([{ type: "text-delta", textDelta: "Partial." }])
    )
    await streamAgent("Q?", makeOpts({ onDone }))
    expect(onDone).toHaveBeenCalledWith({ answer: "Partial.", cited_ref_ids: [] })
  })
})

// ─── 402 retry flow ────────────────────────────────────────────────────────────

describe("streamAgent – 402 retry", () => {
  it("pays L402 and retries on 402 response", async () => {
    const { payL402 } = await import("@/lib/sphinx")
    const onDone = vi.fn()

    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 402 }))
      .mockImplementationOnce(() => makeSseResponse(defaultSseChunks))

    await streamAgent("Q?", makeOpts({ onDone }))

    expect(payL402).toHaveBeenCalled()
    expect(onDone).toHaveBeenCalled()
  })
})

// ─── AbortSignal cancellation ─────────────────────────────────────────────────

describe("streamAgent – AbortSignal", () => {
  it("resolves without calling onError when aborted", async () => {
    const onError = vi.fn()
    const controller = new AbortController()

    mockFetch.mockImplementationOnce(() => {
      controller.abort()
      return Promise.reject(new DOMException("Aborted", "AbortError"))
    })

    await streamAgent("Q?", makeOpts({ onError, signal: controller.signal }))
    expect(onError).not.toHaveBeenCalled()
  })
})
