"use client"

import { useEffect, useState } from "react"
import { getSchemaIconInfo } from "@/lib/schema-icons"
import { Badge } from "@/components/ui/badge"
import type { GraphNode } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"

const DISPLAY_KEY_FALLBACKS = ["name", "title", "label", "text", "content", "body"] as const
const SNIPPET_KEYS = ["description", "text", "bio", "content", "body"] as const
const CARD_WIDTH = 280
const CARD_HEIGHT_EST = 150
const CURSOR_OFFSET = 16

function pickString(props: Record<string, unknown> | undefined, key: string | undefined): string | undefined {
  if (!props || !key) return undefined
  const v = props[key]
  return typeof v === "string" && v.length > 0 ? v : undefined
}

function getTitle(node: GraphNode, schemas: SchemaNode[]): string {
  const schema = schemas.find((s) => s.type === node.node_type)
  const props = node.properties
  let name = pickString(props, schema?.title_key) ?? pickString(props, schema?.index)
  if (!name) {
    for (const key of DISPLAY_KEY_FALLBACKS) {
      name = pickString(props, key)
      if (name) break
    }
  }
  return name ?? node.ref_id
}

function getSnippet(node: GraphNode, title: string): string | undefined {
  const props = node.properties
  for (const key of SNIPPET_KEYS) {
    const v = pickString(props, key)
    if (v && v !== title) return v
  }
  return undefined
}

interface HoverPreviewCardProps {
  node: GraphNode | null
  schemas: SchemaNode[]
  x: number
  y: number
}

export function HoverPreviewCard({ node, schemas, x, y }: HoverPreviewCardProps) {
  const [viewport, setViewport] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const update = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  if (!node) return null

  const nodeType = node.node_type ?? "Unknown"
  const schema = schemas.find((s) => s.type === nodeType)
  const { icon: Icon, accent } = getSchemaIconInfo(schema?.icon)
  const title = getTitle(node, schemas)
  const snippet = getSnippet(node, title)
  if (!snippet) return null // nothing to add beyond the graph label

  const rightEdge = x + CURSOR_OFFSET + CARD_WIDTH
  const left = rightEdge > viewport.w ? x - CURSOR_OFFSET - CARD_WIDTH : x + CURSOR_OFFSET
  const top = Math.min(Math.max(y + CURSOR_OFFSET, 8), Math.max(viewport.h - CARD_HEIGHT_EST, 8))

  // Drei's <Html> uses a zIndexRange defaulting to [16777271, 0]; we sit above it.
  return (
    <div
      className="pointer-events-none fixed rounded-lg border border-border/60 bg-background p-3 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.8)] noise-bg"
      style={{ left, top, width: CARD_WIDTH, zIndex: 2147483647 }}
    >
      <div className="relative z-10 flex items-start gap-2.5">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border"
          style={{ backgroundColor: `${accent}15`, borderColor: `${accent}30` }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm leading-snug text-foreground">{title}</p>
          <Badge
            variant="outline"
            className="mt-1 h-4 border-border/50 px-1.5 py-0 font-mono text-[9px] text-muted-foreground"
          >
            {nodeType}
          </Badge>
        </div>
      </div>
      {snippet && (
        <p className="relative z-10 mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {snippet}
        </p>
      )}
    </div>
  )
}
