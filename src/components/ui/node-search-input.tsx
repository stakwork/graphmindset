"use client"

import { useState, useRef, useEffect } from "react"
import { X, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { displayNodeType } from "@/lib/utils"
import { resolveNodeTitle } from "@/lib/node-display"
import { searchNodesForEdge, type GraphNode } from "@/lib/graph-api"
import { useDebounce } from "@/hooks/use-debounce"
import { useSchemaStore } from "@/stores/schema-store"
import { AnchoredPopover } from "@/components/ui/anchored-popover"

interface NodeSearchInputProps {
  value: GraphNode | null
  onChange: (node: GraphNode | null) => void
  placeholder?: string
  disabled?: boolean
}

export function NodeSearchInput({
  value,
  onChange,
  placeholder = "Search nodes…",
  disabled = false,
}: NodeSearchInputProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<GraphNode[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [fetched, setFetched] = useState(false)
  const schemas = useSchemaStore((s) => s.schemas)

  const containerRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const debouncedQuery = useDebounce(query, 300)

  // Outside-click is handled by AnchoredPopover (which knows about the portal),
  // so no separate listener is needed here.

  // Debounced search
  useEffect(() => {
    if (value !== null) return // don't search in selected state

    if (debouncedQuery.trim() === "") {
      // Sync the result list with the (debounced, async) search query — clearing
      // when the query empties is the resting state, not a cascading render.
      /* eslint-disable react-hooks/set-state-in-effect */
      setResults([])
      setFetched(false)
      setOpen(false)
      /* eslint-enable react-hooks/set-state-in-effect */
      return
    }

    // Cancel previous in-flight request
    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setFetched(false)

    searchNodesForEdge(debouncedQuery, { limit: 10 }, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) {
          setResults(res.nodes)
          setFetched(true)
          setOpen(true)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResults([])
          setFetched(true)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => {
      controller.abort()
    }
  }, [debouncedQuery, value])

  function handleClear() {
    onChange(null)
    setQuery("")
    setResults([])
    setFetched(false)
    setOpen(false)
  }

  function handleSelect(node: GraphNode) {
    onChange(node)
    setQuery("")
    setResults([])
    setFetched(false)
    setOpen(false)
  }

  // Selected state
  if (value !== null) {
    const title = resolveNodeTitle(value, schemas)
    const typeLabel = displayNodeType(value.node_type)

    return (
      <div
        ref={containerRef}
        className="flex h-10 w-full items-center gap-2 rounded-md border border-border/50 bg-muted/50 px-3 text-sm text-foreground"
      >
        <span className="flex-1 truncate">{title}</span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {typeLabel}
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Clear selection"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  }

  // Search state
  const showDropdown = open && (loading || fetched)

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "w-full rounded-md border border-border/50 bg-muted/50 h-10 px-3 text-sm text-foreground",
            "placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Rendered in a portal so results float above (and aren't clipped by) a
          modal's scroll container. */}
      <AnchoredPopover
        anchorRef={containerRef}
        open={showDropdown}
        onClose={() => setOpen(false)}
        className="rounded-lg border border-border/50 bg-popover py-1 shadow-lg shadow-black/20"
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && results.length === 0 ? null : fetched && results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No nodes found</div>
          ) : (
            results.map((node) => {
              const title = resolveNodeTitle(node, schemas)
              const typeLabel = displayNodeType(node.node_type)
              const truncatedId =
                node.ref_id.length > 12 ? node.ref_id.slice(0, 12) + "…" : node.ref_id

              return (
                <button
                  key={node.ref_id}
                  type="button"
                  onClick={() => handleSelect(node)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                    "hover:bg-muted/50 text-foreground"
                  )}
                >
                  <span className="flex-1 truncate">{title}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {typeLabel}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {truncatedId}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </AnchoredPopover>
    </div>
  )
}
