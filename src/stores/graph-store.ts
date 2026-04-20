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
  setGraphData: (nodes: GraphNode[], edges: GraphEdge[]) => void
  setSelectedNode: (node: GraphNode | null) => void
  setLoading: (loading: boolean) => void
  addNodes: (nodes: GraphNode[], edges: GraphEdge[]) => void
  setHoveredNode: (node: GraphNode | null) => void
  setSidebarSelectedNode: (node: GraphNode | null) => void
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  edges: [],
  selectedNode: null,
  loading: false,
  hoveredNode: null,
  sidebarSelectedNode: null,
  setGraphData: (nodes, edges) => set({ nodes, edges }),
  setSelectedNode: (selectedNode) => set({ selectedNode }),
  setLoading: (loading) => set({ loading }),
  addNodes: (newNodes, newEdges) =>
    set((s) => ({
      nodes: [...s.nodes, ...newNodes],
      edges: [...s.edges, ...newEdges],
    })),
  setHoveredNode: (hoveredNode) => set({ hoveredNode }),
  setSidebarSelectedNode: (sidebarSelectedNode) => set({ sidebarSelectedNode }),
}))
