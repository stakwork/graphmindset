import type { GraphNode } from "./graph-api"
import type { SchemaNode } from "@/app/ontology/page"

export const TITLE_MAX_LEN = 120

export function capTitle(str: string, max = TITLE_MAX_LEN): string {
  if (str.length <= max) return str
  return str.slice(0, max).replace(/\s+\S*$/, "") + "…"
}

export const DISPLAY_KEY_FALLBACKS = [
  "name",
  "title",
  "episode_title",
  "show_title",
  "label",
  "text",
  "content",
  "body",
  "source_link",
] as const

export function pickString(
  props: Record<string, unknown> | undefined,
  key: string | undefined
): string | undefined {
  if (!props || !key) return undefined
  const v = props[key]
  return typeof v === "string" && v.length > 0 ? v : undefined
}

export function resolveNodeTitle(node: GraphNode, schemas: SchemaNode[]): string {
  const schema = schemas.find((s) => s.type === (node.node_type ?? "Unknown"))
  const titleKey = schema?.title_key ?? schema?.index
  const fromSchema = pickString(node.properties, titleKey)
  if (fromSchema) return capTitle(fromSchema)
  for (const key of DISPLAY_KEY_FALLBACKS) {
    const v = pickString(node.properties, key)
    if (v) return capTitle(v)
  }
  return node.ref_id
}

export function resolveNodeThumbnail(node: GraphNode): string | undefined {
  return pickString(node.properties, "image_url") ?? pickString(node.properties, "thumbnail")
}
