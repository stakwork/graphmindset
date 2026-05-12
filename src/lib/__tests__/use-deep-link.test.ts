import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import React from "react"

// --- hoisted mocks ---
const { mockGetNode } = vi.hoisted(() => ({ mockGetNode: vi.fn() }))
vi.mock("@/lib/graph-api", () => ({
  getNode: (...args: unknown[]) => mockGetNode(...args),
}))

const { mockSetGraphData, mockSetSelectedNode } = vi.hoisted(() => ({
  mockSetGraphData: vi.fn(),
  mockSetSelectedNode: vi.fn(),
}))
vi.mock("@/stores/graph-store", () => ({
  useGraphStore: vi.fn(),
  // static .getState() used inside the hook
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
    expect(mockGetNode).not.toHaveBeenCalled()
    expect(mockSetGraphData).not.toHaveBeenCalled()
    expect(mockSetSelectedNode).not.toHaveBeenCalled()
  })

  it("no-ops when ?id param is empty string", async () => {
    currentId = ""
    renderHook(() => useDeepLink())
    await vi.waitFor(() => {})
    expect(mockGetNode).not.toHaveBeenCalled()
    expect(mockSetGraphData).not.toHaveBeenCalled()
    expect(mockSetSelectedNode).not.toHaveBeenCalled()
  })

  it("calls setGraphData and setSelectedNode on successful fetch", async () => {
    currentId = "node-123"
    const fakeNode = { ref_id: "node-123", node_type: "Topic", properties: { name: "Test" } }
    mockGetNode.mockResolvedValue(fakeNode)

    renderHook(() => useDeepLink())

    await vi.waitFor(() => {
      expect(mockSetGraphData).toHaveBeenCalledWith([fakeNode], [])
      expect(mockSetSelectedNode).toHaveBeenCalledWith(fakeNode)
    })
  })

  it("silently no-ops when getNode throws (invalid ref_id)", async () => {
    currentId = "invalid-ref"
    mockGetNode.mockRejectedValue(new Error("404 Not Found"))

    renderHook(() => useDeepLink())

    await vi.waitFor(() => {
      expect(mockGetNode).toHaveBeenCalledWith("invalid-ref", undefined, expect.any(AbortSignal))
    })
    expect(mockSetGraphData).not.toHaveBeenCalled()
    expect(mockSetSelectedNode).not.toHaveBeenCalled()
  })

  it("no-ops when getNode returns null", async () => {
    currentId = "node-null"
    mockGetNode.mockResolvedValue(null)

    renderHook(() => useDeepLink())

    await vi.waitFor(() => {
      expect(mockGetNode).toHaveBeenCalled()
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
    expect(mockGetNode).not.toHaveBeenCalled()
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
