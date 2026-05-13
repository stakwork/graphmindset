import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"

// --- hoisted mocks ---
const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }))
vi.mock("@/lib/api", () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}))

const { mockSetGraphData, mockSetSelectedNode } = vi.hoisted(() => ({
  mockSetGraphData: vi.fn(),
  mockSetSelectedNode: vi.fn(),
}))
vi.mock("@/stores/graph-store", () => ({
  useGraphStore: vi.fn(),
}))

const { mockIsMocksEnabled, mockMOCK_FULL_NODES } = vi.hoisted(() => ({
  mockIsMocksEnabled: vi.fn(() => false),
  mockMOCK_FULL_NODES: {} as Record<string, { nodes: unknown[] }>,
}))
vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => mockIsMocksEnabled(),
  MOCK_FULL_NODES: mockMOCK_FULL_NODES,
}))

// searchParams state
let currentId: string | null = null
const mockGet = vi.fn((key: string) => (key === "id" ? currentId : null))
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: mockGet }),
}))

import { useDeepLink } from "@/hooks/use-deep-link"
import { useGraphStore } from "@/stores/graph-store"

// Wire up getState on the mock after import
const mockedUseGraphStore = vi.mocked(useGraphStore) as unknown as {
  getState: () => { setGraphData: typeof mockSetGraphData; setSelectedNode: typeof mockSetSelectedNode }
}

beforeEach(() => {
  vi.clearAllMocks()
  currentId = null
  mockedUseGraphStore.getState = () => ({
    setGraphData: mockSetGraphData,
    setSelectedNode: mockSetSelectedNode,
  })
  mockIsMocksEnabled.mockReturnValue(false)
})

describe("useDeepLink", () => {
  it("no-ops when ?id param is absent", async () => {
    currentId = null
    renderHook(() => useDeepLink())
    await vi.waitFor(() => {})
    expect(mockApiGet).not.toHaveBeenCalled()
    expect(mockSetGraphData).not.toHaveBeenCalled()
    expect(mockSetSelectedNode).not.toHaveBeenCalled()
  })

  it("no-ops when ?id param is empty string", async () => {
    currentId = ""
    renderHook(() => useDeepLink())
    await vi.waitFor(() => {})
    expect(mockApiGet).not.toHaveBeenCalled()
    expect(mockSetGraphData).not.toHaveBeenCalled()
    expect(mockSetSelectedNode).not.toHaveBeenCalled()
  })

  it("calls setGraphData and setSelectedNode with the node (not GraphData) on successful fetch", async () => {
    currentId = "node-123"
    const fakeNode = { ref_id: "node-123", node_type: "Topic", properties: { name: "Test" } }
    mockApiGet.mockResolvedValue({ nodes: [fakeNode], edges: [] })

    renderHook(() => useDeepLink())

    await vi.waitFor(() => {
      expect(mockSetGraphData).toHaveBeenCalledWith([fakeNode], [])
      expect(mockSetSelectedNode).toHaveBeenCalledWith(fakeNode)
    })
    // Confirm setGraphData receives GraphNode[], not GraphData[]
    const calledWith = mockSetGraphData.mock.calls[0][0]
    expect(Array.isArray(calledWith)).toBe(true)
    expect(calledWith[0]).not.toHaveProperty("edges")
    expect(calledWith[0]).toHaveProperty("ref_id", "node-123")
  })

  it("uses ?preview=1 in the API call", async () => {
    currentId = "node-abc"
    const fakeNode = { ref_id: "node-abc", node_type: "Topic", properties: { name: "ABC" } }
    mockApiGet.mockResolvedValue({ nodes: [fakeNode], edges: [] })

    renderHook(() => useDeepLink())

    await vi.waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        "/v2/nodes/node-abc?preview=1",
        undefined,
        expect.any(AbortSignal),
      )
    })
  })

  it("silently no-ops when api.get throws a non-402 error", async () => {
    currentId = "invalid-ref"
    mockApiGet.mockRejectedValue(new Error("404 Not Found"))

    renderHook(() => useDeepLink())

    await vi.waitFor(() => {
      expect(mockApiGet).toHaveBeenCalled()
    })
    expect(mockSetGraphData).not.toHaveBeenCalled()
    expect(mockSetSelectedNode).not.toHaveBeenCalled()
  })

  it("no-ops when api.get returns empty nodes array", async () => {
    currentId = "node-null"
    mockApiGet.mockResolvedValue({ nodes: [], edges: [] })

    renderHook(() => useDeepLink())

    await vi.waitFor(() => {
      expect(mockApiGet).toHaveBeenCalled()
    })
    expect(mockSetGraphData).not.toHaveBeenCalled()
    expect(mockSetSelectedNode).not.toHaveBeenCalled()
  })

  it("402 with node in body → opens node in locked state", async () => {
    currentId = "paid-node"
    const basicNode = { ref_id: "paid-node", node_type: "Topic", properties: { name: "Paid" } }
    const fakeResponse = {
      status: 402,
      json: vi.fn().mockResolvedValue({ price: 10, node: basicNode }),
    }
    mockApiGet.mockRejectedValue(fakeResponse)

    renderHook(() => useDeepLink())

    await vi.waitFor(() => {
      expect(mockSetGraphData).toHaveBeenCalledWith([basicNode], [])
      expect(mockSetSelectedNode).toHaveBeenCalledWith(basicNode)
    })
  })

  it("402 with node: null in body → store unchanged, app loads normally", async () => {
    currentId = "paid-node-null"
    const fakeResponse = {
      status: 402,
      json: vi.fn().mockResolvedValue({ price: 10, node: null }),
    }
    mockApiGet.mockRejectedValue(fakeResponse)

    renderHook(() => useDeepLink())

    await vi.waitFor(() => {
      expect(fakeResponse.json).toHaveBeenCalled()
    })
    expect(mockSetGraphData).not.toHaveBeenCalled()
    expect(mockSetSelectedNode).not.toHaveBeenCalled()
  })

  it("402 where err.json() throws → store unchanged, no crash", async () => {
    currentId = "paid-node-bad-body"
    const fakeResponse = {
      status: 402,
      json: vi.fn().mockRejectedValue(new Error("parse error")),
    }
    mockApiGet.mockRejectedValue(fakeResponse)

    renderHook(() => useDeepLink())

    await vi.waitFor(() => {
      expect(fakeResponse.json).toHaveBeenCalled()
    })
    expect(mockSetGraphData).not.toHaveBeenCalled()
    expect(mockSetSelectedNode).not.toHaveBeenCalled()
  })

  it("uses mock data when mocks are enabled", async () => {
    currentId = "mock-node-1"
    mockIsMocksEnabled.mockReturnValue(true)
    const fakeNode = { ref_id: "mock-node-1", node_type: "Topic", properties: { name: "Mock" } }
    mockMOCK_FULL_NODES["mock-node-1"] = { nodes: [fakeNode] }

    renderHook(() => useDeepLink())

    await vi.waitFor(() => {
      expect(mockSetGraphData).toHaveBeenCalledWith([fakeNode], [])
      expect(mockSetSelectedNode).toHaveBeenCalledWith(fakeNode)
    })
    expect(mockApiGet).not.toHaveBeenCalled()
  })

  it("no-ops in mock mode when refId not in MOCK_FULL_NODES", async () => {
    currentId = "nonexistent-mock"
    mockIsMocksEnabled.mockReturnValue(true)

    renderHook(() => useDeepLink())

    await vi.waitFor(() => {})
    expect(mockSetGraphData).not.toHaveBeenCalled()
    expect(mockSetSelectedNode).not.toHaveBeenCalled()
  })
})
