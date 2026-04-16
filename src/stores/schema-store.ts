"use client"

import { create } from "zustand"
import type { SchemaNode, SchemaEdge } from "@/app/ontology/page"
import { api } from "@/lib/api"
import { isMocksEnabled } from "@/lib/mock-data"

interface SchemaState {
  schemas: SchemaNode[]
  edges: SchemaEdge[]
  loading: boolean
  setSchemas: (schemas: SchemaNode[]) => void
  setEdges: (edges: SchemaEdge[]) => void
  setLoading: (loading: boolean) => void
  updateSchema: (updated: SchemaNode) => Promise<void>
  addSchema: (schema: SchemaNode) => Promise<void>
  removeSchema: (refId: string) => Promise<void>
  fetchAll: () => Promise<void>
}

function parseAttributes(attrs: Record<string, unknown> | undefined) {
  if (!attrs) return [{ key: "name", type: "string", required: true }]
  return Object.entries(attrs)
    .filter(([k]) => !["type", "ref_id", "parent"].includes(k))
    .filter(([, val]) => typeof val === "string") // skip arrays and non-string values
    .map(([key, val]) => {
      const v = val as string
      return {
        key,
        type: v.startsWith("?") ? v.slice(1) : v,
        required: !v.startsWith("?"),
      }
    })
}

function serializeAttributes(attrs: SchemaNode["attributes"]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const a of attrs) {
    if (!a.key) continue
    result[a.key] = a.required ? a.type : `?${a.type}`
  }
  return result
}

export const useSchemaStore = create<SchemaState>((set) => ({
  schemas: [],
  edges: [],
  loading: false,
  setSchemas: (schemas) => set({ schemas }),
  setEdges: (edges) => set({ edges }),
  setLoading: (loading) => set({ loading }),

  updateSchema: async (updated) => {
    // Optimistic update
    set((s) => ({
      schemas: s.schemas.map((x) => (x.ref_id === updated.ref_id ? updated : x)),
    }))

    if (isMocksEnabled()) return

    try {
      await api.put(`/schema/${updated.ref_id}`, {
        type: updated.type,
        parent: updated.parent,
        primary_color: updated.color,
        node_key: updated.node_key,
        attributes: serializeAttributes(updated.attributes),
      })
    } catch (err) {
      console.error("Failed to update schema:", err)
    }
  },

  addSchema: async (schema) => {
    // Optimistic add
    set((s) => ({ schemas: [...s.schemas, schema] }))

    if (isMocksEnabled()) return

    try {
      const res = await api.post<{ ref_id?: string }>("/schema", {
        type: schema.type,
        parent: schema.parent,
        primary_color: schema.color,
        node_key: schema.node_key,
        attributes: serializeAttributes(schema.attributes),
      })

      // Update with real ref_id from server
      if (res.ref_id) {
        set((s) => ({
          schemas: s.schemas.map((x) =>
            x.ref_id === schema.ref_id ? { ...x, ref_id: res.ref_id! } : x
          ),
        }))
      }
    } catch (err) {
      console.error("Failed to create schema:", err)
      // Rollback
      set((s) => ({ schemas: s.schemas.filter((x) => x.ref_id !== schema.ref_id) }))
    }
  },

  removeSchema: async (refId) => {
    const prev = useSchemaStore.getState().schemas
    // Optimistic remove
    set((s) => ({ schemas: s.schemas.filter((x) => x.ref_id !== refId) }))

    if (isMocksEnabled()) return

    try {
      await api.delete(`/schema/${refId}`)
    } catch (err) {
      console.error("Failed to delete schema:", err)
      // Rollback
      set({ schemas: prev })
    }
  },

  fetchAll: async () => {
    set({ loading: true })
    try {
      const res = await api.get<{
        schemas: Array<{
          ref_id: string
          type: string
          parent?: string
          primary_color?: string
          secondary_color?: string
          node_key?: string
          title_key?: string
          index?: string
          description_key?: string
          icon?: string
          attributes?: Record<string, unknown>
        }>
        edges: SchemaEdge[]
      }>("/schema/all")

      const schemas: SchemaNode[] = (res.schemas ?? []).map((s) => ({
        ref_id: s.ref_id,
        type: s.type ?? "",
        parent: s.parent ?? "",
        color: s.primary_color ?? "#64748b",
        secondary_color: s.secondary_color,
        node_key: s.node_key ?? "name",
        title_key: s.title_key,
        index: s.index,
        description_key: s.description_key,
        icon: s.icon,
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
