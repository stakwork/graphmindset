"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useUserStore } from "@/stores/user-store"
import { AuthGuard } from "@/components/auth/auth-guard"

/**
 * Single admin guard for the whole `/admin/*` console. AuthGuard establishes
 * auth + the isAdmin flag for the section (on a direct load/refresh of an admin
 * route, not just when navigating in from `/`); the inner gate then redirects
 * non-admins to `/`.
 */
function AdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const isAuthenticated = useUserStore((s) => s.isAuthenticated)
  const isAdmin = useUserStore((s) => s.isAdmin)

  useEffect(() => {
    if (isAuthenticated && !isAdmin) router.replace("/")
  }, [isAdmin, isAuthenticated, router])

  if (isAuthenticated && !isAdmin) return null

  return <>{children}</>
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AdminGate>{children}</AdminGate>
    </AuthGuard>
  )
}
