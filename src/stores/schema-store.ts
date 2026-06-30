"use client"

import { create } from "zustand"
import type { SchemaNode, SchemaEdge } from "@/lib/schema-types"
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
  addSchema: (schema: SchemaNode) => Promise<string>
  removeSchema: (refId: string) => Promise<void>
  addEdge: (edge: SchemaEdge) => Promise<void>
  updateEdge: (edge: SchemaEdge) => Promise<void>
  removeEdge: (refId: string) => Promise<void>
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
        node_key: updated.node_key
          ? updated.node_key.replace(new RegExp(`^${updated.type.toLowerCase()}-`), "")
          : updated.node_key,
        title_key: updated.title_key ?? null,
        description_key: updated.description_key ?? null,
        attributes: serializeAttributes(updated.attributes),
        // Only sent when set (Domains editor) so the ontology editor's behavior
        // — backend defaulting domain to "entity" — is left untouched.
        ...(updated.domain ? { domain: updated.domain } : {}),
      })
    } catch (err) {
      // Rollback optimistic update
      set((s) => ({
        schemas: s.schemas.map((x) => (x.ref_id === updated.ref_id ? updated : x)),
      }))
      const body = err instanceof Response ? await err.json().catch(() => ({})) : {}
      throw new Error((body as { message?: string }).message || "Failed to save schema")
    }
  },

  addSchema: async (schema) => {
    // Optimistic add
    set((s) => ({ schemas: [...s.schemas, schema] }))

    if (isMocksEnabled()) return schema.ref_id

    try {
      const res = await api.post<{ ref_id?: string }>("/schema", {
        type: schema.type,
        parent: schema.parent,
        primary_color: schema.color,
        node_key: schema.node_key,
        attributes: serializeAttributes(schema.attributes),
        // Only sent when set (Domains editor). Without it the backend defaults
        // domain to "entity", so a root type would not register as its own domain.
        ...(schema.domain ? { domain: schema.domain } : {}),
      })

      // Update with real ref_id from server
      if (res.ref_id) {
        set((s) => ({
          schemas: s.schemas.map((x) =>
            x.ref_id === schema.ref_id ? { ...x, ref_id: res.ref_id! } : x
          ),
        }))
      }
      return res.ref_id ?? schema.ref_id
    } catch (err) {
      // Rollback
      set((s) => ({ schemas: s.schemas.filter((x) => x.ref_id !== schema.ref_id) }))
      const body = err instanceof Response ? await err.json().catch(() => ({})) : {}
      throw new Error((body as { message?: string }).message || "Failed to save schema")
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

  addEdge: async (edge) => {
    // Optimistic add
    set((s) => ({ edges: [...s.edges, edge] }))

    if (isMocksEnabled()) return

    try {
      // The backend keys edge schemas off type NAMES, not ref_ids.
      const res = await api.post<{ ref_id?: string }>("/schema/edge", {
        source: edge.source_type ?? edge.source,
        target: edge.target_type ?? edge.target,
        edge_type: edge.edge_type,
        ...(edge.attributes && Object.keys(edge.attributes).length
          ? { attributes: edge.attributes }
          : {}),
      })

      // Replace the optimistic temp ref_id with the server's.
      if (res.ref_id) {
        set((s) => ({
          edges: s.edges.map((x) =>
            x.ref_id === edge.ref_id ? { ...x, ref_id: res.ref_id! } : x
          ),
        }))
      }
    } catch (err) {
      // Rollback
      set((s) => ({ edges: s.edges.filter((x) => x.ref_id !== edge.ref_id) }))
      const body = err instanceof Response ? await err.json().catch(() => ({})) : {}
      throw new Error(
        (body as { message?: string }).message || "Failed to save relationship"
      )
    }
  },

  updateEdge: async (edge) => {
    const prev = useSchemaStore.getState().edges
    // Optimistic update
    set((s) => ({
      edges: s.edges.map((x) => (x.ref_id === edge.ref_id ? edge : x)),
    }))

    if (isMocksEnabled()) return

    try {
      await api.put(`/schema/edge/${edge.ref_id}`, {
        edge_type: edge.edge_type,
        attributes: edge.attributes ?? {},
      })
    } catch (err) {
      // Rollback
      set({ edges: prev })
      const body = err instanceof Response ? await err.json().catch(() => ({})) : {}
      throw new Error(
        (body as { message?: string }).message || "Failed to update relationship"
      )
    }
  },

  removeEdge: async (refId) => {
    const prev = useSchemaStore.getState().edges
    // Optimistic remove
    set((s) => ({ edges: s.edges.filter((x) => x.ref_id !== refId) }))

    if (isMocksEnabled()) return

    try {
      await api.delete(`/schema/edge/${refId}`)
    } catch (err) {
      console.error("Failed to delete relationship:", err)
      // Rollback
      set({ edges: prev })
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
          domain?: string
          primary_color?: string
          secondary_color?: string
          node_key?: string
          title_key?: string
          index?: string
          description_key?: string
          icon?: string
          attributes?: Record<string, unknown>
          inherited_attributes?: Record<string, unknown>
          paid_properties?: string[]
        }>
        edges: SchemaEdge[]
      }>("/schema/all")

      const schemas: SchemaNode[] = (res.schemas ?? []).map((s) => ({
        ref_id: s.ref_id,
        type: s.type ?? "",
        parent: s.parent ?? "",
        domain: s.domain,
        color: s.primary_color ?? "#64748b",
        secondary_color: s.secondary_color,
        node_key: s.node_key ?? "name",
        title_key: s.title_key,
        index: s.index,
        description_key: s.description_key,
        icon: s.icon,
        attributes: parseAttributes(s.attributes),
        inherited_attributes: parseAttributes(s.inherited_attributes as Record<string, unknown> | undefined),
        paid_properties: Array.isArray(s.paid_properties) ? (s.paid_properties as string[]) : undefined,
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
