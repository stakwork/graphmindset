"use client"

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { OntologyGraph } from "./ontology-graph"
import { OntologyNeo4jGraph } from "./ontology-neo4j-graph"
import { TypeEditor } from "./type-editor"
import { EdgeTypePanel } from "./edge-type-panel"
import { EdgeCreatePanel, type NewEdgeParams } from "./edge-create-panel"
import { OntologyAgentPanel } from "./ontology-agent-panel"
import { DomainFilter } from "./domain-filter"
import { Plus, ArrowLeft, Network, Share2, Search, ArrowRight, HelpCircle, Sparkles } from "lucide-react"
import { useUserStore } from "@/stores/user-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSchemaStore, serializeAttributes } from "@/stores/schema-store"
import { isMocksEnabled, MOCK_DOMAINS } from "@/lib/mock-data"
import { getSchemaDomains } from "@/lib/graph-api"
import { filterSchemasByDomain, listSchemaDomains } from "@/lib/schema-domains"
import { SMALL_SCHEMAS, SMALL_EDGES } from "./mock-small"
import type { SchemaNode, SchemaEdge, SchemaAttribute } from "@/lib/schema-types"

// The set of hidden domain keys, persisted in localStorage and exposed as an
// external store (same pattern as the graph pane's view mode): the server
// snapshot is always "nothing hidden" so SSR and the first client render agree,
// then the stored set takes over without a setState-in-effect.
const DISABLED_DOMAINS_STORAGE_KEY = "ontology:disabled-domains"
const NO_DISABLED_DOMAINS: ReadonlySet<string> = new Set()
const disabledDomainsListeners = new Set<() => void>()
let disabledDomainsCache: { raw: string | null; set: ReadonlySet<string> } = {
  raw: null,
  set: NO_DISABLED_DOMAINS,
}
function subscribeDisabledDomains(cb: () => void) {
  disabledDomainsListeners.add(cb)
  window.addEventListener("storage", cb)
  return () => {
    disabledDomainsListeners.delete(cb)
    window.removeEventListener("storage", cb)
  }
}
function readDisabledDomains(): ReadonlySet<string> {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(DISABLED_DOMAINS_STORAGE_KEY)
  } catch {
    // storage unavailable — fall back to whatever this session last chose
    return disabledDomainsCache.set
  }
  // Same raw string → same Set instance, as useSyncExternalStore requires.
  if (raw === disabledDomainsCache.raw) return disabledDomainsCache.set
  let set: ReadonlySet<string> = NO_DISABLED_DOMAINS
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) {
      set = new Set(parsed.filter((k): k is string => typeof k === "string").map((k) => k.toLowerCase()))
    }
  } catch {
    // malformed entry — treat as nothing hidden
  }
  disabledDomainsCache = { raw, set }
  return set
}
function writeDisabledDomains(next: ReadonlySet<string>) {
  try {
    if (next.size === 0) window.localStorage.removeItem(DISABLED_DOMAINS_STORAGE_KEY)
    else window.localStorage.setItem(DISABLED_DOMAINS_STORAGE_KEY, JSON.stringify(Array.from(next).sort()))
  } catch {
    // storage unavailable (private mode) — keep the choice for this session only
    disabledDomainsCache = { raw: disabledDomainsCache.raw, set: next }
  }
  for (const cb of disabledDomainsListeners) cb()
}

