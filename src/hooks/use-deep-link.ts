"use client"
import { useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { getNode } from "@/lib/graph-api"
import { useGraphStore } from "@/stores/graph-store"
import { isMocksEnabled, MOCK_FULL_NODES } from "@/lib/mock-data"

export function useDeepLink(): void {
  const searchParams = useSearchParams()
  const refId = searchParams.get("id") ?? ""

  useEffect(() => {
    if (!refId) return
    const controller = new AbortController()
    ;(async () => {
      try {
        let node
        if (isMocksEnabled()) {
          const mock = MOCK_FULL_NODES[refId]
          node = mock?.nodes?.[0] ?? null
        } else {
          node = await getNode(refId, undefined, controller.signal)
        }
        if (!node || controller.signal.aborted) return
        useGraphStore.getState().setGraphData([node], [])
        useGraphStore.getState().setSelectedNode(node)
      } catch {
        // Invalid ref_id or network error — app loads normally
      }
    })()
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refId])
}
