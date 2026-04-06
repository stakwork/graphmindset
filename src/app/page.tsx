"use client"

import { AuthGuard } from "@/components/auth/auth-guard"
import { AppLayout } from "@/components/layout/app-layout"

export default function Home() {
  return (
    <AuthGuard>
      <AppLayout />
    </AuthGuard>
  )
}
