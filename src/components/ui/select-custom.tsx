"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { ChevronDown, Check, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { AnchoredPopover } from "@/components/ui/anchored-popover"

interface Option {
  value: string
  label: string
}

interface SelectCustomProps {
  value: string
  onChange: (value: string) => void
  options: Option[]
  placeholder?: string
  className?: string
  compact?: boolean
  // When true, a filter input is pinned at the top of the open dropdown and
  // narrows the options by label. Off by default — existing call sites are
  // unaffected.
  searchable?: boolean
}

export function SelectCustom({
  value,
  onChange,
  options,
  placeholder,
  className,
  compact = false,
  searchable = false,
}: SelectCustomProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.value === value)

  const filtered = useMemo(() => {
    if (!searchable) return options
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query, searchable])

  // Focus the filter input when the dropdown opens (DOM sync only — the query
  // itself is reset in the open handler to avoid setState-in-effect).
  useEffect(() => {
    if (open && searchable) {
      const id = requestAnimationFrame(() => searchRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [open, searchable])

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => {
          const next = !open
          if (next) setQuery("")
          setOpen(next)
        }}
        className={cn(
          "flex w-full items-center justify-between rounded-md border border-border/50 bg-muted/50 text-sm text-foreground",
          "hover:border-border focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20",
          compact ? "h-6 px-2 text-[10px] font-mono" : "h-8 px-2.5"
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder ?? "Select..."}
        </span>
        <ChevronDown
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            compact ? "h-3 w-3 ml-1" : "h-3.5 w-3.5 ml-2",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Rendered in a portal so it floats above (and is never clipped by) any
          scroll container such as a modal body. */}
      <AnchoredPopover
        anchorRef={ref}
        open={open}
        onClose={() => setOpen(false)}
        className="min-w-[120px] rounded-lg border border-border/50 bg-popover py-1 shadow-lg shadow-black/20"
      >
        {searchable && (
          <div className="relative shrink-0 px-1.5 pb-1">
            <Search className="absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="h-7 w-full rounded-md border border-border/50 bg-muted/40 pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-2.5 py-1.5 text-xs text-muted-foreground">No matches</div>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 text-left text-sm transition-colors",
                  compact ? "py-1 text-[10px] font-mono" : "py-1.5",
                  opt.value === value
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted/50"
                )}
              >
                <Check
                  className={cn(
                    "h-3 w-3 shrink-0",
                    opt.value === value ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="truncate">{opt.label}</span>
              </button>
            ))
          )}
        </div>
      </AnchoredPopover>
    </div>
  )
}
