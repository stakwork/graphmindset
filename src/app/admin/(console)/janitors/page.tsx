"use client"

import dynamic from "next/dynamic"

const JanitorSettings = dynamic(
  () => import("@/components/modals/janitor-settings").then((m) => m.JanitorSettings),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> }
)

export default function JanitorsPage() {
  return <JanitorSettings open />
}
