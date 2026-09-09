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
  // Bumps only on full replacement (setGraphData / setFocusGraph). Consumers
  // that only care about "new dataset" semantics should depend on this, not on
  // nodes/edges, so appends via addNodes don't trigger a view reset.
  dataVersion: number
  // Sidebar selection swaps the canvas to a brand-new graph: the picked node
  // plus its 1-hop neighborhood, laid out fresh around it. `nodes`/`edges`
  // (the search results) are kept untouched so the sidebar list survives;
  // the canvas renders `focusGraph` while it is set. Cleared by
  // clearSelection and by a new search (setGraphData).
  focusGraph: FocusGraph | null
  setFocusGraph: (focus: FocusGraph | null) => void
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

export interface FocusGraph {
  rootRefId: string
  nodes: GraphNode[]
  edges: GraphEdge[]
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
  focusGraph: null,
  setFocusGraph: (focusGraph) =>
    set((s) => {
      if (focusGraph === null && s.focusGraph === null) return s
      return { focusGraph, dataVersion: s.dataVersion + 1 }
    }),
  setGraphData: (nodes, edges) =>
    set((s) => ({ nodes, edges, focusGraph: null, dataVersion: s.dataVersion + 1 })),
  setSelectedNode: (selectedNode) => set({ selectedNode }),
  setLoading: (loading) => set({ loading }),
  // Appends into whichever graph the canvas is currently showing: the focus
  // graph while a sidebar pick is active, otherwise the search results.
  addNodes: (newNodes, newEdges) =>
    set((s) => {
      const target = s.focusGraph ?? s
      const existingRefIds = new Set(target.nodes.map((n) => n.ref_id))
      const uniqueNodes = newNodes.filter((n) => !existingRefIds.has(n.ref_id))
      const existingEdgeKeys = new Set(target.edges.map(edgeKey))
      const uniqueEdges = newEdges.filter((e) => !existingEdgeKeys.has(edgeKey(e)))
      if (uniqueNodes.length === 0 && uniqueEdges.length === 0) return s
      const nodes = uniqueNodes.length > 0 ? [...target.nodes, ...uniqueNodes] : target.nodes
      const edges = uniqueEdges.length > 0 ? [...target.edges, ...uniqueEdges] : target.edges
      if (s.focusGraph) return { focusGraph: { ...s.focusGraph, nodes, edges } }
      return { nodes, edges }
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
    set((s) => ({
      selectedNode: null,
      sidebarSelectedNode: null,
      hoveredNode: null,
      focusGraph: null,
      // Dropping the focus graph puts the search results back on the canvas —
      // a full dataset swap, so bump like setGraphData does.
      dataVersion: s.focusGraph ? s.dataVersion + 1 : s.dataVersion,
    })),
  returnTo: null,
  setReturnTo: (returnTo) => set({ returnTo }),
}))
