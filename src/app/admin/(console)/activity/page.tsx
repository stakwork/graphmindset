"use client"

import dynamic from "next/dynamic"

const ActivitySettings = dynamic(
  () => import("@/components/admin/activity-settings").then((m) => m.ActivitySettings),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> }
)

export default function ActivityPage() {
  return <ActivitySettings open />
}
