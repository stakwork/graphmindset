"use client"

import { useEffect, useRef } from "react"
import { useGraphStore } from "@/stores/graph-store"
import { getNodeNeighborhood } from "@/lib/graph-api"
import { isMocksEnabled, MOCK_FULL_NODES } from "@/lib/mock-data"

// When the user picks a node from the sidebar, fetch its 1-hop neighborhood
// and append (deduped) into the graph store. Graph-surface clicks don't
// trigger this because they go through selectedNode, not sidebarSelectedNode.
export function useSidebarNeighborFetch(): void {
  const sidebarSelectedNode = useGraphStore((s) => s.sidebarSelectedNode)
  const fetchedRef = useRef<Set<string>>(new Set())
  const dataVersion = useGraphStore((s) => s.dataVersion)

  // A fresh search replaces the graph; previously-expanded refs may no
  // longer exist, so forget them.
  useEffect(() => {
    fetchedRef.current = new Set()
  }, [dataVersion])

  useEffect(() => {
    if (!sidebarSelectedNode) return
    const refId = sidebarSelectedNode.ref_id
    if (fetchedRef.current.has(refId)) return

    const controller = new AbortController()
    fetchedRef.current.add(refId)

    ;(async () => {
      try {
        if (isMocksEnabled()) {
          const mock = MOCK_FULL_NODES[refId]
          if (mock) {
            useGraphStore.getState().addNodes(mock.nodes ?? [], mock.edges ?? [])
          }
          return
        }
        const result = await getNodeNeighborhood(refId, controller.signal)
        if (controller.signal.aborted) return
        useGraphStore.getState().addNodes(result.nodes ?? [], result.edges ?? [])
      } catch {
        // Network/auth/402 errors silently skip — the preview panel still
        // shows metadata. Drop the ref from fetched so a retry is possible
        // if the user picks this node again.
        fetchedRef.current.delete(refId)
      }
    })()

    return () => controller.abort()
  }, [sidebarSelectedNode])
}
