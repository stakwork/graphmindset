"use client"

import { useEffect, useRef } from "react"
import { useGraphStore } from "@/stores/graph-store"
import { getNode } from "@/lib/graph-api"
import { isMocksEnabled, MOCK_FULL_NODES } from "@/lib/mock-data"

// Whenever the user picks a node — from the sidebar (sidebarSelectedNode) OR
// from the graph surface (selectedNode, set by the canvas click handler) —
// fetch its 1-hop neighborhood (cross edges + children/chunks) and append
// (deduped) into the graph store. addNodes never bumps dataVersion, so the
// append merges into the current view rather than resetting it.
//
// A single fetchedRef set is shared across both selection sources, so a node
// reached first from the graph and later from the sidebar (or vice versa)
// fetches exactly once.
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
      const store = useGraphStore.getState()
      store.beginNeighborLoad(refId)
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

    if (selectedNode) fetchNeighbors(selectedNode.ref_id)
    if (sidebarSelectedNode) fetchNeighbors(sidebarSelectedNode.ref_id)
  }, [selectedNode, sidebarSelectedNode])
}
