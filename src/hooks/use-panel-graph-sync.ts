"use client"

import { useEffect, useRef } from "react"
import { api } from "@/lib/api"
import { isMocksEnabled, MOCK_CONTENT, MOCK_SOURCES, MOCK_WORKFLOW_MARKETPLACE } from "@/lib/mock-data"
import { useAppStore } from "@/stores/app-store"
import { useGraphStore } from "@/stores/graph-store"
import { useUserStore } from "@/stores/user-store"
import type { Source } from "@/stores/sources-store"
import type { GraphNode, GraphEdge, WorkflowMarketplaceItem } from "@/lib/graph-api"
import { getWorkflowMarketplace } from "@/lib/graph-api"

interface ContentResponse {
  nodes: GraphNode[]
  totalCount: number
  totalProcessing: number
}

interface SourcesResponse {
  data: Source[]
}

type Snapshot = { nodes: GraphNode[]; edges: GraphEdge[] } | null

function sourceToNode(s: Source): GraphNode {
  return {
    ref_id: s.ref_id,
    node_type: "Source",
    properties: {
      source: s.source,
      source_type: s.source_type,
      name: s.source,
      topics: s.topics,
    },
  }
}

function workflowToNode(w: WorkflowMarketplaceItem): GraphNode {
  return {
    ref_id: w.ref_id,
    node_type: "Workflow",
    properties: {
      name: w.label || w.source_type,
      source_type: w.source_type,
      kind: w.kind,
      enabled: w.enabled,
    },
  }
}

export function usePanelGraphSync() {
  const myContentOpen = useAppStore((s) => s.myContentOpen)
  const sourcesOpen = useAppStore((s) => s.sourcesOpen)
  const workflowsOpen = useAppStore((s) => s.workflowsOpen)
  const pubKey = useUserStore((s) => s.pubKey)

  const snapshot = useRef<Snapshot>(null)
  const activePanel = useRef<"mycontent" | "sources" | "workflows" | null>(null)

  useEffect(() => {
    const next: "mycontent" | "sources" | "workflows" | null = myContentOpen
      ? "mycontent"
      : sourcesOpen
        ? "sources"
        : workflowsOpen
          ? "workflows"
          : null

    if (next === activePanel.current) return

    if (next !== null && activePanel.current === null) {
      const { nodes, edges } = useGraphStore.getState()
      snapshot.current = { nodes, edges }
    }

    activePanel.current = next

    if (next === null) {
      if (snapshot.current) {
        useGraphStore.getState().setGraphData(snapshot.current.nodes, snapshot.current.edges)
        snapshot.current = null
      }
      return
    }

    let cancelled = false

    async function load() {
      try {
        if (next === "mycontent") {
          if (isMocksEnabled()) {
            if (!cancelled) useGraphStore.getState().setGraphData(MOCK_CONTENT.nodes, [])
            return
          }
          if (!pubKey) {
            if (!cancelled) useGraphStore.getState().setGraphData([], [])
            return
          }
          const res = await api.get<ContentResponse>(`/v2/content?sort_by=date&limit=100`)
          if (!cancelled) useGraphStore.getState().setGraphData(res.nodes ?? [], [])
        } else if (next === "sources") {
          if (isMocksEnabled()) {
            const nodes = MOCK_SOURCES.map(sourceToNode)
            if (!cancelled) useGraphStore.getState().setGraphData(nodes, [])
            return
          }
          const res = await api.get<SourcesResponse>(`/radar?skip=0&limit=500`)
          const nodes = (res.data ?? []).map(sourceToNode)
          if (!cancelled) useGraphStore.getState().setGraphData(nodes, [])
        } else if (next === "workflows") {
          if (isMocksEnabled()) {
            const nodes = MOCK_WORKFLOW_MARKETPLACE.map(workflowToNode)
            if (!cancelled) useGraphStore.getState().setGraphData(nodes, [])
            return
          }
          const items = await getWorkflowMarketplace()
          const nodes = items.map(workflowToNode)
          if (!cancelled) useGraphStore.getState().setGraphData(nodes, [])
        }
      } catch {
        // Silent — panel itself surfaces its own errors; the graph just stays empty.
      }
    }

    load()
    return () => { cancelled = true }
  }, [myContentOpen, sourcesOpen, workflowsOpen, pubKey])
}
