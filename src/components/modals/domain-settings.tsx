"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"
import { getSchemaDomains, updateHiddenLists } from "@/lib/graph-api"
import { isMocksEnabled, MOCK_DOMAINS } from "@/lib/mock-data"
import { useSchemaStore } from "@/stores/schema-store"
import { useAppStore } from "@/stores/app-store"
import { cn } from "@/lib/utils"

interface DomainSettingsProps {
  open: boolean
  /** Parent modal's pending title — used when saving hidden_types */
  title: string
  /** Parent modal's pending description — used when saving hidden_types */
  description: string
}

export function DomainSettings({ open, title, description }: DomainSettingsProps) {
  const schemas = useSchemaStore((s) => s.schemas)
  const fetchSchemas = useSchemaStore((s) => s.fetchAll)
  const setGraphMeta = useAppStore((s) => s.setGraphMeta)

  const [availableDomains, setAvailableDomains] = useState<string[]>([])
  const [hiddenSet, setHiddenSet] = useState<Set<string>>(new Set())
  const [originalHidden, setOriginalHidden] = useState<Set<string>>(new Set())
  const [hiddenDomainSet, setHiddenDomainSet] = useState<Set<string>>(new Set())
  const [originalHiddenDomains, setOriginalHiddenDomains] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [filter, setFilter] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (isMocksEnabled()) {
        setAvailableDomains(MOCK_DOMAINS.domains)
        const hiddenTypes = new Set(MOCK_DOMAINS.hidden_types)
        const hiddenDomains = new Set(MOCK_DOMAINS.hidden_domains)
        setHiddenSet(new Set(hiddenTypes))
        setOriginalHidden(new Set(hiddenTypes))
        setHiddenDomainSet(new Set(hiddenDomains))
        setOriginalHiddenDomains(new Set(hiddenDomains))
      } else {
        const res = await getSchemaDomains()
        setAvailableDomains(res.domains ?? [])
        const hiddenTypes = new Set(res.hidden_types ?? [])
        const hiddenDomains = new Set(res.hidden_domains ?? [])
        setHiddenSet(new Set(hiddenTypes))
        setOriginalHidden(new Set(hiddenTypes))
        setHiddenDomainSet(new Set(hiddenDomains))
        setOriginalHiddenDomains(new Set(hiddenDomains))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load domains")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    load()
    if (schemas.length === 0) fetchSchemas()
  }, [open, load, schemas.length, fetchSchemas])

  // Hideable types = everything except the root "Thing"
  const hideableTypes = useMemo(() => {
    return schemas
      .filter((s) => s.type && s.type !== "Thing")
      .map((s) => ({ type: s.type, parent: s.parent }))
      .sort((a, b) => a.type.localeCompare(b.type))
  }, [schemas])

  const filteredTypes = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return hideableTypes
    return hideableTypes.filter((t) => t.type.toLowerCase().includes(q))
  }, [hideableTypes, filter])

  const toggleType = (type: string) => {
    setHiddenSet((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
    setSavedMessage(null)
  }

  const toggleDomain = (domain: string) => {
    setHiddenDomainSet((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      return next
    })
    setSavedMessage(null)
  }

  const setsEqual = (a: Set<string>, b: Set<string>) => {
    if (a.size !== b.size) return false
    for (const x of a) if (!b.has(x)) return false
    return true
  }

  const typesDirty = useMemo(
    () => !setsEqual(hiddenSet, originalHidden),
    [hiddenSet, originalHidden]
  )
  const domainsDirty = useMemo(
    () => !setsEqual(hiddenDomainSet, originalHiddenDomains),
    [hiddenDomainSet, originalHiddenDomains]
  )
  const dirty = typesDirty || domainsDirty

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    setSavedMessage(null)
    const nextTypes = Array.from(hiddenSet).sort()
    const nextDomains = Array.from(hiddenDomainSet).sort()
    try {
      if (!isMocksEnabled()) {
        await updateHiddenLists(
          title,
          description,
          typesDirty ? nextTypes : undefined,
          domainsDirty ? nextDomains : undefined,
        )
      }
      setGraphMeta(title, description)
      setOriginalHidden(new Set(nextTypes))
      setOriginalHiddenDomains(new Set(nextDomains))
      const relabel = typesDirty || domainsDirty
      setSavedMessage(
        relabel
          ? "Saved — nodes are being relabeled in the background."
          : "Saved."
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }, [hiddenSet, hiddenDomainSet, typesDirty, domainsDirty, title, description, setGraphMeta])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-destructive">{error}</p>
        <Button size="sm" variant="outline" onClick={load}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] uppercase tracking-wider font-heading text-muted-foreground">
            Available domains
          </p>
          <p className="text-[10px] text-muted-foreground">
            {hiddenDomainSet.size} hidden
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Click a domain to hide/show it. Hidden domains (and their descendants)
          are excluded from search.
        </p>
        {availableDomains.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No domain roots found. Add a schema type as a child of <code>Thing</code> to define one.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {availableDomains.map((d) => {
              const hidden = hiddenDomainSet.has(d)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDomain(d)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-mono transition-colors cursor-pointer",
                    hidden
                      ? "border-amber-400/40 bg-amber-400/10 text-amber-200/90 hover:bg-amber-400/20"
                      : "border-border/50 bg-muted/30 text-foreground hover:bg-muted/50"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      hidden ? "bg-amber-400/70" : "bg-primary/70"
                    )}
                  />
                  {d}
                  {hidden && (
                    <span className="text-[9px] uppercase tracking-wider text-amber-400/80">
                      hidden
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] uppercase tracking-wider font-heading text-muted-foreground">
            Hide schema types
          </p>
          <p className="text-[10px] text-muted-foreground">
            {hiddenSet.size} hidden
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Hidden types (and their descendants) are excluded from domain search
          indexes. Existing nodes are re-labeled in the background after save.
        </p>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter types..."
            className="h-8 pl-8 text-xs bg-muted/30 border-border/40"
          />
        </div>

        {hideableTypes.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No schema types to hide.
          </p>
        ) : filteredTypes.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No types match the filter.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-md border border-border/40 divide-y divide-border/30">
            {filteredTypes.map(({ type, parent }) => {
              const hidden = hiddenSet.has(type)
              return (
                <label
                  key={type}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors",
                    hidden ? "bg-muted/30" : "hover:bg-muted/20"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={hidden}
                    onChange={() => toggleType(type)}
                    className="h-3.5 w-3.5 shrink-0 rounded border-border text-primary focus:ring-primary/40"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-xs truncate", hidden ? "text-foreground" : "text-foreground/90")}>
                      {type}
                    </p>
                    {parent && (
                      <p className="text-[10px] font-mono text-muted-foreground/70 truncate">
                        ↳ {parent}
                      </p>
                    )}
                  </div>
                  {hidden && (
                    <span className="text-[9px] font-mono uppercase tracking-wider text-amber-400/80 shrink-0">
                      hidden
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        )}
      </div>

      {savedMessage && (
        <p className="text-[11px] text-emerald-400">{savedMessage}</p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setHiddenSet(new Set(originalHidden))
            setHiddenDomainSet(new Set(originalHiddenDomains))
            setSavedMessage(null)
          }}
          disabled={!dirty || saving}
          className="text-xs"
        >
          Reset
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  )
}
