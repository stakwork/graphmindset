"use client"

import dynamic from "next/dynamic"

const RadarSettings = dynamic(
  () => import("@/components/modals/radar-settings").then((m) => m.RadarSettings),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> }
)

export default function SchedulePage() {
  return <RadarSettings open />
}
