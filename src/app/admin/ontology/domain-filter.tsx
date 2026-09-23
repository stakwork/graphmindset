"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, ListFilter } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import type { SchemaDomainOption } from "@/lib/schema-domains"

interface Props {
  domains: SchemaDomainOption[]
  /** Domain keys currently hidden from the graph. */
  disabled: ReadonlySet<string>
  onToggle: (key: string) => void
  onAll: () => void
  onNone: () => void
}

// Collapsible "Domains" strip in the ontology sidebar: one checkbox per domain
// (with its type count) plus All / None shortcuts. Collapsed by default; the
// header keeps showing "enabled/total" so an active filter stays visible
// across reloads.
export function DomainFilter({ domains, disabled, onToggle, onAll, onNone }: Props) {
  const [open, setOpen] = useState(false)
  if (domains.length === 0) return null

  const enabledCount = domains.filter((d) => !disabled.has(d.key)).length
  const filtering = enabledCount < domains.length

  return (
    <div className="relative z-10 border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ListFilter className={`h-3.5 w-3.5 shrink-0 ${filtering ? "text-primary" : ""}`} />
        <span className="flex-1 text-left">Domains</span>
        <span className={`font-mono text-[10px] ${filtering ? "text-primary" : "text-muted-foreground/60"}`}>
          {enabledCount}/{domains.length}
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-2 pb-2">
          <div className="flex items-center justify-end gap-1 px-1 pb-1 text-[10px] text-muted-foreground">
            <button
              type="button"
              onClick={onAll}
              disabled={!filtering}
              className="rounded px-1 hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
            >
              All
            </button>
            <span className="text-muted-foreground/40">·</span>
            <button
              type="button"
              onClick={onNone}
              disabled={enabledCount === 0}
              className="rounded px-1 hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
            >
              None
            </button>
          </div>
          <div className="space-y-0.5">
            {domains.map((d) => {
              const enabled = !disabled.has(d.key)
              return (
                <label
                  key={d.key}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted/50 ${
                    enabled ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <Checkbox
                    checked={enabled}
                    onChange={() => onToggle(d.key)}
                    ariaLabel={`Show ${d.label} types`}
                    className="h-3.5 w-3.5"
                  />
                  <span className="min-w-0 flex-1 truncate">{d.label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/60">{d.count}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