export default function OntologyPage() {
  const router = useRouter()
  const isAdmin = useUserStore((s) => s.isAdmin)
  const store = useSchemaStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // "network" (the main graph's 2D canvas) is the default; "hierarchy" is the dagre tree.
  const [graphView, setGraphView] = useState<"network" | "hierarchy">("network")
  const [search, setSearch] = useState("")
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [sidebarTab, setSidebarTab] = useState<"nodes" | "edges">("nodes")
  const [selectedEdgeType, setSelectedEdgeType] = useState<string | null>(null)
  const [edgeSearch, setEdgeSearch] = useState("")
  const [edgeError, setEdgeError] = useState<string | null>(null)
  // Non-null while the "new relationship" panel is open; the optional source/
  // target prefill the form (set when a connection is drawn on the graph).
  const [edgeCreate, setEdgeCreate] = useState<{ source?: string; target?: string } | null>(null)
  // Non-null while a draft (unsaved) new node type is being authored.
  const [draftType, setDraftType] = useState<SchemaNode | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  // When true, the AI ontology-editor panel takes over the right-panel slot.
  const [showAgent, setShowAgent] = useState(false)
  // Authoritative domain list from /v2/schema/domains (MOCK_DOMAINS in mock
  // mode); unioned with the domains found on the loaded schemas below.
  const [apiDomains, setApiDomains] = useState<string[]>([])
  const disabledDomains = useSyncExternalStore(
    subscribeDisabledDomains,
    readDisabledDomains,
    () => NO_DISABLED_DOMAINS
  )

  useEffect(() => {
    if (isMocksEnabled()) {
      store.setSchemas(SMALL_SCHEMAS)
      store.setEdges(SMALL_EDGES)
      setApiDomains(MOCK_DOMAINS.domains)
    } else {
      store.fetchAll()
      getSchemaDomains()
        .then((r) => setApiDomains(r.domains ?? []))
        .catch(() => {
          // the schemas' own domains still populate the filter
        })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const domainOptions = useMemo(
    () => listSchemaDomains(store.schemas, apiDomains),
    [store.schemas, apiDomains]
  )

  // Pure domain filter applied before the data reaches either graph view and
  // the sidebar lists. The store's schemas/edges are never mutated; the editing
  // panels keep receiving the full store (parent pickers etc. need every type).
  const filtered = useMemo(
    () => filterSchemasByDomain(store.schemas, store.edges, disabledDomains),
    [store.schemas, store.edges, disabledDomains]
  )

  // A selection that the filter just removed would point at nothing on the canvas.
  useEffect(() => {
    if (selectedId && !filtered.schemas.some((s) => s.ref_id === selectedId)) {
      setSelectedId(null)
    }
  }, [filtered.schemas, selectedId])
  useEffect(() => {
    if (selectedEdgeType && !filtered.edges.some((e) => e.edge_type === selectedEdgeType)) {
      setSelectedEdgeType(null)
    }
  }, [filtered.edges, selectedEdgeType])

  const handleToggleDomain = useCallback(
    (key: string) => {
      const next = new Set(disabledDomains)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      writeDisabledDomains(next)
    },
    [disabledDomains]
  )
  const handleAllDomains = useCallback(() => writeDisabledDomains(NO_DISABLED_DOMAINS), [])
  const handleNoDomains = useCallback(
    () => writeDisabledDomains(new Set(domainOptions.map((d) => d.key))),
    [domainOptions]
  )

  const selected = store.schemas.find((s) => s.ref_id === selectedId) ?? null

  // Filter by type name, then sort alphabetically (by first letter).
  const visibleSchemas = useMemo(() => {
    const q = search.trim().toLowerCase()
    return filtered.schemas
      .filter((s) => !q || s.type.toLowerCase().includes(q))
      .sort((a, b) => a.type.localeCompare(b.type))
  }, [filtered.schemas, search])

  // Deduplicate edges by edge_type (exclude CHILD_OF), filter by edgeSearch, sort alphabetically
  const visibleEdgeTypes = useMemo(() => {
    const q = edgeSearch.trim().toLowerCase()
    const countMap = new Map<string, number>()
    for (const e of filtered.edges) {
      if (e.edge_type === "CHILD_OF") continue
      countMap.set(e.edge_type, (countMap.get(e.edge_type) ?? 0) + 1)
    }
    return Array.from(countMap.entries())
      .filter(([edgeType]) => !q || edgeType.toLowerCase().includes(q))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([edgeType, count]) => ({ edgeType, count }))
  }, [filtered.edges, edgeSearch])

  // Stable so the memoized OntologyGraph doesn't re-render on unrelated page updates.
  const handleClearSelection = useCallback(() => setSelectedId(null), [])

  const handleSwitchToEdges = useCallback(() => {
    setSidebarTab("edges")
    setSelectedId(null)
    setDraftType(null)
    setEdgeCreate(null)
  }, [])

  const handleSwitchToNodes = useCallback(() => {
    setSidebarTab("nodes")
    setSelectedEdgeType(null)
    setEdgeSearch("")
    setEdgeCreate(null)
  }, [])

  const handleUpdateSchema = useCallback(
    async (updated: SchemaNode) => {
      if (!isAdmin) return
      try {
        await store.updateSchema(updated)
        setSchemaError(null)
      } catch (err) {
        setSchemaError(err instanceof Error ? err.message : "Failed to save schema")
      }
    },
    [isAdmin, store]
  )

  // Open a draft "new type" form. Nothing is persisted until the user clicks
  // Create — clicking + no longer writes a NewType record to the server.
  const handleStartAddType = useCallback(() => {
    if (!isAdmin) return
    const existing = new Set(store.schemas.map((s) => s.type))
    let n = 1
    while (existing.has(`NewType${n}`)) n++

    setEdgeCreate(null)
    setSelectedId(null)
    setSchemaError(null)
    setDraftType({
      ref_id: `s-${Date.now()}`,
      type: `NewType${n}`,
      parent: "Thing",
      color: "#64748b",
      node_key: "name",
      attributes: [{ key: "name", type: "string", required: true }],
    })
  }, [isAdmin, store.schemas])

  const handleCreateType = useCallback(
    async (draft: SchemaNode) => {
      if (!isAdmin) return
      try {
        const refId = await store.addSchema(draft)
        setSchemaError(null)
        setDraftType(null)
        setSelectedId(refId)
      } catch (err) {
        setSchemaError(err instanceof Error ? err.message : "Failed to create type")
      }
    },
    [isAdmin, store]
  )

  const handleDeleteSchema = useCallback(
    (refId: string) => {
      if (!isAdmin) return
      store.removeSchema(refId)
      if (selectedId === refId) setSelectedId(null)
    },
    [isAdmin, selectedId, store]
  )

  const filteredEdgesForPanel = useMemo(
    () => store.edges.filter((e) => e.edge_type === selectedEdgeType),
    [store.edges, selectedEdgeType]
  )

  const typeToRefId = useCallback(
    (typeName: string) => store.schemas.find((s) => s.type === typeName)?.ref_id ?? typeName,
    [store.schemas]
  )

  const buildEdge = useCallback(
    (
      sourceType: string,
      targetType: string,
      edgeType: string,
      attributes: SchemaAttribute[]
    ): SchemaEdge => ({
      ref_id: `e-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      source: typeToRefId(sourceType),
      target: typeToRefId(targetType),
      // Match the backend's normalization so optimistic UI lines up with the saved value.
      edge_type: edgeType.trim().toUpperCase().replace(/\s+/g, "_"),
      source_type: sourceType,
      target_type: targetType,
      attributes: serializeAttributes(attributes),
    }),
    [typeToRefId]
  )

  const handleCreateEdge = useCallback(
    async ({ sourceType, targetType, edgeType, attributes }: NewEdgeParams) => {
      if (!isAdmin) return
      const edge = buildEdge(sourceType, targetType, edgeType, attributes)
      try {
        await store.addEdge(edge)
        setEdgeError(null)
        setEdgeCreate(null)
        setSelectedId(null)
        setSidebarTab("edges")
        setSelectedEdgeType(edge.edge_type)
      } catch (err) {
        setEdgeError(err instanceof Error ? err.message : "Failed to create relationship")
      }
    },
    [isAdmin, buildEdge, store]
  )

  const handleAddConnection = useCallback(
    async (sourceType: string, targetType: string) => {
      if (!isAdmin || !selectedEdgeType) return
      const edge = buildEdge(sourceType, targetType, selectedEdgeType, [])
      try {
        await store.addEdge(edge)
        setEdgeError(null)
      } catch (err) {
        setEdgeError(err instanceof Error ? err.message : "Failed to add connection")
      }
    },
    [isAdmin, selectedEdgeType, buildEdge, store]
  )

  const handleDeleteConnection = useCallback(
    (refId: string) => {
      if (!isAdmin) return
      store.removeEdge(refId)
    },
    [isAdmin, store]
  )

  const handleSaveEdgeAttributes = useCallback(
    async (attrs: SchemaAttribute[]) => {
      if (!isAdmin || !selectedEdgeType) return
      const serialized = serializeAttributes(attrs)
      const targets = store.edges.filter((e) => e.edge_type === selectedEdgeType)
      try {
        await Promise.all(targets.map((e) => store.updateEdge({ ...e, attributes: serialized })))
        setEdgeError(null)
      } catch (err) {
        setEdgeError(err instanceof Error ? err.message : "Failed to update attributes")
      }
    },
    [isAdmin, selectedEdgeType, store]
  )

  const handleDeleteEdgeType = useCallback(async () => {
    if (!isAdmin || !selectedEdgeType) return
    const targets = store.edges.filter((e) => e.edge_type === selectedEdgeType)
    await Promise.all(targets.map((e) => store.removeEdge(e.ref_id)))
    setSelectedEdgeType(null)
  }, [isAdmin, selectedEdgeType, store])

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Left: Type list */}
      <div className="w-[280px] shrink-0 border-r border-border flex flex-col bg-sidebar noise-bg">
        {/* Header row */}
        <div className="relative z-10 flex items-center gap-2 p-4 border-b border-border">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => router.push("/admin")}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          {/* Segmented tab control */}
          <div className="flex-1 flex items-center gap-1 rounded-md bg-muted/40 p-0.5">
            <button
              onClick={handleSwitchToNodes}
              className={`flex-1 text-[11px] font-medium rounded px-2 py-1 transition-colors ${
                sidebarTab === "nodes"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Nodes
            </button>
            <button
              onClick={handleSwitchToEdges}
              className={`flex-1 text-[11px] font-medium rounded px-2 py-1 transition-colors ${
                sidebarTab === "edges"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Edges
            </button>
          </div>

          {isAdmin && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowAgent((v) => !v)}
              className={`h-7 w-7 p-0 hover:text-foreground ${showAgent ? "text-primary" : "text-muted-foreground"}`}
              title="Edit ontology with AI"
            >
              <Sparkles className="h-4 w-4" />
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowHelp((v) => !v)}
            className={`h-7 w-7 p-0 hover:text-foreground ${showHelp ? "text-foreground" : "text-muted-foreground"}`}
            title="How to add types & relationships"
          >
            <HelpCircle className="h-4 w-4" />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setGraphView((v) => (v === "network" ? "hierarchy" : "network"))}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            title={graphView === "network" ? "Switch to hierarchy view" : "Switch to network view"}
          >
            {graphView === "network" ? <Network className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={
              sidebarTab === "nodes"
                ? handleStartAddType
                : () => {
                    setEdgeError(null)
                    setEdgeCreate({})
                  }
            }
            disabled={!isAdmin}
            title={sidebarTab === "nodes" ? "Add type" : "Add relationship"}
            className="h-7 w-7 p-0"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Help / tips */}
        {showHelp && (
          <div className="relative z-10 border-b border-border bg-muted/20 p-3 text-[11px] leading-relaxed text-muted-foreground">
            {sidebarTab === "nodes" ? (
              <>
                <p className="mb-1 font-medium text-foreground">Add a type (node)</p>
                <ol className="list-decimal space-y-0.5 pl-4">
                  <li>Click the <span className="font-medium text-foreground">+</span> button above.</li>
                  <li>Name it and pick a <span className="font-medium text-foreground">parent</span> to inherit attributes.</li>
                  <li>Add <span className="font-medium text-foreground">attributes</span> (the fields each node holds).</li>
                  <li>Choose a <span className="font-medium text-foreground">unique key</span>, then <span className="font-medium text-foreground">Create type</span>.</li>
                </ol>
                <p className="mt-2 text-muted-foreground/70">
                  Click any type to edit it (changes save on <span className="font-medium text-foreground">Save</span>). Selecting a node focuses its neighborhood; press Esc to zoom back out.
                </p>
              </>
            ) : (
              <>
                <p className="mb-1 font-medium text-foreground">Add a relationship (edge)</p>
                <ol className="list-decimal space-y-0.5 pl-4">
                  <li>Click the <span className="font-medium text-foreground">+</span> button above.</li>
                  <li>Name it, e.g. <span className="font-mono text-foreground">AUTHORED_BY</span>.</li>
                  <li>Pick the <span className="font-medium text-foreground">From</span> and <span className="font-medium text-foreground">To</span> types (arrow points From → To).</li>
                  <li>Click <span className="font-medium text-foreground">Create relationship</span>.</li>
                </ol>
                <p className="mt-2 text-muted-foreground/70">
                  Select a relationship to add/remove its connections or edit its attributes.
                </p>
              </>
            )}
          </div>
        )}

        {/* Search input */}
        <div className="relative z-10 p-2 border-b border-border">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            {sidebarTab === "nodes" ? (
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search types..."
                className="h-8 pl-8 text-sm"
              />
            ) : (
              <Input
                value={edgeSearch}
                onChange={(e) => setEdgeSearch(e.target.value)}
                placeholder="Search edge types..."
                className="h-8 pl-8 text-sm"
              />
            )}
          </div>
        </div>

        {/* Domain filter (applies to both graph views and the lists above) */}
        <DomainFilter
          domains={domainOptions}
          disabled={disabledDomains}
          onToggle={handleToggleDomain}
          onAll={handleAllDomains}
          onNone={handleNoDomains}
        />

        {/* List */}
        <div className="relative z-10 flex-1 overflow-y-auto p-2 space-y-1">
          {sidebarTab === "nodes" ? (
            <>
              {visibleSchemas.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  No types match &ldquo;{search}&rdquo;
                </p>
              )}
              {visibleSchemas.map((schema) => (
                <button
                  key={schema.ref_id}
                  onClick={() => {
                    setDraftType(null)
                    setEdgeCreate(null)
                    setSelectedId(schema.ref_id)
                  }}
                  className={`flex items-center gap-3 w-full rounded-md px-3 py-2 text-left transition-colors ${
                    selectedId === schema.ref_id
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <div
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: schema.color }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{schema.type}</p>
                    {schema.parent && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        extends {schema.parent}
                      </p>
                    )}
                  </div>
                  <span className="ml-auto text-[10px] font-mono text-muted-foreground/60">
                    {schema.attributes.length}
                  </span>
                </button>
              ))}
            </>
          ) : (
            <>
              {visibleEdgeTypes.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  No edge types match &ldquo;{edgeSearch}&rdquo;
                </p>
              )}
              {visibleEdgeTypes.map(({ edgeType, count }) => (
                <button
                  key={edgeType}
                  onClick={() => setSelectedEdgeType(edgeType)}
                  className={`flex items-center gap-3 w-full rounded-md px-3 py-2 text-left transition-colors ${
                    selectedEdgeType === edgeType
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                  <span className="text-sm font-mono font-medium truncate">{edgeType}</span>
                  <span className="ml-auto text-[10px] font-mono text-muted-foreground/60">
                    {count}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Center: Ontology graph */}
      <div className="flex-1 min-w-0">
        {graphView === "network" ? (
          <OntologyNeo4jGraph
            schemas={filtered.schemas}
            edges={filtered.edges}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onClear={handleClearSelection}
            selectedEdgeType={selectedEdgeType}
          />
        ) : (
          <OntologyGraph
            schemas={filtered.schemas}
            edges={filtered.edges}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onClear={handleClearSelection}
            selectedEdgeType={selectedEdgeType}
          />
        )}
      </div>

      {/* Right panel — AI editor takes precedence, then create flow, then inspectors */}
      {showAgent ? (
        <OntologyAgentPanel onClose={() => setShowAgent(false)} />
      ) : edgeCreate ? (
        <EdgeCreatePanel
          allSchemas={store.schemas}
          initialSource={edgeCreate.source}
          initialTarget={edgeCreate.target}
          onCreate={handleCreateEdge}
          onClose={() => {
            setEdgeCreate(null)
            setEdgeError(null)
          }}
          error={edgeError ?? undefined}
          onClearError={() => setEdgeError(null)}
        />
      ) : draftType ? (
        <TypeEditor
          key="new-type"
          schema={draftType}
          allSchemas={store.schemas}
          edges={store.edges}
          canEdit={isAdmin}
          isNew
          onSave={handleUpdateSchema}
          onCreate={handleCreateType}
          onDelete={handleDeleteSchema}
          onClose={() => {
            setDraftType(null)
            setSchemaError(null)
          }}
          error={schemaError ?? undefined}
          onClearError={() => setSchemaError(null)}
        />
      ) : sidebarTab === "nodes" && selected ? (
        <TypeEditor
          key={selected.ref_id}
          schema={selected}
          allSchemas={store.schemas}
          edges={store.edges}
          canEdit={isAdmin}
          onSave={handleUpdateSchema}
          onDelete={handleDeleteSchema}
          onClose={() => setSelectedId(null)}
          error={schemaError ?? undefined}
          onClearError={() => setSchemaError(null)}
        />
      ) : sidebarTab === "edges" && selectedEdgeType !== null ? (
        <EdgeTypePanel
          key={selectedEdgeType}
          edgeType={selectedEdgeType}
          edges={filteredEdgesForPanel}
          allSchemas={store.schemas}
          canEdit={isAdmin}
          onClose={() => setSelectedEdgeType(null)}
          onAddConnection={handleAddConnection}
          onDeleteConnection={handleDeleteConnection}
          onSaveAttributes={handleSaveEdgeAttributes}
          onDeleteType={handleDeleteEdgeType}
          error={edgeError ?? undefined}
          onClearError={() => setEdgeError(null)}
        />
      ) : null}
    </div>
  )
}
