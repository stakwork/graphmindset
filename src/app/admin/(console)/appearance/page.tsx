"use client"

import dynamic from "next/dynamic"

const AppearanceSettings = dynamic(
  () => import("@/components/admin/appearance-settings").then((m) => m.AppearanceSettings),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> }
)

export default function AppearancePage() {
  return <AppearanceSettings open />
}
