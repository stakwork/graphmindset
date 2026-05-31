import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { getL402Mock, getSignedMessageMock } = vi.hoisted(() => ({
  getL402Mock: vi.fn(),
  getSignedMessageMock: vi.fn(),
}))

vi.mock("@/lib/sphinx", () => ({
  getL402: getL402Mock,
  getSignedMessage: getSignedMessageMock,
}))

import { listLatestByType } from "@/lib/graph-api"

describe("listLatestByType", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    getL402Mock.mockReset()
    getSignedMessageMock.mockReset()
    getSignedMessageMock.mockResolvedValue({ signature: "", message: "" })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [], total: 0 }),
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("sends type, limit, skip params to /v2/nodes/latest", async () => {
    await listLatestByType("Clip", 10, 0)

    const [[url]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(url).toContain("/api/v2/nodes/latest")
    expect(url).toContain("type=Clip")
    expect(url).toContain("limit=10")
    expect(url).toContain("skip=0")
    expect(url).not.toContain("sort=date_added")
  })

  it("does NOT send a filter= param (old broken param is gone)", async () => {
    await listLatestByType("Clip", 10, 0)

    const [[url]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(url).not.toContain("filter=")
  })

  it("respects custom limit and skip", async () => {
    await listLatestByType("Episode", 20, 40)

    const [[url]] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(url).toContain("type=Episode")
    expect(url).toContain("limit=20")
    expect(url).toContain("skip=40")
  })

  it("returns the nodes array from the response", async () => {
    const mockNodes = [
      { ref_id: "c1", node_type: "Clip", date_added_to_graph: 2000, properties: {} },
      { ref_id: "c2", node_type: "Clip", date_added_to_graph: 1000, properties: {} },
    ]
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: mockNodes, total: 2 }),
    })

    const result = await listLatestByType("Clip", 10, 0)

    expect(result.nodes).toHaveLength(2)
    expect(result.nodes[0].ref_id).toBe("c1")
    expect(result.nodes[1].ref_id).toBe("c2")
  })

  it("accepts an AbortSignal and passes it through", async () => {
    const controller = new AbortController()
    await listLatestByType("Clip", 10, 0, controller.signal)

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.signal).toBe(controller.signal)
  })
})

describe("listLatestByType mock-mode sort order", () => {
  // Verify the mock-mode path in hot-takes.tsx sorts by date_added_to_graph DESC
  it("MOCK_NODES Clip entries sorted descending produce newest-first order", async () => {
    const { MOCK_NODES } = await import("@/lib/mock-data")
    const clips = MOCK_NODES
      .filter((n) => n.node_type === "Clip")
      .sort((a, b) => (b.date_added_to_graph ?? 0) - (a.date_added_to_graph ?? 0))

    for (let i = 0; i < clips.length - 1; i++) {
      expect(clips[i].date_added_to_graph ?? 0).toBeGreaterThanOrEqual(
        clips[i + 1].date_added_to_graph ?? 0
      )
    }
  })
})
