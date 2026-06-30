"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import dagre from "dagre"
import { zoom as d3Zoom, zoomIdentity, ZoomBehavior, ZoomTransform } from "d3-zoom"
import { select as d3Select } from "d3-selection"
import "d3-transition"
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SchemaNode, SchemaEdge } from "@/lib/schema-types"
import { getSchemaIcon } from "@/lib/schema-icons"

const NODE_WIDTH = 160
const NODE_HEIGHT = 56
const PADDING = 60
const DIM_OPACITY = 0.22

/** Point on a node card's border along the line from its center toward (towardX, towardY). */
function rectBorderPoint(cx: number, cy: number, towardX: number, towardY: number) {
  const dx = towardX - cx
  const dy = towardY - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const hw = NODE_WIDTH / 2
  const hh = NODE_HEIGHT / 2
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh)
  return { x: cx + dx * scale, y: cy + dy * scale }
}

/** Truncate a label to fit a node card, appending an ellipsis when cut. */
function truncate(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

interface Props {
  schemas: SchemaNode[]
  edges: SchemaEdge[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Clear the selection (Esc / background click) to return to the full view. */
  onClear?: () => void
  selectedEdgeType?: string | null
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

  // Add all edges — CHILD_OF edges are reversed so dagre places parent (Thing) at top
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      if (e.edge_type === "CHILD_OF") {
        // Reverse: dagre sees parent→child so parent ranks higher (top)
        g.setEdge(e.target, e.source, { label: e.edge_type })
      } else {
        g.setEdge(e.source, e.target, { label: e.edge_type })
      }
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

/**
 * Layout for the "selected view": the selected node plus its immediate
 * neighbors only (parent + children via hierarchy, and anything directly
 * related), laid out compactly so the relevant slice is close together.
 */
function buildFocusedLayout(
  schemas: SchemaNode[],
  edges: SchemaEdge[],
  selectedId: string
) {
  const selected = schemas.find((s) => s.ref_id === selectedId)
  if (!selected) return buildLayout(schemas, edges)

  const members = new Set<string>([selectedId])
  let hasChildOf = false
  for (const e of edges) {
    if (e.edge_type === "CHILD_OF") {
      hasChildOf = true
      if (e.target === selectedId) members.add(e.source) // a child of selected
      if (e.source === selectedId) members.add(e.target) // the parent of selected
    } else if (e.source === selectedId) {
      members.add(e.target)
    } else if (e.target === selectedId) {
      members.add(e.source)
    }
  }
  // Fallback to the parent field when there are no CHILD_OF edges.
  if (!hasChildOf) {
    if (selected.parent) {
      const p = schemas.find((s) => s.type === selected.parent)
      if (p) members.add(p.ref_id)
    }
    for (const s of schemas) {
      if (s.parent && s.parent === selected.type) members.add(s.ref_id)
    }
  }

  const memberSchemas = schemas.filter((s) => members.has(s.ref_id))
  const memberEdges = edges.filter((e) => members.has(e.source) && members.has(e.target))
  return buildLayout(memberSchemas, memberEdges)
}

function edgeHierarchyPath(
  g: dagre.graphlib.Graph,
  source: string,
  target: string
): string {
  const s = g.node(source)
  const t = g.node(target)
  if (!s || !t) return ""
  // Straight line for parent-child, anchored to card top/bottom borders.
  return `M ${s.x} ${s.y + NODE_HEIGHT / 2} L ${t.x} ${t.y - NODE_HEIGHT / 2}`
}

export function OntologyGraph({ schemas, edges, selectedId, onSelect, onClear, selectedEdgeType }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown>>(null)
  const containerRef = useRef<SVGGElement>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // Hover takes precedence over selection for connection tracing.
  const focusId = hoveredId ?? selectedId

  // Selecting a node collapses the canvas to a focused view of just that node
  // and its immediate neighbors; otherwise the full ontology is laid out.
  const g = useMemo(
    () => (selectedId ? buildFocusedLayout(schemas, edges, selectedId) : buildLayout(schemas, edges)),
    [schemas, edges, selectedId]
  )

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

  // When a node is focused (hovered or selected), collect its incident edges and
  // neighbor nodes so everything else can be dimmed for connection tracing.
  const { focusNodes, focusEdges } = useMemo(() => {
    if (!focusId) {
      return { focusNodes: null as Set<string> | null, focusEdges: null as Set<string> | null }
    }
    const nodes = new Set<string>([focusId])
    const incident = new Set<string>()
    for (const e of edges) {
      if (e.source === focusId || e.target === focusId) {
        incident.add(e.ref_id)
        nodes.add(e.source)
        nodes.add(e.target)
      }
    }
    return { focusNodes: nodes, focusEdges: incident }
  }, [focusId, edges])

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

  // Esc clears the selection and returns to the full ontology view.
  useEffect(() => {
    if (!selectedId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClear?.()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selectedId, onClear])

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
          {/* Direction-coded arrowheads, used when an edge is incident to the focused node */}
          <marker
            id="arrowhead-out"
            viewBox="0 0 10 7"
            refX="10"
            refY="3.5"
            markerWidth="8"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="oklch(0.72 0.16 200)" />
          </marker>
          <marker
            id="arrowhead-in"
            viewBox="0 0 10 7"
            refX="10"
            refY="3.5"
            markerWidth="8"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="oklch(0.80 0.15 70)" />
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
            const d = edgeHierarchyPath(g, e.target, e.source)
            const emphasized = focusEdges?.has(e.ref_id) ?? false
            const opacity = focusEdges
              ? emphasized
                ? 1
                : DIM_OPACITY
              : selectedEdgeType
                ? DIM_OPACITY
                : 0.85
            return (
              <path
                key={`h-${e.ref_id}`}
                d={d}
                fill="none"
                // Brighten + thicken the incident hierarchy edge on focus so a
                // hover reads clearly even for nodes with no relationship edges.
                stroke={emphasized ? "oklch(0.62 0.04 260)" : "oklch(0.3 0.02 260)"}
                strokeWidth={emphasized ? 2.5 : 1.5}
                strokeDasharray="6 4"
                markerEnd="url(#arrowhead)"
                opacity={opacity}
              />
            )
          })}

          {/* Relationship edges */}
          {edges.map((e) => {
            const key = `${e.source}→${e.target}`
            if (hierarchyEdges.has(key)) return null
            const sourceNode = g.node(e.source)
            const targetNode = g.node(e.target)
            if (!sourceNode || !targetNode) return null

            // Anchor endpoints to the card borders so arrowheads stay visible
            // and the curve doesn't run through node interiors.
            const sp = rectBorderPoint(sourceNode.x, sourceNode.y, targetNode.x, targetNode.y)
            const tp = rectBorderPoint(targetNode.x, targetNode.y, sourceNode.x, sourceNode.y)
            const dx = tp.x - sp.x
            const dy = tp.y - sp.y
            const ctrlX = sp.x + dx * 0.5 + dy * 0.15
            const ctrlY = sp.y + dy * 0.5 - dx * 0.15
            const d = `M ${sp.x} ${sp.y} Q ${ctrlX} ${ctrlY} ${tp.x} ${tp.y}`

            // Label at the quadratic curve's midpoint (t = 0.5).
            const labelX = 0.25 * sp.x + 0.5 * ctrlX + 0.25 * tp.x
            const labelY = 0.25 * sp.y + 0.5 * ctrlY + 0.25 * tp.y
            const labelW = e.edge_type.length * 5.6 + 10

            const isTypeHighlighted = selectedEdgeType === e.edge_type
            let edgeOpacity: number
            if (focusEdges) {
              edgeOpacity = focusEdges.has(e.ref_id) ? 1 : DIM_OPACITY
            } else if (selectedEdgeType) {
              edgeOpacity = isTypeHighlighted ? 1 : 0.12
            } else {
              edgeOpacity = 0.6
            }

            // Direction-code edges incident to the focused node: outgoing (cyan)
            // vs incoming (amber). Otherwise fall back to the default blue.
            const incidentToFocus = focusEdges?.has(e.ref_id) ?? false
            const isOutgoing = incidentToFocus && e.source === focusId
            const isIncoming = incidentToFocus && e.target === focusId
            const isEmphasized = incidentToFocus || isTypeHighlighted
            let edgeStroke: string
            let marker: string
            let labelFill: string
            if (isOutgoing) {
              edgeStroke = "oklch(0.72 0.16 200)"
              marker = "url(#arrowhead-out)"
              labelFill = "oklch(0.78 0.15 200)"
            } else if (isIncoming) {
              edgeStroke = "oklch(0.80 0.15 70)"
              marker = "url(#arrowhead-in)"
              labelFill = "oklch(0.84 0.14 70)"
            } else if (isTypeHighlighted) {
              edgeStroke = "oklch(0.65 0.15 200)"
              marker = "url(#arrowhead-rel)"
              labelFill = "oklch(0.75 0.12 200)"
            } else {
              edgeStroke = "oklch(0.45 0.1 200)"
              marker = "url(#arrowhead-rel)"
              labelFill = "oklch(0.6 0.08 200)"
            }
            const edgeWidth = isEmphasized ? "2" : "1"

            return (
              <g key={`r-${e.ref_id}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={edgeStroke}
                  strokeWidth={edgeWidth}
                  strokeDasharray="4 3"
                  markerEnd={marker}
                  opacity={edgeOpacity}
                />
                {/* Backing pill keeps the label readable over edges and the grid */}
                <rect
                  x={labelX - labelW / 2}
                  y={labelY - 8}
                  width={labelW}
                  height={16}
                  rx={4}
                  fill="oklch(0.06 0.02 260)"
                  stroke="oklch(0.22 0.02 260)"
                  strokeWidth="0.5"
                  opacity={edgeOpacity}
                />
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="text-[10px] font-mono"
                  fill={labelFill}
                  opacity={edgeOpacity}
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
            const nodeOpacity = focusNodes
              ? focusNodes.has(s.ref_id)
                ? 1
                : DIM_OPACITY
              : 1
            const Icon = getSchemaIcon(s.icon)

            return (
              <g
                key={s.ref_id}
                onClick={() => onSelect(s.ref_id)}
                onMouseEnter={() => setHoveredId(s.ref_id)}
                onMouseLeave={() => setHoveredId(null)}
                className="cursor-pointer"
                opacity={nodeOpacity}
              >
                <title>{s.type}</title>
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

                {/* Type icon */}
                <Icon
                  x={x + 12}
                  y={y + 20}
                  width={16}
                  height={16}
                  color={s.color}
                />

                {/* Type name */}
                <text
                  x={x + 36}
                  y={y + 22}
                  className="text-[13px] font-semibold"
                  fill="oklch(0.9 0.01 260)"
                >
                  {truncate(s.type, 13)}
                </text>

                {/* Parent type */}
                {s.parent && (
                  <text
                    x={x + 36}
                    y={y + 40}
                    className="text-[10px] font-mono"
                    fill="oklch(0.5 0.02 260)"
                  >
                    extends {truncate(s.parent, 16)}
                  </text>
                )}

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

      {/* Legend overlay */}
      <div className="pointer-events-none absolute bottom-4 left-4 flex flex-col gap-1.5 rounded-md border border-border/40 bg-background/70 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <svg width="22" height="6" className="shrink-0">
            <line x1="0" y1="3" x2="22" y2="3" stroke="oklch(0.4 0.02 260)" strokeWidth="1.5" strokeDasharray="6 4" />
          </svg>
          <span className="text-[10px] text-muted-foreground">extends (CHILD_OF)</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="22" height="6" className="shrink-0">
            <line x1="0" y1="3" x2="22" y2="3" stroke="oklch(0.55 0.12 200)" strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
          <span className="text-[10px] text-muted-foreground">relationship</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="22" height="6" className="shrink-0">
            <line x1="0" y1="3" x2="22" y2="3" stroke="oklch(0.72 0.16 200)" strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          <span className="text-[10px] text-muted-foreground">outgoing (from focus)</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="22" height="6" className="shrink-0">
            <line x1="0" y1="3" x2="22" y2="3" stroke="oklch(0.80 0.15 70)" strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          <span className="text-[10px] text-muted-foreground">incoming (to focus)</span>
        </div>
      </div>

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
