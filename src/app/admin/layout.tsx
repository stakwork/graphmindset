"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useUserStore } from "@/stores/user-store"

/**
 * Single admin guard for the whole `/admin/*` console. Replaces the per-page
 * redirects that previously lived in settings/ontology/domains/reviews. Auth
 * itself is established at the app root by AuthGuard; here we only gate on the
 * resolved isAdmin flag.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const isAuthenticated = useUserStore((s) => s.isAuthenticated)
  const isAdmin = useUserStore((s) => s.isAdmin)

  useEffect(() => {
    if (isAuthenticated && !isAdmin) router.replace("/")
  }, [isAdmin, isAuthenticated, router])

  if (isAuthenticated && !isAdmin) return null

  return <>{children}</>
}
