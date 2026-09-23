"use client"

import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react"
import { Check, ChevronDown, ChevronRight, Copy, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { SchemaNode, SchemaEdge } from "@/lib/schema-types"
import { ontologyDigest } from "@/lib/ontology-digest"
import {
  allExpandableRefs,
  buildOutlineModel,
  defaultExpandedRefs,
  outlineAncestors,
  relationshipsForType,
  searchOutline,
  type OutlineDomain,
  type OutlineNode,
} from "@/lib/ontology-outline"

interface Props {
  /** Already domain-filtered by the page, like the other two views. */
  schemas: SchemaNode[]
  edges: SchemaEdge[]
  selectedId: string | null
  onSelect: (id: string) => void
}

const INDENT_PX = 16
const COPIED_MS = 1500

/** Wrap every occurrence of `query` (already lowercased) in <mark>. */
function highlight(text: string, query: string): ReactNode {
  if (!query) return text
  const lower = text.toLowerCase()
  const parts: ReactNode[] = []
  let from = 0
  let at = lower.indexOf(query, from)
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at))
    parts.push(
      <mark key={at} className="rounded-sm bg-primary/25 text-foreground">
        {text.slice(at, at + query.length)}
      </mark>
    )
    from = at + query.length
    at = lower.indexOf(query, from)
  }
  if (from < text.length) parts.push(text.slice(from))
  return parts
}

type Row = { kind: "domain"; domain: OutlineDomain } | { kind: "node"; node: OutlineNode }

interface NodeRowProps {
  node: OutlineNode
  expanded: boolean
  selected: boolean
  matched: boolean
  query: string
  onToggle: (refId: string) => void
  onSelect: (refId: string) => void
}

