"use client"

import dynamic from "next/dynamic"

const SchemaAuditSettings = dynamic(
  () => import("@/components/admin/schema-audit").then((m) => m.SchemaAuditSettings),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> }
)

export default function AuditPage() {
  return <SchemaAuditSettings open />
}
