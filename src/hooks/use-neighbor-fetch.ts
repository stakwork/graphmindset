"use client"

import { useEffect, useRef } from "react"
import { useGraphStore, type FocusGraph } from "@/stores/graph-store"
import { getNode, type GraphNode, type GraphEdge } from "@/lib/graph-api"
import { isMocksEnabled, MOCK_FULL_NODES } from "@/lib/mock-data"

// Two selection sources, two behaviors:
//
//  • Sidebar pick (sidebarSelectedNode): fetch the node's 1-hop neighborhood
//    and REPLACE the canvas with it (setFocusGraph) — a brand-new graph laid
//    out around the picked node. Nothing from the previous drawing carries
//    over. The search results in `nodes`/`edges` are left alone so the
//    sidebar list keeps working.
//
//  • Canvas click (selectedNode): fetch the same neighborhood and APPEND it
//    (deduped) into whatever the canvas is showing. addNodes never bumps
//    dataVersion, so the append merges into the current view.
//
// A fetchedRef set tracks appended refs so a node clicked twice fetches once;
// it resets whenever the dataset is swapped (dataVersion).
export function useNeighborFetch(): void {
  const selectedNode = useGraphStore((s) => s.selectedNode)
  const sidebarSelectedNode = useGraphStore((s) => s.sidebarSelectedNode)
  const dataVersion = useGraphStore((s) => s.dataVersion)
  const fetchedRef = useRef<Set<string>>(new Set())
  const controllersRef = useRef<Map<string, AbortController>>(new Map())

  // A fresh search replaces the graph; previously-expanded refs may no longer
  // exist, so forget them and cancel any in-flight fetches.
  useEffect(() => {
    fetchedRef.current = new Set()
    for (const c of controllersRef.current.values()) c.abort()
    controllersRef.current = new Map()
    useGraphStore.setState({ loadingNeighborRefs: new Set<string>() })
  }, [dataVersion])

  useEffect(() => {
    const fetched = fetchedRef.current
    const controllers = controllersRef.current

    const fetchNeighbors = (refId: string) => {
      if (fetched.has(refId)) return
      fetched.add(refId)

      if (isMocksEnabled()) {
        const mock = MOCK_FULL_NODES[refId]
        if (mock) {
          useGraphStore.getState().addNodes(mock.nodes ?? [], mock.edges ?? [])
        }
        return
      }

      const controller = new AbortController()
      controllers.set(refId, controller)
      useGraphStore.getState().beginNeighborLoad(refId)
      ;(async () => {
        try {
          const result = await getNode(refId, "edges", controller.signal)
          if (controller.signal.aborted) return
          useGraphStore.getState().addNodes(result.nodes ?? [], result.edges ?? [])
        } catch (err) {
          if (controller.signal.aborted) return
          // Surface (not swallow) so auth/402/network failures are debuggable.
          // Drop the ref so a retry is possible if the user picks it again.
          console.warn("[neighbor-fetch] failed for", refId, err)
          fetched.delete(refId)
        } finally {
          controllers.delete(refId)
          useGraphStore.getState().endNeighborLoad(refId)
        }
      })()
    }

    // Sidebar pick → replace. The feed sets selectedNode AND sidebarSelectedNode
    // for the same node, so skip the append path for that ref — the focus
    // graph already IS its neighborhood.
    const sidebarRef = sidebarSelectedNode?.ref_id ?? null
    if (selectedNode && selectedNode.ref_id !== sidebarRef) {
      fetchNeighbors(selectedNode.ref_id)
    }
  }, [selectedNode, sidebarSelectedNode])

  const focusRef = useRef<string | null>(null)
  useEffect(() => {
    const refId = sidebarSelectedNode?.ref_id ?? null
    if (refId === focusRef.current) return
    focusRef.current = refId
    if (!sidebarSelectedNode || refId === null) return
    const picked = sidebarSelectedNode

    const withRoot = (data: { nodes?: GraphNode[]; edges?: GraphEdge[] }): FocusGraph => {
      const nodes = data.nodes ?? []
      // The neighborhood payload should include the node itself; make sure it
      // does so the layout always has its center.
      const hasRoot = nodes.some((n) => n.ref_id === refId)
      return { rootRefId: refId, nodes: hasRoot ? nodes : [picked, ...nodes], edges: data.edges ?? [] }
    }

    if (isMocksEnabled()) {
      useGraphStore.getState().setFocusGraph(withRoot(MOCK_FULL_NODES[refId] ?? {}))
      return
    }

    const controller = new AbortController()
    useGraphStore.getState().beginNeighborLoad(refId)
    ;(async () => {
      try {
        const result = await getNode(refId, "edges", controller.signal)
        if (controller.signal.aborted) return
        // The user may have moved on while this was in flight.
        if (useGraphStore.getState().sidebarSelectedNode?.ref_id !== refId) return
        useGraphStore.getState().setFocusGraph(withRoot(result))
      } catch (err) {
        if (controller.signal.aborted) return
        console.warn("[neighbor-fetch] focus fetch failed for", refId, err)
      } finally {
        useGraphStore.getState().endNeighborLoad(refId)
      }
    })()
    return () => controller.abort()
  }, [sidebarSelectedNode])
}
