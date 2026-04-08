"use client"

import { useEffect, useMemo, useRef } from "react"
import dagre from "dagre"
import { zoom as d3Zoom, zoomIdentity, ZoomBehavior, ZoomTransform } from "d3-zoom"
import { select as d3Select } from "d3-selection"
import "d3-transition"
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SchemaNode, SchemaEdge } from "./page"

const NODE_WIDTH = 160
const NODE_HEIGHT = 56
const PADDING = 60

interface Props {
  schemas: SchemaNode[]
  edges: SchemaEdge[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function buildLayout(schemas: SchemaNode[], edges: SchemaEdge[]) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: "TB",
    ranksep: 80,
    nodesep: 40,
    marginx: PADDING,
    marginy: PADDING,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const s of schemas) {
    g.setNode(s.ref_id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }

  // Add all edges — CHILD_OF edges form the hierarchy, rest are relationships
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target, { label: e.edge_type })
    }
  }

  // Fallback: if no CHILD_OF edges, build hierarchy from parent field
  const hasChildOfEdges = edges.some((e) => e.edge_type === "CHILD_OF")
  if (!hasChildOfEdges) {
    for (const s of schemas) {
      if (s.parent) {
        const parentNode = schemas.find((p) => p.type === s.parent)
        if (parentNode) {
          g.setEdge(parentNode.ref_id, s.ref_id)
        }
      }
    }
  }

  dagre.layout(g)
  return g
}

function edgePath(
  g: dagre.graphlib.Graph,
  source: string,
  target: string,
  isHierarchy: boolean
): string {
  const s = g.node(source)
  const t = g.node(target)
  if (!s || !t) return ""

  if (isHierarchy) {
    // Straight line for parent-child
    return `M ${s.x} ${s.y + NODE_HEIGHT / 2} L ${t.x} ${t.y - NODE_HEIGHT / 2}`
  }

  // Curved line for relationships
  const dx = t.x - s.x
  const dy = t.y - s.y
  const cx = s.x + dx * 0.5 + dy * 0.15
  const cy = s.y + dy * 0.5 - dx * 0.15
  return `M ${s.x} ${s.y} Q ${cx} ${cy} ${t.x} ${t.y}`
}

