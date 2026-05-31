import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { AuthGuard } from "@/components/auth/auth-guard"

// Mock modules that have side effects or browser APIs
vi.mock("@/lib/sphinx", () => ({
  enable: vi.fn().mockResolvedValue({ pubkey: "test-pubkey" }),
  isAndroid: vi.fn().mockReturnValue(false),
  getL402: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: vi.fn().mockReturnValue(false),
}))

const mockSetIsAdmin = vi.fn()
const mockSetIsAuthenticated = vi.fn()
const mockSetBudget = vi.fn()
const mockSetPubKey = vi.fn()
const mockSetRouteHint = vi.fn()

vi.mock("@/stores/user-store", () => ({
  useUserStore: vi.fn(() => ({
    setBudget: mockSetBudget,
    setIsAdmin: mockSetIsAdmin,
    setPubKey: mockSetPubKey,
    setRouteHint: mockSetRouteHint,
    setIsAuthenticated: mockSetIsAuthenticated,
  })),
}))

const mockSetGraphMeta = vi.fn()
vi.mock("@/stores/app-store", () => ({
  useAppStore: vi.fn(() => mockSetGraphMeta),
}))

const mockApiGet = vi.fn()
vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}))

describe("AuthGuard – handleIsAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: /about succeeds
    mockApiGet.mockImplementation((path: string) => {
      if (path === "/about") return Promise.resolve({ title: "Test Graph", description: "" })
      return Promise.resolve({ data: { isPublic: true, isAdmin: false, isMember: false } })
    })
  })

  it("shows overlay when /isAdmin returns 401", async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === "/about") return Promise.resolve({ title: "Test", description: "" })
      if (path === "/isAdmin") return Promise.reject(new Response(null, { status: 401 }))
      return Promise.resolve({})
    })

    render(<AuthGuard><div>App Content</div></AuthGuard>)

    await waitFor(() => {
      expect(screen.getByText("Members Only")).toBeInTheDocument()
    })
    expect(screen.queryByText("App Content")).not.toBeInTheDocument()
    expect(mockSetIsAuthenticated).not.toHaveBeenCalledWith(true)
  })

  it("shows overlay when isPublic=false, isAdmin=false, isMember=false", async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === "/about") return Promise.resolve({ title: "Test", description: "" })
      if (path === "/isAdmin") return Promise.resolve({ data: { isPublic: false, isAdmin: false, isMember: false } })
      return Promise.resolve({})
    })

    render(<AuthGuard><div>App Content</div></AuthGuard>)

    await waitFor(() => {
      expect(screen.getByText("Members Only")).toBeInTheDocument()
    })
    expect(screen.queryByText("App Content")).not.toBeInTheDocument()
  })

  it("renders app when isPublic=false but isAdmin=true", async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === "/about") return Promise.resolve({ title: "Test", description: "" })
      if (path === "/isAdmin") return Promise.resolve({ data: { isPublic: false, isAdmin: true, isMember: false } })
      return Promise.resolve({})
    })

    render(<AuthGuard><div>App Content</div></AuthGuard>)

    await waitFor(() => {
      expect(screen.getByText("App Content")).toBeInTheDocument()
    })
    expect(screen.queryByText("Members Only")).not.toBeInTheDocument()
  })

  it("renders app when isPublic=false but isMember=true", async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === "/about") return Promise.resolve({ title: "Test", description: "" })
      if (path === "/isAdmin") return Promise.resolve({ data: { isPublic: false, isAdmin: false, isMember: true } })
      return Promise.resolve({})
    })

    render(<AuthGuard><div>App Content</div></AuthGuard>)

    await waitFor(() => {
      expect(screen.getByText("App Content")).toBeInTheDocument()
    })
    expect(screen.queryByText("Members Only")).not.toBeInTheDocument()
  })

  it("renders app when isPublic=true and isAdmin=false", async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === "/about") return Promise.resolve({ title: "Test", description: "" })
      if (path === "/isAdmin") return Promise.resolve({ data: { isPublic: true, isAdmin: false, isMember: false } })
      return Promise.resolve({})
    })

    render(<AuthGuard><div>App Content</div></AuthGuard>)

    await waitFor(() => {
      expect(screen.getByText("App Content")).toBeInTheDocument()
    })
    expect(screen.queryByText("Members Only")).not.toBeInTheDocument()
  })

  it("fails open on network/500 errors (no overlay)", async () => {
    mockApiGet.mockImplementation((path: string) => {
      if (path === "/about") return Promise.resolve({ title: "Test", description: "" })
      if (path === "/isAdmin") return Promise.reject(new Error("Network error"))
      return Promise.resolve({})
    })

    render(<AuthGuard><div>App Content</div></AuthGuard>)

    await waitFor(() => {
      expect(screen.getByText("App Content")).toBeInTheDocument()
    })
    expect(screen.queryByText("Members Only")).not.toBeInTheDocument()
    expect(mockSetIsAuthenticated).toHaveBeenCalledWith(true)
  })
})
