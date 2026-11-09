import type { StatsResponse } from "@/lib/graph-api"

export interface GraphStat {
  label: string
  value: number
}

// Per-type counts shown only when the graph reports a positive count.
// Add entries here to surface more node types.
export const TYPE_STATS: readonly { key: string; label: string }[] = [
  { key: "cve_count", label: "CVEs" },
]

export function getDisplayStats(stats: Partial<StatsResponse> | null | undefined): GraphStat[] {
  if (!stats || typeof stats.node_count !== "number") return []
  const result: GraphStat[] = [{ label: "Nodes", value: stats.node_count }]
  for (const { key, label } of TYPE_STATS) {
    const value = (stats as Record<string, unknown>)[key]
    if (typeof value === "number" && value > 0) result.push({ label, value })
  }
  return result
}

export function formatStatNumber(n: number): string {
  return n.toLocaleString("en-US")
}
