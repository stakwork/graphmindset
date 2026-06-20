"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { type AuditCategory, type AuditEntry, type SchemaAuditData, getSchemaAudit } from "@/lib/graph-api"
import { isMocksEnabled, MOCK_SCHEMA_AUDIT } from "@/lib/mock-data"

// ── Badge config ───────────────────────────────────────────────────────────────

const CATEGORY_CONFIG = {
  healthy: {
    label: "✓ Healthy",
    className: "bg-green-500/15 text-green-400 border border-green-500/30",
  },
  orphaned: {
    label: "✕ Orphaned",
    className: "bg-red-500/15 text-red-400 border border-red-500/30",
  },
  unused: {
    label: "◌ Unused",
    className: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  },
} as const

// ── Sub-components ─────────────────────────────────────────────────────────────

function AuditEntryRow({ entry, badgeClass }: { entry: AuditEntry; badgeClass: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-sm text-foreground">{entry.name}</span>
      <span
        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono tabular-nums ${badgeClass}`}
      >
        {entry.count}
      </span>
    </div>
  )
}

function CategoryGroup({
  category,
  entries,
}: {
  category: keyof typeof CATEGORY_CONFIG
  entries: AuditEntry[]
}) {
  const config = CATEGORY_CONFIG[category]

  if (entries.length === 0) {
    return (
      <div className="space-y-1">
        <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${config.className}`}>
          {config.label}
        </span>
        <p className="text-xs text-muted-foreground pl-1">—</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${config.className}`}>
        {config.label}
      </span>
      <div className="pl-1">
        {entries.map((entry) => (
          <AuditEntryRow key={entry.name} entry={entry} badgeClass={config.className} />
        ))}
      </div>
    </div>
  )
}

function AuditSection({
  title,
  category,
}: {
  title: string
  category: AuditCategory
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
      <h3 className="text-xs font-heading font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <CategoryGroup category="healthy" entries={category.healthy} />
      <CategoryGroup category="orphaned" entries={category.orphaned} />
      <CategoryGroup category="unused" entries={category.unused} />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SchemaAuditSettings({ open }: { open: boolean }) {
  const [data, setData] = useState<SchemaAuditData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (isMocksEnabled()) {
        setData(MOCK_SCHEMA_AUDIT)
        return
      }
      const result = await getSchemaAudit()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit data")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  if (loading && !data) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  if (error && !data) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="ghost" size="sm" onClick={load}>
          Retry
        </Button>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Live Neo4j database vs schema definitions. Counts are namespace-scoped.
        </p>
        <Button variant="ghost" size="sm" onClick={load}>
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <AuditSection title="Node Labels" category={data.node_labels} />
        <AuditSection title="Relationship Types" category={data.relationship_types} />
      </div>
    </div>
  )
}
