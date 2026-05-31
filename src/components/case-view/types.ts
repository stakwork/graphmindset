import type { GraphNode } from "@/lib/graph-api"

export type Status = "ACTIVE" | "WARN" | "IDLE"

export interface SigEntity {
  id: string
  name: string
  kind: string
  isSelected: boolean
  x: number
  y: number
  r: number
  color: string
  node: GraphNode
}

export interface SigEdge {
  id: string
  fromId: string
  toId: string
  from: SigEntity
  to: SigEntity
  label?: string
}

export interface SigDataset {
  selectedId: string
  selected: SigEntity
  byId: Map<string, SigEntity>
  flat: SigEntity[]
  edges: SigEdge[]
  worldBBox: { minX: number; minY: number; maxX: number; maxY: number }
}
