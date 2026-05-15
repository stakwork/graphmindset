import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---- mock isMocksEnabled so we can control it per test ----
let mocksEnabledValue = false
vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => mocksEnabledValue,
  MOCK_NODES: [
    { ref_id: "n1", node_type: "Episode", properties: {} },
    { ref_id: "n2", node_type: "Clip", properties: {} },
    { ref_id: "n3", node_type: "Person", properties: {} },
    { ref_id: "n4", node_type: "Topic", properties: {} },
    { ref_id: "n5", node_type: "Tweet", properties: {} },
    { ref_id: "n6", node_type: "Article", properties: {} },
  ],
  MOCK_EDGES: [
    { source: "n1", target: "n2", edge_type: "HAS_CLIP" },
    { source: "n2", target: "n3", edge_type: "FEATURES" },
    { source: "n3", target: "n4", edge_type: "RELATED" },
    { source: "n4", target: "n5", edge_type: "MENTIONS" },
    { source: "n5", target: "n6", edge_type: "LINKS" },
    { source: "n6", target: "n1", edge_type: "BELONGS_TO" },
  ],
}))

// ---- mock api ----
const mockApiGet = vi.fn()
const mockApiPost = vi.fn()
const mockApiDelete = vi.fn()
vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
}))

import { watchNode, unwatchNode, subscribeType, unsubscribeType, getWatches, getFollowingFeed } from "@/lib/watch-api"

describe("watch-api — live mode", () => {
  beforeEach(() => {
    mocksEnabledValue = false
    mockApiGet.mockReset()
    mockApiPost.mockReset()
    mockApiDelete.mockReset()
  })

  it("watchNode calls POST /v2/watch/node/:refId", async () => {
    mockApiPost.mockResolvedValue({})
    await watchNode("abc-123")
    expect(mockApiPost).toHaveBeenCalledWith("/v2/watch/node/abc-123", {})
  })

  it("unwatchNode calls DELETE /v2/watch/node/:refId", async () => {
    mockApiDelete.mockResolvedValue({})
    await unwatchNode("abc-123")
    expect(mockApiDelete).toHaveBeenCalledWith("/v2/watch/node/abc-123")
  })

  it("subscribeType calls POST /v2/watch/type/:nodeType", async () => {
    mockApiPost.mockResolvedValue({})
    await subscribeType("Episode")
    expect(mockApiPost).toHaveBeenCalledWith("/v2/watch/type/Episode", {})
  })

  it("unsubscribeType calls DELETE /v2/watch/type/:nodeType", async () => {
    mockApiDelete.mockResolvedValue({})
    await unsubscribeType("Clip")
    expect(mockApiDelete).toHaveBeenCalledWith("/v2/watch/type/Clip")
  })

  it("getWatches calls GET /v2/watches and returns mapped response", async () => {
    const mockResponse = {
      nodes: [{ ref_id: "node-1", node_type: "Episode", title: "Some Episode" }],
      types: ["Clip", "Person"],
    }
    mockApiGet.mockResolvedValue(mockResponse)
    const result = await getWatches()
    expect(mockApiGet).toHaveBeenCalledWith("/v2/watches")
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].ref_id).toBe("node-1")
    expect(result.types).toEqual(["Clip", "Person"])
  })

  it("getFollowingFeed calls GET /v2/feed/following", async () => {
    const mockResponse = { nodes: [], edges: [] }
    mockApiGet.mockResolvedValue(mockResponse)
    const result = await getFollowingFeed()
    expect(mockApiGet).toHaveBeenCalledWith("/v2/feed/following")
    expect(result.nodes).toEqual([])
  })
})

describe("watch-api — mock mode", () => {
  beforeEach(() => {
    mocksEnabledValue = true
    mockApiGet.mockReset()
    mockApiPost.mockReset()
    mockApiDelete.mockReset()
  })

  afterEach(() => {
    mocksEnabledValue = false
  })

  it("watchNode resolves immediately without calling api", async () => {
    await watchNode("x")
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it("unwatchNode resolves immediately without calling api", async () => {
    await unwatchNode("x")
    expect(mockApiDelete).not.toHaveBeenCalled()
  })

  it("subscribeType resolves immediately without calling api", async () => {
    await subscribeType("Clip")
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it("unsubscribeType resolves immediately without calling api", async () => {
    await unsubscribeType("Clip")
    expect(mockApiDelete).not.toHaveBeenCalled()
  })

  it("getWatches returns stub data without calling api", async () => {
    const result = await getWatches()
    expect(mockApiGet).not.toHaveBeenCalled()
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].ref_id).toBe("mock-1")
    expect(result.nodes[0].node_type).toBe("Episode")
    expect(result.types).toContain("Clip")
  })

  it("getFollowingFeed returns first 5 MOCK_NODES and MOCK_EDGES without calling api", async () => {
    const result = await getFollowingFeed()
    expect(mockApiGet).not.toHaveBeenCalled()
    expect(result.nodes).toHaveLength(5)
    expect(result.edges).toHaveLength(5)
  })
})
