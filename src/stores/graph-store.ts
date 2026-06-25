"use client"

import { create } from "zustand"
import type { GraphNode, GraphEdge } from "@/lib/graph-api"

interface GraphState {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNode: GraphNode | null
  loading: boolean
  hoveredNode: GraphNode | null
  sidebarSelectedNode: GraphNode | null
  // ref_ids whose 1-hop neighborhood is currently being fetched. Drives the
  // "loading connections" indicator; a Set so concurrent expansions coexist.
  loadingNeighborRefs: Set<string>
  // Bumps only on full replacement (setGraphData). Consumers that only care
  // about "new search" semantics should depend on this, not on nodes/edges,
  // so appends via addNodes don't trigger a view reset.
  dataVersion: number
  setGraphData: (nodes: GraphNode[], edges: GraphEdge[]) => void
  setSelectedNode: (node: GraphNode | null) => void
  setLoading: (loading: boolean) => void
  addNodes: (nodes: GraphNode[], edges: GraphEdge[]) => void
  setHoveredNode: (node: GraphNode | null) => void
  setSidebarSelectedNode: (node: GraphNode | null) => void
  beginNeighborLoad: (refId: string) => void
  endNeighborLoad: (refId: string) => void
  removeEdge: (edgeRefId: string) => void
  clearSelection: () => void
  returnTo: string | null
  setReturnTo: (url: string | null) => void
}

function edgeKey(e: GraphEdge): string {
  return `${e.source}\u0000${e.target}\u0000${e.edge_type}`
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  edges: [],
  selectedNode: null,
  loading: false,
  hoveredNode: null,
  sidebarSelectedNode: null,
  loadingNeighborRefs: new Set<string>(),
  dataVersion: 0,
  setGraphData: (nodes, edges) =>
    set((s) => ({ nodes, edges, dataVersion: s.dataVersion + 1 })),
  setSelectedNode: (selectedNode) => set({ selectedNode }),
  setLoading: (loading) => set({ loading }),
  addNodes: (newNodes, newEdges) =>
    set((s) => {
      const existingRefIds = new Set(s.nodes.map((n) => n.ref_id))
      const uniqueNodes = newNodes.filter((n) => !existingRefIds.has(n.ref_id))
      const existingEdgeKeys = new Set(s.edges.map(edgeKey))
      const uniqueEdges = newEdges.filter((e) => !existingEdgeKeys.has(edgeKey(e)))
      if (uniqueNodes.length === 0 && uniqueEdges.length === 0) return s
      return {
        nodes: uniqueNodes.length > 0 ? [...s.nodes, ...uniqueNodes] : s.nodes,
        edges: uniqueEdges.length > 0 ? [...s.edges, ...uniqueEdges] : s.edges,
      }
    }),
  setHoveredNode: (hoveredNode) => set({ hoveredNode }),
  setSidebarSelectedNode: (sidebarSelectedNode) => set({ sidebarSelectedNode }),
  beginNeighborLoad: (refId) =>
    set((s) => {
      if (s.loadingNeighborRefs.has(refId)) return s
      const next = new Set(s.loadingNeighborRefs)
      next.add(refId)
      return { loadingNeighborRefs: next }
    }),
  endNeighborLoad: (refId) =>
    set((s) => {
      if (!s.loadingNeighborRefs.has(refId)) return s
      const next = new Set(s.loadingNeighborRefs)
      next.delete(refId)
      return { loadingNeighborRefs: next }
    }),
  removeEdge: (edgeRefId) =>
    set((s) => ({
      edges: s.edges.filter((e) => e.ref_id !== edgeRefId),
    })),
  clearSelection: () =>
    set({ selectedNode: null, sidebarSelectedNode: null, hoveredNode: null }),
  returnTo: null,
  setReturnTo: (returnTo) => set({ returnTo }),
}))
