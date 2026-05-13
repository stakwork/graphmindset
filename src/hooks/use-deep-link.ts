"use client"
import { useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { api } from "@/lib/api"
import type { GraphData, GraphNode } from "@/lib/graph-api"
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
        let node: GraphNode | null = null
        if (isMocksEnabled()) {
          const mock = MOCK_FULL_NODES[refId]
          node = mock?.nodes?.[0] ?? null
        } else {
          const result = await api.get<GraphData>(
            `/v2/nodes/${refId}?preview=1`,
            undefined,
            controller.signal,
          )
          node = result.nodes?.[0] ?? null
        }
        if (!node || controller.signal.aborted) return
        useGraphStore.getState().setGraphData([node], [])
        useGraphStore.getState().setSelectedNode(node)
      } catch (err) {
        if (controller.signal.aborted) return
        if (err && typeof err === "object" && (err as { status?: number }).status === 402) {
          try {
            const body = await (err as { json: () => Promise<{ node?: GraphNode }> }).json()
            const basicNode = body?.node as GraphNode | null
            if (basicNode && !controller.signal.aborted) {
              useGraphStore.getState().setGraphData([basicNode], [])
              useGraphStore.getState().setSelectedNode(basicNode)
            }
          } catch {
            // 402 body parse failed — app loads normally
          }
        }
        // All other errors (invalid ref_id, network) — app loads normally
      }
    })()
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refId])
}
