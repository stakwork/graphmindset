import type { GraphNode, GraphEdge } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"
import { resolveNodeTitle } from "@/lib/node-display"
import type { SigEntity, SigEdge, SigDataset } from "./types"
import {
  TYPE_HUES,
  KIND_RADIUS,
  DEFAULT_KIND_RADIUS,
  SELECTED_SCALE,
  C,
} from "./constants"
import { layoutRing, computeWorldBBox } from "./layout"

interface BuildArgs {
  selectedRefId: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  schemas: SchemaNode[]
}

export function buildCaseDataset({
  selectedRefId,
  nodes,
  edges,
  schemas,
}: BuildArgs): SigDataset | null {
  const selectedNode = nodes.find((n) => n.ref_id === selectedRefId)
  if (!selectedNode) return null

  // 1-hop neighbors: any node connected to selected by one edge in either
  // direction. The backend returns the union via expand=edges; we just need to
  // map source/target → neighbor refs.
  const neighborRefIds = new Set<string>()
  for (const e of edges) {
    if (e.source === selectedRefId) neighborRefIds.add(e.target)
    if (e.target === selectedRefId) neighborRefIds.add(e.source)
  }

  const byId = new Map<string, SigEntity>()
  const flat: SigEntity[] = []

  function toSig(node: GraphNode, isSelected: boolean): SigEntity {
    const type = node.node_type || "Unknown"
    const baseR = KIND_RADIUS[type] ?? DEFAULT_KIND_RADIUS
    const r = isSelected ? baseR * SELECTED_SCALE : baseR
    const color = TYPE_HUES[type] ?? C.accent
    return {
      id: node.ref_id,
      name: resolveNodeTitle(node, schemas),
      kind: type,
      isSelected,
      x: 0,
      y: 0,
      r,
      color,
      node,
    }
  }

  const selectedSig = toSig(selectedNode, true)
  byId.set(selectedSig.id, selectedSig)
  flat.push(selectedSig)

  const neighbors: SigEntity[] = []
  for (const refId of neighborRefIds) {
    const node = nodes.find((n) => n.ref_id === refId)
    if (!node) continue
    const sig = toSig(node, false)
    byId.set(sig.id, sig)
    flat.push(sig)
    neighbors.push(sig)
  }

  layoutRing(selectedSig, neighbors)

  const sigEdges: SigEdge[] = []
  const seen = new Set<string>()
  for (const e of edges) {
    const from = byId.get(e.source)
    const to = byId.get(e.target)
    if (!from || !to || from === to) continue
    const key = `${e.source}→${e.target}→${e.edge_type}`
    if (seen.has(key)) continue
    seen.add(key)
    sigEdges.push({
      id: key,
      fromId: e.source,
      toId: e.target,
      from,
      to,
      label: e.edge_type,
    })
  }

  return {
    selectedId: selectedSig.id,
    selected: selectedSig,
    byId,
    flat,
    edges: sigEdges,
    worldBBox: computeWorldBBox(flat),
  }
}
