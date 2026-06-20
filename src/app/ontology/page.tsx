"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { OntologyGraph } from "./ontology-graph"
import { TypeEditor } from "./type-editor"
import { EdgeTypePanel } from "./edge-type-panel"
import { Plus, ArrowLeft, Box, Grid2x2, Search, ArrowRight } from "lucide-react"
import { useUserStore } from "@/stores/user-store"

const OntologyGraph3D = dynamic(
  () => import("./ontology-graph-3d").then((m) => ({ default: m.OntologyGraph3D })),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center"><p className="text-muted-foreground animate-pulse">Loading 3D...</p></div> }
)
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSchemaStore } from "@/stores/schema-store"
import { isMocksEnabled } from "@/lib/mock-data"
import { SMALL_SCHEMAS, SMALL_EDGES } from "./mock-small"

export interface SchemaAttribute {
  key: string
  type: string
  required: boolean
}

export interface SchemaNode {
  ref_id: string
  type: string
  parent: string
  color: string
  node_key: string
  // The search domain this schema belongs to (lowercased). Domains are derived
  // backend-side from `DISTINCT toLower(s.domain)`; a root type only registers as
  // its own domain when this is set to its name. Omitted → backend defaults to
  // "entity". Set explicitly by the Domains editor; left unset by the ontology editor.
  domain?: string
  attributes: SchemaAttribute[]
  inherited_attributes?: SchemaAttribute[]
  title_key?: string
  index?: string
  description_key?: string
  icon?: string
  secondary_color?: string
  paid_properties?: string[]
}

export interface SchemaEdge {
  ref_id: string
  // `source`/`target` are the connected schema NODES' ref_ids (used to lay out
  // the ontology graph), NOT type names. Use `source_type`/`target_type` to
  // match against a node's node_type.
  source: string
  target: string
  edge_type: string
  source_type?: string
  target_type?: string
  // Attribute definitions for this edge type, e.g. { since: "?datetime",
  // role: "string" }. A leading "?" marks the attribute optional. Present on
  // the live /schema/all payload; absent on some mock fixtures.
  attributes?: Record<string, string>
}

export default function OntologyPage() {
  const router = useRouter()
  const isAdmin = useUserStore((s) => s.isAdmin)
  const isAuthenticated = useUserStore((s) => s.isAuthenticated)
  const store = useSchemaStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view3D, setView3D] = useState(false)
  const [search, setSearch] = useState("")
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [sidebarTab, setSidebarTab] = useState<"nodes" | "edges">("nodes")
  const [selectedEdgeType, setSelectedEdgeType] = useState<string | null>(null)
  const [edgeSearch, setEdgeSearch] = useState("")

  useEffect(() => {
    if (isAuthenticated && !isAdmin) {
      router.replace("/")
      return
    }
  }, [isAdmin, isAuthenticated, router])

  useEffect(() => {
    if (isMocksEnabled()) {
      store.setSchemas(SMALL_SCHEMAS)
      store.setEdges(SMALL_EDGES)
    } else {
      store.fetchAll()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selected = store.schemas.find((s) => s.ref_id === selectedId) ?? null

  // Filter by type name, then sort alphabetically (by first letter).
  const visibleSchemas = useMemo(() => {
    const q = search.trim().toLowerCase()
    return store.schemas
      .filter((s) => !q || s.type.toLowerCase().includes(q))
      .sort((a, b) => a.type.localeCompare(b.type))
  }, [store.schemas, search])

  // Deduplicate edges by edge_type (exclude CHILD_OF), filter by edgeSearch, sort alphabetically
  const visibleEdgeTypes = useMemo(() => {
    const q = edgeSearch.trim().toLowerCase()
    const countMap = new Map<string, number>()
    for (const e of store.edges) {
      if (e.edge_type === "CHILD_OF") continue
      countMap.set(e.edge_type, (countMap.get(e.edge_type) ?? 0) + 1)
    }
    return Array.from(countMap.entries())
      .filter(([edgeType]) => !q || edgeType.toLowerCase().includes(q))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([edgeType, count]) => ({ edgeType, count }))
  }, [store.edges, edgeSearch])

  const handleSwitchToEdges = useCallback(() => {
    setSidebarTab("edges")
    setSelectedId(null)
  }, [])

  const handleSwitchToNodes = useCallback(() => {
    setSidebarTab("nodes")
    setSelectedEdgeType(null)
    setEdgeSearch("")
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

  const handleAddType = useCallback(async () => {
    if (!isAdmin) return
    // Find next available name
    const existing = new Set(store.schemas.map((s) => s.type))
    let n = 1
    while (existing.has(`NewType${n}`)) n++

    const id = `s-${Date.now()}`
    const newSchema: SchemaNode = {
      ref_id: id,
      type: `NewType${n}`,
      parent: "Thing",
      color: "#64748b",
      node_key: "name",
      attributes: [{ key: "name", type: "string", required: true }],
    }
    try {
      await store.addSchema(newSchema)
      setSchemaError(null)
    } catch (err) {
      setSchemaError(err instanceof Error ? err.message : "Failed to save schema")
    }
    setSelectedId(id)
  }, [isAdmin, store])

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

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Left: Type list */}
      <div className="w-[280px] shrink-0 border-r border-border flex flex-col bg-sidebar noise-bg">
        {/* Header row */}
        <div className="relative z-10 flex items-center gap-2 p-4 border-b border-border">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => router.push("/")}
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

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setView3D(!view3D)}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            title={view3D ? "Switch to 2D" : "Switch to 3D"}
          >
            {view3D ? <Grid2x2 className="h-4 w-4" /> : <Box className="h-4 w-4" />}
          </Button>

          {/* Only show + button in nodes tab */}
          {sidebarTab === "nodes" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleAddType}
              className="h-7 w-7 p-0"
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>

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
                  onClick={() => setSelectedId(schema.ref_id)}
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
        {view3D ? (
          <OntologyGraph3D
            schemas={store.schemas}
            edges={store.edges}
            selectedId={selectedId}
            onSelect={setSelectedId}
            selectedEdgeType={selectedEdgeType}
          />
        ) : (
          <OntologyGraph
            schemas={store.schemas}
            edges={store.edges}
            selectedId={selectedId}
            onSelect={setSelectedId}
            selectedEdgeType={selectedEdgeType}
          />
        )}
      </div>

      {/* Right panel */}
      {sidebarTab === "nodes" && selected && (
        <TypeEditor
          schema={selected}
          allSchemas={store.schemas}
          edges={store.edges}
          onUpdate={handleUpdateSchema}
          onDelete={handleDeleteSchema}
          onClose={() => setSelectedId(null)}
          error={schemaError ?? undefined}
          onClearError={() => setSchemaError(null)}
        />
      )}
      {sidebarTab === "edges" && selectedEdgeType !== null && (
        <EdgeTypePanel
          edgeType={selectedEdgeType}
          edges={filteredEdgesForPanel}
          allSchemas={store.schemas}
          onClose={() => setSelectedEdgeType(null)}
        />
      )}
    </div>
  )
}
