"use client"

import { create } from "zustand"
import type { GraphNode, GraphEdge } from "@/lib/graph-api"

interface GraphState {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNode: GraphNode | null
  loading: boolean
  purchasedNodeIds: Set<string>
  setGraphData: (nodes: GraphNode[], edges: GraphEdge[]) => void
  setSelectedNode: (node: GraphNode | null) => void
  setLoading: (loading: boolean) => void
  addNodes: (nodes: GraphNode[], edges: GraphEdge[]) => void
  setPurchasedNodeIds: (ids: string[]) => void
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  edges: [],
  selectedNode: null,
  loading: false,
  purchasedNodeIds: new Set<string>(),
  setGraphData: (nodes, edges) => set({ nodes, edges }),
  setSelectedNode: (selectedNode) => set({ selectedNode }),
  setLoading: (loading) => set({ loading }),
  addNodes: (newNodes, newEdges) =>
    set((s) => ({
      nodes: [...s.nodes, ...newNodes],
      edges: [...s.edges, ...newEdges],
    })),
  setPurchasedNodeIds: (ids) => set({ purchasedNodeIds: new Set(ids) }),
}))
