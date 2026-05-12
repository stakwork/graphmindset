import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { isMocksEnabledMock, apiGetSpy, getL402Mock, getSignedMessageMock } = vi.hoisted(() => ({
  isMocksEnabledMock: vi.fn(() => true),
  apiGetSpy: vi.fn(),
  getL402Mock: vi.fn(),
  getSignedMessageMock: vi.fn(),
}))

vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: isMocksEnabledMock,
  MOCK_REVIEWS: [],
}))

vi.mock("@/lib/sphinx", () => ({
  getL402: getL402Mock,
  getSignedMessage: getSignedMessageMock,
}))

// Mock the api module so we can spy on get
vi.mock("@/lib/api", () => ({
  api: {
    get: apiGetSpy,
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  API_URL: "http://localhost:3000/api",
}))

const MOCK_SCHEMAS = [
  {
    ref_id: "topic-id",
    type: "Topic",
    parent: "Thing",
    color: "#111",
    node_key: "topic-name",
    attributes: [{ key: "name", type: "string", required: true }],
    inherited_attributes: [],
  },
  {
    ref_id: "person-id",
    type: "Person",
    parent: "Thing",
    color: "#222",
    node_key: "person-name",
    attributes: [{ key: "name", type: "string", required: true }],
    inherited_attributes: [],
  },
]

let storeSchemas = MOCK_SCHEMAS

vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: {
    getState: () => ({ schemas: storeSchemas }),
  },
}))

import { fetchSchemaByType } from "@/lib/graph-api"

describe("fetchSchemaByType", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeSchemas = MOCK_SCHEMAS
    getSignedMessageMock.mockResolvedValue({ signature: "", message: "" })
  })

  describe("mock mode (isMocksEnabled = true)", () => {
    beforeEach(() => {
      isMocksEnabledMock.mockReturnValue(true)
    })

    it("returns the matching schema from the store without calling api.get", async () => {
      const result = await fetchSchemaByType("Topic")
      expect(result).toEqual(MOCK_SCHEMAS[0])
      expect(apiGetSpy).not.toHaveBeenCalled()
    })

    it("returns null when the type is not found in the store", async () => {
      const result = await fetchSchemaByType("NonExistent")
      expect(result).toBeNull()
      expect(apiGetSpy).not.toHaveBeenCalled()
    })

    it("returns the correct schema for different types", async () => {
      const result = await fetchSchemaByType("Person")
      expect(result?.type).toBe("Person")
      expect(result?.node_key).toBe("person-name")
      expect(apiGetSpy).not.toHaveBeenCalled()
    })
  })

  describe("live mode (isMocksEnabled = false)", () => {
    beforeEach(() => {
      isMocksEnabledMock.mockReturnValue(false)
    })

    it("calls api.get with the correct path", async () => {
      const mockSchema = { type: "Topic", node_key: "topic-name", attributes: [] }
      apiGetSpy.mockResolvedValue(mockSchema)

      const result = await fetchSchemaByType("Topic")
      expect(apiGetSpy).toHaveBeenCalledWith("/schema/Topic")
      expect(result).toEqual(mockSchema)
    })

    it("returns null on API error", async () => {
      apiGetSpy.mockRejectedValue(new Error("Network error"))

      const result = await fetchSchemaByType("Topic")
      expect(result).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// node_key derivation logic — tested via the exported deriveKeyField pattern
// These are pure logic tests asserting the transformation behaviour.
// ---------------------------------------------------------------------------

describe("node_key derivation (pure logic)", () => {
  // Since deriveKeyField is internal, we verify it via the modal's integration
  // tests. Here we document the expected mappings as assertions on string ops.

  function deriveKeyField(nodeKey: string, nodeType: string): string {
    const prefix = nodeType.toLowerCase() + "-"
    if (nodeKey.startsWith(prefix)) return nodeKey.slice(prefix.length)
    const dashIdx = nodeKey.indexOf("-")
    if (dashIdx !== -1) return nodeKey.slice(dashIdx + 1)
    return nodeKey
  }

  it('"topic-name" → "name"', () => {
    expect(deriveKeyField("topic-name", "Topic")).toBe("name")
  })

  it('"episode-source_link" → "source_link"', () => {
    expect(deriveKeyField("episode-source_link", "Episode")).toBe("source_link")
  })

  it("single-segment key (no dash) → full key", () => {
    expect(deriveKeyField("name", "Topic")).toBe("name")
  })

  it("mismatched prefix falls back to stripping at first dash", () => {
    // e.g. "thing-name" when type is "Topic" — prefix is "topic-", mismatch
    // falls back to stripping at first "-"
    expect(deriveKeyField("thing-name", "Topic")).toBe("name")
  })
})