const NodeRow = memo(function NodeRow({ node, expanded, selected, matched, query, onToggle, onSelect }: NodeRowProps) {
  const hasChildren = node.directCount > 0
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      onClick={() => onSelect(node.refId)}
      className={`group flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-left transition-colors ${
        selected
          ? "bg-primary/10 text-foreground"
          : matched
            ? "text-foreground hover:bg-muted/50"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      }`}
      style={{ paddingLeft: 8 + node.depth * INDENT_PX }}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-label={expanded ? `Collapse ${node.type}` : `Expand ${node.type}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(node.refId)
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      ) : (
        <span className="h-4 w-4 shrink-0" />
      )}
      <span className={`min-w-0 truncate text-sm ${selected ? "font-medium" : ""}`}>{highlight(node.type, query)}</span>
      {node.nodeKey && (
        <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground/60">
          {highlight(node.nodeKey, query)}
        </span>
      )}
      {hasChildren && (
        <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[10px] text-muted-foreground/60">
          {node.directCount} direct · {node.totalCount} total
        </span>
      )}
    </div>
  )
})

interface DomainRowProps {
  domain: OutlineDomain
  collapsed: boolean
  onToggle: (key: string) => void
}

const DomainRow = memo(function DomainRow({ domain, collapsed, onToggle }: DomainRowProps) {
  return (
    <button
      type="button"
      onClick={() => onToggle(domain.key)}
      aria-expanded={!collapsed}
      className="mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left first:mt-0 hover:bg-muted/40"
    >
      {collapsed ? (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="font-heading text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {domain.label}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground/60">{domain.count}</span>
    </button>
  )
})

export const OntologyOutline = memo(function OntologyOutline({ schemas, edges, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState("")
  // null = the model's default expansion; a Set once the user has touched it.
  const [expanded, setExpanded] = useState<Set<string> | null>(null)
  const [collapsedDomains, setCollapsedDomains] = useState<Set<string>>(() => new Set())
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fallbackRef = useRef<HTMLTextAreaElement>(null)

  const model = useMemo(() => buildOutlineModel(schemas), [schemas])
  const search = useMemo(() => searchOutline(model, query), [model, query])
  const baseExpanded = useMemo(() => expanded ?? defaultExpandedRefs(model), [expanded, model])

  // Reveal a selection made elsewhere (sidebar, another view) by opening its
  // ancestors. Done as a render-time state adjustment keyed on selectedId so
  // the user can still collapse those ancestors afterwards.
  const [revealedFor, setRevealedFor] = useState<string | null>(null)
  if (selectedId !== revealedFor) {
    setRevealedFor(selectedId)
    if (selectedId && model.byRef.has(selectedId)) {
      const ancestors = outlineAncestors(model, selectedId)
      if (ancestors.some((a) => !baseExpanded.has(a))) {
        const next = new Set(baseExpanded)
        for (const a of ancestors) next.add(a)
        setExpanded(next)
      }
    }
  }

  const rows = useMemo<Row[]>(() => {
    const searching = search.query.length > 0
    const out: Row[] = []
    const visit = (node: OutlineNode) => {
      if (searching && !search.visible.has(node.refId)) return
      out.push({ kind: "node", node })
      const open = baseExpanded.has(node.refId) || (searching && search.expanded.has(node.refId))
      if (!open) return
      for (const c of node.children) visit(c)
    }
    for (const d of model.domains) {
      if (searching && !d.roots.some((r) => search.visible.has(r.refId))) continue
      out.push({ kind: "domain", domain: d })
      if (collapsedDomains.has(d.key) && !searching) continue
      for (const r of d.roots) visit(r)
    }
    return out
  }, [model, search, baseExpanded, collapsedDomains])

  const isOpen = useCallback(
    (refId: string) => baseExpanded.has(refId) || (search.query.length > 0 && search.expanded.has(refId)),
    [baseExpanded, search]
  )

  // While a search is active, ancestors of matches stay open regardless of
  // this set (see `isOpen`), so toggling only affects the persisted choice.
  const handleToggle = useCallback(
    (refId: string) => {
      setExpanded((prev) => {
        const next = new Set(prev ?? defaultExpandedRefs(model))
        if (next.has(refId)) next.delete(refId)
        else next.add(refId)
        return next
      })
    },
    [model]
  )
  const handleToggleDomain = useCallback((key: string) => {
    setCollapsedDomains((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const handleExpandAll = useCallback(() => {
    setExpanded(allExpandableRefs(model))
    setCollapsedDomains(new Set())
  }, [model])
  const handleCollapseAll = useCallback(() => {
    setExpanded(new Set())
  }, [])

  const handleCopy = useCallback(() => {
    const text = ontologyDigest(schemas, edges)
    const done = () => {
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS)
    }
    const fallback = () => {
      const ta = fallbackRef.current
      if (!ta) return
      ta.value = text
      ta.focus()
      ta.select()
      try {
        document.execCommand("copy")
      } catch {
        // the text stays selected in the textarea for a manual copy
      }
      done()
    }
    try {
      navigator.clipboard.writeText(text).then(done, fallback)
    } catch {
      fallback()
    }
  }, [schemas, edges])

  const selectedNode = selectedId ? model.byRef.get(selectedId) : undefined
  const relationships = useMemo(
    () => (selectedNode ? relationshipsForType(selectedNode.type, model.byType, edges) : []),
    [selectedNode, model, edges]
  )

  const typeCount = model.byRef.size
  const matchCount = search.matched.size

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by type or key..."
            aria-label="Filter outline"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <span className="font-mono text-[10px] text-muted-foreground/70">
          {search.query ? `${matchCount} of ${typeCount}` : `${typeCount} types · ${model.domains.length} domains`}
        </span>
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={handleExpandAll} className="text-muted-foreground hover:text-foreground">
            Expand all
          </Button>
          <Button size="xs" variant="ghost" onClick={handleCollapseAll} className="text-muted-foreground hover:text-foreground">
            Collapse all
          </Button>
          <Button size="sm" variant="outline" onClick={handleCopy} title="Copy a plain-text digest of the visible ontology for an LLM agent">
            {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy for agent"}
          </Button>
        </div>
        <textarea
          ref={fallbackRef}
          readOnly
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute h-px w-px opacity-0"
        />
      </div>

      {/* Tree */}
      <div role="tree" className="min-h-0 flex-1 overflow-y-auto p-2">
        {rows.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {search.query ? <>No types match &ldquo;{query.trim()}&rdquo;</> : "No types in the selected domains"}
          </p>
        )}
        {rows.map((row) =>
          row.kind === "domain" ? (
            <DomainRow
              key={`d:${row.domain.key}`}
              domain={row.domain}
              collapsed={collapsedDomains.has(row.domain.key) && !search.query}
              onToggle={handleToggleDomain}
            />
          ) : (
            <NodeRow
              key={row.node.refId}
              node={row.node}
              expanded={isOpen(row.node.refId)}
              selected={row.node.refId === selectedId}
              matched={search.matched.has(row.node.refId)}
              query={search.query}
              onToggle={handleToggle}
              onSelect={onSelect}
            />
          )
        )}
      </div>

      {/* Relationships of the selected type, inherited ones included */}
      {selectedNode && (
        <div className="max-h-[40%] shrink-0 overflow-y-auto border-t border-border bg-card">
          <div className="sticky top-0 flex items-center gap-2 border-b border-border/60 bg-card px-3 py-1.5">
            <span className="font-heading text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Relationships
            </span>
            <span className="truncate text-xs font-medium">{selectedNode.type}</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">{relationships.length}</span>
          </div>
          {relationships.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No relationships apply to this type.</p>
          ) : (
            <ul className="p-2">
              {relationships.map(({ edge, inheritedFrom }) => (
                <li
                  key={edge.ref_id}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground"
                >
                  <span className="truncate text-foreground">{edge.source_type}</span>
                  <span className="shrink-0 font-mono text-[11px] font-medium text-foreground">{edge.edge_type}</span>
                  <span className="truncate text-foreground">{edge.target_type}</span>
                  {inheritedFrom && (
                    <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] text-muted-foreground/70">
                      (inherited from {inheritedFrom})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
})
