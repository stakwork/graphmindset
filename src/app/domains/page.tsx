"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Plus, Search, Boxes, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MultiSelectCustom } from "@/components/ui/multi-select-custom"
import { DomainPanel, type DomainRow } from "./domain-panel"
import type { SchemaNode } from "@/app/ontology/page"
import { useSchemaStore } from "@/stores/schema-store"
import { useUserStore } from "@/stores/user-store"
import { useAppStore } from "@/stores/app-store"
import { isMocksEnabled, MOCK_DOMAINS } from "@/lib/mock-data"
import { SMALL_SCHEMAS, SMALL_EDGES } from "@/app/ontology/mock-small"
import {
  getSchemaDomains,
  updateHiddenLists,
  relabelDomain,
  type SchemaDomainsResponse,
} from "@/lib/graph-api"
import { MAX_LENGTHS } from "@/lib/input-limits"

const DEFAULT_DOMAIN = "entity"

/** The domain a schema type belongs to (lowercased; defaults to "entity"). */
function domainKeyOf(s: SchemaNode): string {
  return (s.domain || DEFAULT_DOMAIN).toLowerCase()
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

export default function DomainsPage() {
  const router = useRouter()
  const isAdmin = useUserStore((s) => s.isAdmin)
  const isAuthenticated = useUserStore((s) => s.isAuthenticated)
  const store = useSchemaStore()
  const { graphName, graphDescription } = useAppStore()

  const [domainsInfo, setDomainsInfo] = useState<SchemaDomainsResponse | null>(null)
  const [loadingDomains, setLoadingDomains] = useState(true)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Create flow
  const [creating, setCreating] = useState(false)
  const [createName, setCreateName] = useState("")
  const [createTypes, setCreateTypes] = useState<string[]>([])

  useEffect(() => {
    if (isAuthenticated && !isAdmin) router.replace("/")
  }, [isAdmin, isAuthenticated, router])

  const reloadDomains = useCallback(async () => {
    setLoadingDomains(true)
    try {
      setDomainsInfo(isMocksEnabled() ? MOCK_DOMAINS : await getSchemaDomains())
    } catch {
      // keep last good list
    } finally {
      setLoadingDomains(false)
    }
  }, [])

  useEffect(() => {
    if (isMocksEnabled()) {
      store.setSchemas(SMALL_SCHEMAS)
      store.setEdges(SMALL_EDGES)
    } else {
      store.fetchAll()
    }
    reloadDomains()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Group node types by their `domain`, merged with the authoritative
  // /v2/schema/domains list (so empty/known domains still appear).
  const rows = useMemo<DomainRow[]>(() => {
    const hidden = new Set(
      (domainsInfo?.hidden_domains ?? []).map((d) => d.toLowerCase())
    )
    const membersByKey = new Map<string, SchemaNode[]>()
    const labelByKey = new Map<string, string>()

    for (const s of store.schemas) {
      if (!s.type || s.type === "Thing") continue
      const key = domainKeyOf(s)
      const arr = membersByKey.get(key) ?? []
      arr.push(s)
      membersByKey.set(key, arr)
      if (!labelByKey.has(key) && s.domain) labelByKey.set(key, s.domain)
    }

    const keys = new Set<string>(membersByKey.keys())
    for (const d of domainsInfo?.domains ?? []) keys.add(d.toLowerCase())

    return Array.from(keys)
      .map((key) => ({
        key,
        label: labelByKey.get(key) ?? capitalize(key),
        members: (membersByKey.get(key) ?? []).sort((a, b) =>
          a.type.localeCompare(b.type)
        ),
        hidden: hidden.has(key),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [store.schemas, domainsInfo])

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? rows.filter((r) => r.key.includes(q) || r.label.toLowerCase().includes(q)) : rows
  }, [rows, search])

  const selectedRow = useMemo(
    () => rows.find((r) => r.key === selectedKey) ?? null,
    [rows, selectedKey]
  )

  // --- Write helpers ------------------------------------------------------

  // Reassign a set of types to `domainValue` (PUT /schema each), then relabel
  // existing nodes in the background.
  const assignTypesToDomain = useCallback(
    async (typeNames: string[], domainValue: string) => {
      const targets = store.schemas.filter((s) => typeNames.includes(s.type))
      if (targets.length === 0) return
      setBusy(true)
      setError(null)
      try {
        for (const s of targets) {
          await store.updateSchema({ ...s, domain: domainValue })
        }
        await relabelDomain(targets.map((s) => s.type)).catch(() => {})
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update domain")
      } finally {
        setBusy(false)
      }
    },
    [store]
  )

  const handleRename = useCallback(
    async (row: DomainRow, newName: string) => {
      await assignTypesToDomain(
        row.members.map((m) => m.type),
        newName
      )
      setSelectedKey(newName.trim().toLowerCase())
      reloadDomains()
    },
    [assignTypesToDomain, reloadDomains]
  )

  const handleAddTypes = useCallback(
    async (row: DomainRow, typeNames: string[]) => {
      await assignTypesToDomain(typeNames, row.label)
      reloadDomains()
    },
    [assignTypesToDomain, reloadDomains]
  )

  const handleRemoveType = useCallback(
    async (typeName: string) => {
      await assignTypesToDomain([typeName], DEFAULT_DOMAIN)
      reloadDomains()
    },
    [assignTypesToDomain, reloadDomains]
  )

  const handleToggleHidden = useCallback(
    async (row: DomainRow, hidden: boolean) => {
      const current = new Set(
        (domainsInfo?.hidden_domains ?? []).map((d) => d.toLowerCase())
      )
      if (hidden) current.add(row.key)
      else current.delete(row.key)
      const next = Array.from(current).sort()
      setBusy(true)
      setError(null)
      try {
        if (!isMocksEnabled()) {
          await updateHiddenLists(graphName, graphDescription, undefined, next)
        }
        setDomainsInfo((prev) =>
          prev ? { ...prev, hidden_domains: next } : prev
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update visibility")
      } finally {
        setBusy(false)
      }
    },
    [domainsInfo, graphName, graphDescription]
  )

  const handleDelete = useCallback(
    async (row: DomainRow) => {
      // Empty domains are derived away on reload; just clean up a stale hidden entry.
      if (row.hidden) await handleToggleHidden(row, false)
      setSelectedKey(null)
      reloadDomains()
    },
    [handleToggleHidden, reloadDomains]
  )

  const submitCreate = useCallback(async () => {
    const name = createName.trim()
    if (!name || createTypes.length === 0) return
    await assignTypesToDomain(createTypes, name)
    setCreating(false)
    setCreateName("")
    setCreateTypes([])
    setSelectedKey(name.toLowerCase())
    reloadDomains()
  }, [createName, createTypes, assignTypesToDomain, reloadDomains])

  const openCreate = useCallback(() => {
    setSelectedKey(null)
    setCreating(true)
    setCreateName("")
    setCreateTypes([])
    setError(null)
  }, [])

  const allTypeOptions = useMemo(
    () =>
      store.schemas
        .filter((s) => s.type && s.type !== "Thing")
        .sort((a, b) => a.type.localeCompare(b.type))
        .map((s) => ({
          value: s.type,
          label: s.type,
          hint: s.domain ? s.domain.toLowerCase() : undefined,
        })),
    [store.schemas]
  )

  if (isAuthenticated && !isAdmin) return null

  const loading = loadingDomains && store.loading

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Left: Domain list */}
      <div className="w-[280px] shrink-0 border-r border-border flex flex-col bg-sidebar noise-bg">
        <div className="relative z-10 flex items-center gap-2 p-4 border-b border-border">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => router.push("/")}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-sm font-heading font-semibold tracking-wide uppercase flex-1">
            Domains
          </h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={openCreate}
            className="h-7 w-7 p-0"
            title="New domain"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="relative z-10 p-2 border-b border-border">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search domains..."
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>
        <div className="relative z-10 flex-1 overflow-y-auto p-2 space-y-1">
          {loading && visibleRows.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>
          )}
          {!loading && visibleRows.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {search ? `No domains match “${search}”` : "No domains yet."}
            </p>
          )}
          {visibleRows.map((row) => (
            <button
              key={row.key}
              onClick={() => {
                setCreating(false)
                setSelectedKey(row.key)
              }}
              className={`flex items-center gap-3 w-full rounded-md px-3 py-2 text-left transition-colors ${
                selectedKey === row.key && !creating
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <Boxes className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate flex items-center gap-1.5">
                  {row.label}
                  {row.hidden && (
                    <EyeOff className="h-3 w-3 text-amber-400/80 shrink-0" />
                  )}
                </p>
                <p className="text-[10px] font-mono text-muted-foreground truncate">
                  {row.key}
                </p>
              </div>
              <span className="ml-auto text-[10px] font-mono text-muted-foreground/60 shrink-0">
                {row.members.length} {row.members.length === 1 ? "type" : "types"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Right: panel / create / empty state */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {creating ? (
          <div className="flex justify-center p-6">
            <div className="flex w-full max-w-xl flex-col gap-4 rounded-lg border border-border bg-card p-5">
              <div>
                <h3 className="text-sm font-heading font-semibold">New domain</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Name the domain and assign at least one node type — a domain only
                  exists while a type belongs to it.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
                  Domain Name
                </Label>
                <Input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Social"
                  maxLength={MAX_LENGTHS.SCHEMA_TYPE_NAME}
                  className="h-8 text-sm bg-muted/50 border-border/50"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider font-heading text-muted-foreground">
                  Member node types
                </Label>
                <MultiSelectCustom
                  value={createTypes}
                  onChange={setCreateTypes}
                  options={allTypeOptions}
                  placeholder="Pick node types…"
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setCreating(false)}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={submitCreate}
                  disabled={!createName.trim() || createTypes.length === 0 || busy}
                  className="text-xs"
                >
                  Create domain
                </Button>
              </div>
            </div>
          </div>
        ) : selectedRow ? (
          <div className="flex justify-center p-6">
            <DomainPanel
              domain={selectedRow}
              allTypes={store.schemas}
              onRename={(name) => handleRename(selectedRow, name)}
              onAddTypes={(types) => handleAddTypes(selectedRow, types)}
              onRemoveType={handleRemoveType}
              onToggleHidden={(hidden) => handleToggleHidden(selectedRow, hidden)}
              onDelete={() => handleDelete(selectedRow)}
              onClose={() => setSelectedKey(null)}
              busy={busy}
              error={error ?? undefined}
            />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/40">
              <Boxes className="h-7 w-7 text-muted-foreground" />
            </div>
            <div className="space-y-1.5 max-w-sm">
              <h3 className="text-sm font-heading font-semibold">
                Domains organize your graph
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                A domain is a category that groups many node types (e.g. Content ⊇
                TwitterAccount, Tweet, Topic). Select a domain to manage its member
                types and visibility, or create a new one.
              </p>
            </div>
            <Button size="sm" onClick={openCreate} className="text-xs">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New domain
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