export function OntologyGraph({ schemas, edges, selectedId, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown>>(null)
  const containerRef = useRef<SVGGElement>(null)

  const g = useMemo(() => buildLayout(schemas, edges), [schemas, edges])

  const graphInfo = useMemo(() => {
    const graph = g.graph()
    return {
      width: (graph.width ?? 800) + PADDING * 2,
      height: (graph.height ?? 600) + PADDING * 2,
    }
  }, [g])

  // Build hierarchy set for distinguishing edge types
  const hierarchyEdges = useMemo(() => {
    const set = new Set<string>()
    for (const e of edges) {
      if (e.edge_type === "CHILD_OF") {
        set.add(`${e.source}→${e.target}`)
      }
    }
    // Fallback from parent field if no CHILD_OF edges
    if (set.size === 0) {
      for (const s of schemas) {
        if (s.parent) {
          const parent = schemas.find((p) => p.type === s.parent)
          if (parent) set.add(`${parent.ref_id}→${s.ref_id}`)
        }
      }
    }
    return set
  }, [schemas, edges])

  // Compute the fit-to-graph transform
  function getFitTransform(svgWidth: number, svgHeight: number): ZoomTransform {
    const scaleX = svgWidth / graphInfo.width
    const scaleY = svgHeight / graphInfo.height
    const scale = Math.max(Math.min(scaleX, scaleY, 1), 0.1) // don't upscale beyond 1x, clamp minimum to 0.1
    const tx = (svgWidth - graphInfo.width * scale) / 2
    const ty = (svgHeight - graphInfo.height * scale) / 2
    return zoomIdentity.translate(tx, ty).scale(scale)
  }

  // Mount: set up zoom behavior
  useEffect(() => {
    if (!svgRef.current) return

    const rect = svgRef.current.getBoundingClientRect()
    const svgWidth = rect.width || 800
    const svgHeight = rect.height || 600

    const zoom = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .on("zoom", (event) => {
        if (containerRef.current) {
          d3Select(containerRef.current).attr("transform", event.transform.toString())
        }
      })

    d3Select(svgRef.current).call(zoom)
    zoomRef.current = zoom

    // Apply initial fit transform immediately (no animation)
    const fitTransform = getFitTransform(svgWidth, svgHeight)
    d3Select(svgRef.current).call(zoom.transform, fitTransform)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-fit when graph layout changes (schemas/edges change)
  useEffect(() => {
    if (!svgRef.current || !zoomRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const svgWidth = rect.width || 800
    const svgHeight = rect.height || 600
    const fitTransform = getFitTransform(svgWidth, svgHeight)
    d3Select(svgRef.current)
      .transition()
      .duration(300)
      .call(zoomRef.current.transform, fitTransform)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphInfo])

  // Select-to-focus: animate to center the selected node
  useEffect(() => {
    if (!selectedId || !svgRef.current || !zoomRef.current) return
    const node = g.node(selectedId)
    if (!node) return

    const rect = svgRef.current.getBoundingClientRect()
    const svgWidth = rect.width || 800
    const svgHeight = rect.height || 600

    const currentTransform = (d3Select(svgRef.current).property("__zoom") as ZoomTransform | null) ?? zoomIdentity
    const targetScale = currentTransform.k < 2.0 ? 2.0 : currentTransform.k

    const tx = svgWidth / 2 - node.x * targetScale
    const ty = svgHeight / 2 - node.y * targetScale
    const newTransform = zoomIdentity.translate(tx, ty).scale(targetScale)

    d3Select(svgRef.current)
      .transition()
      .duration(450)
      .call(zoomRef.current.transform, newTransform)
  }, [selectedId, g])

  function handleZoomIn() {
    if (!svgRef.current || !zoomRef.current) return
    d3Select(svgRef.current).transition().duration(200).call(zoomRef.current.scaleBy, 1.3)
  }

  function handleZoomOut() {
    if (!svgRef.current || !zoomRef.current) return
    d3Select(svgRef.current).transition().duration(200).call(zoomRef.current.scaleBy, 1 / 1.3)
  }

  function handleFit() {
    if (!svgRef.current || !zoomRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const svgWidth = rect.width || 800
    const svgHeight = rect.height || 600
    const fitTransform = getFitTransform(svgWidth, svgHeight)
    d3Select(svgRef.current).transition().duration(300).call(zoomRef.current.transform, fitTransform)
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[oklch(0.06_0.02_260)]">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
      >
        <defs>
          <marker
            id="arrowhead"
            viewBox="0 0 10 7"
            refX="10"
            refY="3.5"
            markerWidth="8"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <polygon
              points="0 0, 10 3.5, 0 7"
              fill="oklch(0.4 0.02 260)"
            />
          </marker>
          <marker
            id="arrowhead-rel"
            viewBox="0 0 10 7"
            refX="10"
            refY="3.5"
            markerWidth="8"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <polygon
              points="0 0, 10 3.5, 0 7"
              fill="oklch(0.5 0.1 200)"
            />
          </marker>
        </defs>

        {/* All transformable content inside a single <g> for d3-zoom */}
        <g ref={containerRef}>
          {/* Grid background */}
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="oklch(0.15 0.02 260)"
              strokeWidth="0.5"
            />
          </pattern>
          <rect
            x={-graphInfo.width * 10}
            y={-graphInfo.height * 10}
            width={graphInfo.width * 20}
            height={graphInfo.height * 20}
            fill="url(#grid)"
          />

          {/* Hierarchy edges (CHILD_OF) */}
          {edges.filter((e) => e.edge_type === "CHILD_OF").map((e) => {
            const d = edgePath(g, e.target, e.source, true)
            return (
              <path
                key={`h-${e.ref_id}`}
                d={d}
                fill="none"
                stroke="oklch(0.3 0.02 260)"
                strokeWidth="1.5"
                strokeDasharray="6 4"
                markerEnd="url(#arrowhead)"
              />
            )
          })}

          {/* Relationship edges */}
          {edges.map((e) => {
            const key = `${e.source}→${e.target}`
            if (hierarchyEdges.has(key)) return null
            const d = edgePath(g, e.source, e.target, false)
            const sourceNode = g.node(e.source)
            const targetNode = g.node(e.target)
            if (!sourceNode || !targetNode) return null

            const mx = (sourceNode.x + targetNode.x) / 2
            const my = (sourceNode.y + targetNode.y) / 2
            const dx = targetNode.x - sourceNode.x
            const dy = targetNode.y - sourceNode.y
            const labelX = mx + dy * 0.075
            const labelY = my - dx * 0.075

            return (
              <g key={`r-${e.ref_id}`}>
                <path
                  d={d}
                  fill="none"
                  stroke="oklch(0.45 0.1 200)"
                  strokeWidth="1"
                  strokeDasharray="4 3"
                  markerEnd="url(#arrowhead-rel)"
                  opacity={0.6}
                />
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="text-[9px] font-mono"
                  fill="oklch(0.5 0.08 200)"
                >
                  {e.edge_type}
                </text>
              </g>
            )
          })}

          {/* Nodes */}
          {schemas.map((s) => {
            const node = g.node(s.ref_id)
            if (!node) return null
            const x = node.x - NODE_WIDTH / 2
            const y = node.y - NODE_HEIGHT / 2
            const isSelected = s.ref_id === selectedId
            const attrCount = s.attributes.length

            return (
              <g
                key={s.ref_id}
                onClick={() => onSelect(s.ref_id)}
                className="cursor-pointer"
              >
                {/* Outer halo for selected */}
                {isSelected && (
                  <rect
                    x={x - 8}
                    y={y - 8}
                    width={NODE_WIDTH + 16}
                    height={NODE_HEIGHT + 16}
                    rx={16}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="1"
                    opacity={0.2}
                  />
                )}

                {/* Inner glow for selected */}
                {isSelected && (
                  <rect
                    x={x - 3}
                    y={y - 3}
                    width={NODE_WIDTH + 6}
                    height={NODE_HEIGHT + 6}
                    rx={12}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="3"
                    opacity={0.7}
                  />
                )}

                {/* Card background */}
                <rect
                  x={x}
                  y={y}
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx={10}
                  fill="oklch(0.12 0.02 260)"
                  stroke={isSelected ? s.color : "oklch(0.22 0.02 260)"}
                  strokeWidth={isSelected ? 1.5 : 1}
                />

                {/* Color bar */}
                <rect
                  x={x}
                  y={y}
                  width={4}
                  height={NODE_HEIGHT}
                  rx={2}
                  fill={s.color}
                />

                {/* Type name */}
                <text
                  x={x + 16}
                  y={y + 22}
                  className="text-[13px] font-semibold"
                  fill="oklch(0.9 0.01 260)"
                >
                  {s.type}
                </text>

                {/* Attribute count */}
                <text
                  x={x + 16}
                  y={y + 40}
                  className="text-[10px] font-mono"
                  fill="oklch(0.5 0.02 260)"
                >
                  {attrCount} attr{attrCount !== 1 ? "s" : ""}
                  {s.parent ? ` · ${s.parent}` : ""}
                </text>

                {/* Attribute count badge */}
                <rect
                  x={x + NODE_WIDTH - 28}
                  y={y + 8}
                  width={20}
                  height={16}
                  rx={4}
                  fill="oklch(0.18 0.02 260)"
                />
                <text
                  x={x + NODE_WIDTH - 18}
                  y={y + 19}
                  textAnchor="middle"
                  className="text-[9px] font-mono"
                  fill="oklch(0.55 0.02 260)"
                >
                  {attrCount}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      {/* Zoom controls overlay */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        <Button size="sm" variant="ghost" onClick={handleZoomIn} className="h-8 w-8 p-0">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={handleZoomOut} className="h-8 w-8 p-0">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={handleFit} className="h-8 w-8 p-0">
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
