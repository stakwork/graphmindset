import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock dependencies before importing the store
vi.mock("@/lib/mock-data", () => ({ isMocksEnabled: () => false }))

const mockPut = vi.fn()
const mockPost = vi.fn()
vi.mock("@/lib/api", () => ({
  api: {
    put: (...args: unknown[]) => mockPut(...args),
    post: (...args: unknown[]) => mockPost(...args),
    get: vi.fn(),
    delete: vi.fn(),
  },
}))

// Import after mocks
const { useSchemaStore } = await import("@/stores/schema-store")

const makeSchema = (overrides = {}) => ({
  ref_id: "test-1",
  type: "TestType",
  parent: "Thing",
  color: "#6366f1",
  node_key: "name",
  attributes: [{ key: "name", type: "string", required: true }],
  ...overrides,
})

describe("schema-store – updateSchema", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSchemaStore.setState({ schemas: [makeSchema()], edges: [], loading: false })
  })

  it("throws with the server message on Response error", async () => {
    const errorResponse = new Response(
      JSON.stringify({ message: "Error: 'status' is a reserved system property and cannot be used as a schema attribute." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
    mockPut.mockRejectedValueOnce(errorResponse)

    const store = useSchemaStore.getState()
    await expect(store.updateSchema(makeSchema())).rejects.toThrow("Error: 'status' is a reserved")
  })

  it("throws a fallback message when error has no body", async () => {
    mockPut.mockRejectedValueOnce(new Error("network error"))

    const store = useSchemaStore.getState()
    await expect(store.updateSchema(makeSchema())).rejects.toThrow("Failed to save schema")
  })

  it("resolves without throwing on success", async () => {
    mockPut.mockResolvedValueOnce({})
    const store = useSchemaStore.getState()
    await expect(store.updateSchema(makeSchema())).resolves.toBeUndefined()
  })
})

describe("schema-store – addSchema", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSchemaStore.setState({ schemas: [], edges: [], loading: false })
  })

  it("throws with the server message on Response error", async () => {
    const errorResponse = new Response(
      JSON.stringify({ message: "Error: 'boost' is a reserved system property and cannot be used as a schema attribute." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
    mockPost.mockRejectedValueOnce(errorResponse)

    const store = useSchemaStore.getState()
    const schema = makeSchema({ ref_id: "new-1", type: "NewType1" })
    await expect(store.addSchema(schema)).rejects.toThrow("Error: 'boost' is a reserved")
  })

  it("rolls back optimistic add on error", async () => {
    mockPost.mockRejectedValueOnce(new Response("{}", { status: 400 }))

    useSchemaStore.setState({ schemas: [], edges: [], loading: false })
    const store = useSchemaStore.getState()
    const schema = makeSchema({ ref_id: "new-1", type: "NewType1" })

    await expect(store.addSchema(schema)).rejects.toThrow()
    expect(useSchemaStore.getState().schemas).toHaveLength(0)
  })

  it("throws a fallback message when error has no body", async () => {
    mockPost.mockRejectedValueOnce(new TypeError("fetch failed"))
    const store = useSchemaStore.getState()
    await expect(store.addSchema(makeSchema({ ref_id: "new-2" }))).rejects.toThrow("Failed to save schema")
  })
})
