/**
 * Tests for src/app/admin/layout.tsx — the single admin guard for /admin/*.
 *
 * Covers:
 * - Authenticated non-admin is redirected to "/"
 * - Authenticated non-admin renders no children
 * - Admin renders children, no redirect
 * - Unauthenticated (auth not yet resolved) renders children, no redirect
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

const userState = { isAuthenticated: false, isAdmin: false }
vi.mock("@/stores/user-store", () => ({
  useUserStore: (sel?: (s: unknown) => unknown) => (sel ? sel(userState) : userState),
}))

const mockReplace = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

async function renderLayout() {
  const { default: AdminLayout } = await import("@/app/admin/layout")
  return render(
    <AdminLayout>
      <div data-testid="admin-child">Admin content</div>
    </AdminLayout>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  userState.isAuthenticated = false
  userState.isAdmin = false
})

describe("AdminLayout guard", () => {
  it("redirects authenticated non-admin to /", async () => {
    userState.isAuthenticated = true
    userState.isAdmin = false
    await renderLayout()
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"))
  })

  it("renders no children for authenticated non-admin", async () => {
    userState.isAuthenticated = true
    userState.isAdmin = false
    await renderLayout()
    expect(screen.queryByTestId("admin-child")).not.toBeInTheDocument()
  })

  it("renders children and does not redirect for admins", async () => {
    userState.isAuthenticated = true
    userState.isAdmin = true
    await renderLayout()
    expect(screen.getByTestId("admin-child")).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("renders children and does not redirect before auth resolves", async () => {
    userState.isAuthenticated = false
    userState.isAdmin = false
    await renderLayout()
    expect(screen.getByTestId("admin-child")).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
