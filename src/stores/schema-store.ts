"use client"

import { create } from "zustand"
import type { SchemaNode, SchemaEdge } from "@/app/ontology/page"
import { api } from "@/lib/api"

interface SchemaState {
  schemas: SchemaNode[]
  edges: SchemaEdge[]
  loading: boolean
  setSchemas: (schemas: SchemaNode[]) => void
  setEdges: (edges: SchemaEdge[]) => void
  setLoading: (loading: boolean) => void
  updateSchema: (updated: SchemaNode) => void
  addSchema: (schema: SchemaNode) => void
  removeSchema: (refId: string) => void
  fetchAll: () => Promise<void>
}

function parseAttributes(attrs: Record<string, string> | undefined) {
  if (!attrs) return [{ key: "name", type: "string", required: true }]
  return Object.entries(attrs)
    .filter(([k]) => !["type", "ref_id", "parent"].includes(k))
    .map(([key, val]) => ({
      key,
      type: val.startsWith("?") ? val.slice(1) : val,
      required: !val.startsWith("?"),
    }))
}

function serializeAttributes(attrs: SchemaNode["attributes"]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const a of attrs) {
    if (!a.key) continue
    result[a.key] = a.required ? a.type : `?${a.type}`
  }
  return result
}

export const useSchemaStore = create<SchemaState>((set, get) => ({
  schemas: [],
  edges: [],
  loading: false,
  setSchemas: (schemas) => set({ schemas }),
  setEdges: (edges) => set({ edges }),
  setLoading: (loading) => set({ loading }),
  updateSchema: (updated) =>
    set((s) => ({
      schemas: s.schemas.map((x) => (x.ref_id === updated.ref_id ? updated : x)),
    })),
  addSchema: (schema) => set((s) => ({ schemas: [...s.schemas, schema] })),
  removeSchema: (refId) =>
    set((s) => ({ schemas: s.schemas.filter((x) => x.ref_id !== refId) })),

  fetchAll: async () => {
    set({ loading: true })
    try {
      const res = await api.get<{
        schemas: Array<{
          ref_id: string
          type: string
          parent?: string
          primary_color?: string
          node_key?: string
          attributes?: Record<string, string>
        }>
        edges: SchemaEdge[]
      }>("/schema/all")

      const schemas: SchemaNode[] = (res.schemas ?? []).map((s) => ({
        ref_id: s.ref_id,
        type: s.type ?? "",
        parent: s.parent ?? "",
        color: s.primary_color ?? "#64748b",
        node_key: s.node_key ?? "name",
        attributes: parseAttributes(s.attributes),
      }))

      set({ schemas, edges: res.edges ?? [] })
    } catch {
      // keep existing data
    } finally {
      set({ loading: false })
    }
  },
}))

export { serializeAttributes }
