import { api } from "./api"

export type NodeInsight = {
  ref_id: string
  unlock_count: number
  sats_earned: number
  previous_unlock_count: number
}

export type CreatorInsightsResponse = {
  period: "week" | "month"
  total_sats_earned: number
  total_unlocks: number
  nodes: NodeInsight[]
}

export async function fetchCreatorInsights(
  period: "week" | "month"
): Promise<CreatorInsightsResponse> {
  return api.get(`/lsat/creator/insights?period=${period}`)
}

export function getGrowthBadge(
  current: number,
  previous: number
): "up" | "flat" | "down" {
  if (current > previous) return "up"
  if (current < previous) return "down"
  return "flat"
}
