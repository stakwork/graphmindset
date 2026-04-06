"use client"

import { Search, X, Loader2 } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import { useAppStore } from "@/stores/app-store"
import { useGraphStore } from "@/stores/graph-store"
import { searchNodes } from "@/lib/graph-api"
import { useMocks, MOCK_NODES, MOCK_EDGES } from "@/lib/mock-data"

export function SearchBar() {
  const setSearchTerm = useAppStore((s) => s.setSearchTerm)
  const { setGraphData, setLoading } = useGraphStore()
  const [value, setValue] = useState("")
  const [focused, setFocused] = useState(false)
  const [searching, setSearching] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const trimmed = value.trim()
      if (!trimmed) return

      // Cancel any in-flight search
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setSearchTerm(trimmed)
      setSearching(true)
      setLoading(true)

      try {
        if (useMocks()) {
          const q = trimmed.toLowerCase()
          const filtered = MOCK_NODES.filter(
            (n) => n.name?.toLowerCase().includes(q) || n.node_type.toLowerCase().includes(q)
          )
          setGraphData(filtered, MOCK_EDGES)
        } else {
          const result = await searchNodes(trimmed, { limit: 100 }, controller.signal)
          setGraphData(result.nodes ?? [], result.edges ?? [])
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        console.error("Search failed:", err)
      } finally {
        setSearching(false)
        setLoading(false)
      }
    },
    [value, setSearchTerm, setGraphData, setLoading]
  )

  const handleClear = useCallback(() => {
    abortRef.current?.abort()
    setValue("")
    setSearchTerm("")
    setGraphData([], [])
  }, [setSearchTerm, setGraphData])

  return (
    <form onSubmit={handleSubmit} className="relative w-full max-w-xl group">
      <div
        className={`relative flex items-center rounded-lg border transition-all duration-300 ${
          focused
            ? "border-primary/40 bg-primary/5 shadow-[0_0_15px_oklch(0.72_0.14_200/0.1)]"
            : "border-border bg-muted/30 hover:border-border/80"
        }`}
      >
        {searching ? (
          <Loader2 className="absolute left-3 h-3.5 w-3.5 animate-spin text-primary" />
        ) : (
          <Search
            className={`absolute left-3 h-3.5 w-3.5 transition-colors ${
              focused ? "text-primary" : "text-muted-foreground"
            }`}
          />
        )}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search the graph..."
          className="h-9 w-full bg-transparent pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </form>
  )
}
