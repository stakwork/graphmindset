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

function okResponse(body: object) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockImplementation(() =>
    okResponse({ answer: "hello", cited_ref_ids: [] })
  )
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

  it("calls onDone with the API response answer", async () => {
    mockFetch.mockImplementation(() =>
      okResponse({ answer: "Final answer.", cited_ref_ids: ["n1"] })
    )
    const onDone = vi.fn()
    await streamAgent("Q?", makeOpts({ onDone }))

    expect(onDone).toHaveBeenCalledWith({
      answer: "Final answer.",
      cited_ref_ids: ["n1"],
    })
  })
})
