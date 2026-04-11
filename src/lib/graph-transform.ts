import type { GraphNode, GraphEdge } from "@/lib/graph-api"
import type { RawNode, RawEdge } from "@/graph-viz-kit"
import type { SchemaNode } from "@/app/ontology/page"

const DISPLAY_KEY_FALLBACKS = ["name", "title", "label", "text", "content", "body"]

function pickString(
  props: Record<string, unknown> | undefined,
  key: string | undefined
): string | undefined {
  if (!props || !key) return undefined
  const v = props[key]
  return typeof v === "string" && v.length > 0 ? v : undefined
}

export function apiNodesToRawNodes(nodes: GraphNode[], schemas: SchemaNode[]): RawNode[] {
  return nodes.map((node) => {
    const schema = schemas.find((s) => s.type === node.node_type)
    const props = node.properties as Record<string, unknown> | undefined
    let label =
      pickString(props, schema?.title_key) ?? pickString(props, schema?.index)
    if (!label) {
      for (const key of DISPLAY_KEY_FALLBACKS) {
        label = pickString(props, key)
        if (label) break
      }
    }
    return { id: node.ref_id, label: label ?? node.ref_id }
  })
}

export function apiEdgesToRawEdges(edges: GraphEdge[]): RawEdge[] {
  return edges.map((e) => ({
    source: e.source,
    target: e.target,
    label: e.edge_type,
  }))
}
