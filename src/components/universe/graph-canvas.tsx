"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Canvas } from "@react-three/fiber"
import { CameraControls } from "@react-three/drei"
import { EffectComposer, Bloom } from "@react-three/postprocessing"
import type CameraControlsImpl from "camera-controls"
import {
  buildGraph,
  computeRadialLayout,
  extractInitialSubgraph,
  extractSubgraph,
  VIRTUAL_CENTER,
  GraphView,
  OffscreenIndicators,
  PrevNodeIndicator,
} from "@/graph-viz-kit"
import type { Graph, ViewState, RawNode, RawEdge } from "@/graph-viz-kit"
import type { GraphNode as ApiNode, GraphEdge as ApiEdge } from "@/lib/graph-api"
import type { SchemaNode } from "@/app/ontology/page"

const DISPLAY_KEY_FALLBACKS = ["name", "title", "label", "text", "content", "body"] as const

function nodeLabel(node: ApiNode, schemas: SchemaNode[]): string {
  const props = node.properties
  const schema = schemas.find((s) => s.type === node.node_type)

  if (schema?.title_key) {
    const v = props?.[schema.title_key]
    if (typeof v === "string" && v.length > 0) return v
  }
  if (schema?.index) {
    const v = props?.[schema.index]
    if (typeof v === "string" && v.length > 0) return v
  }
  if (props) {
    for (const key of DISPLAY_KEY_FALLBACKS) {
      const v = props[key]
      if (typeof v === "string" && v.length > 0) return v
    }
  }
  return node.ref_id
}

function apiToGraph(
  nodes: ApiNode[],
  edges: ApiEdge[],
  schemas: SchemaNode[]
): { graph: Graph; indexMap: Map<number, string> } {
  const rawNodes: RawNode[] = nodes.map((n) => ({
    id: n.ref_id,
    label: nodeLabel(n, schemas),
  }))

  const rawEdges: RawEdge[] = edges.map((e) => ({
    source: e.source,
    target: e.target,
    label: e.edge_type,
  }))

  // Find root nodes (no incoming edges from within the result set)
  const nodeIds = new Set(nodes.map((n) => n.ref_id))
  const hasIncoming = new Set<string>()
  for (const e of edges) {
    if (nodeIds.has(e.target)) hasIncoming.add(e.target)
  }
  const roots = nodes.filter((n) => !hasIncoming.has(n.ref_id))

  // Group roots by node_type when there are too many top-level nodes
  if (roots.length > 10) {
    const groups = new Map<string, ApiNode[]>()
    for (const root of roots) {
      const type = root.node_type || "Unknown"
      if (!groups.has(type)) groups.set(type, [])
      groups.get(type)!.push(root)
    }

    for (const [type, members] of groups) {
      if (members.length < 2) continue
      const groupId = `__group_${type}`
      rawNodes.push({ id: groupId, label: type })
      for (const member of members) {
        rawEdges.push({ source: groupId, target: member.ref_id })
      }
    }
  }

  const graph = buildGraph(rawNodes, rawEdges)

  // Set nodeType on real nodes
  for (let i = 0; i < nodes.length; i++) {
    graph.nodes[i].nodeType = nodes[i].node_type
  }
  // Mark synthetic group nodes
  for (let i = nodes.length; i < graph.nodes.length; i++) {
    graph.nodes[i].nodeType = "_group"
  }

  // Only map real nodes — group nodes have no API counterpart
  const indexMap = new Map<number, string>()
  for (let i = 0; i < nodes.length; i++) {
    indexMap.set(i, nodes[i].ref_id)
  }

  return { graph, indexMap }
}

function applyLayout(graph: Graph) {
  const sub = extractInitialSubgraph(graph)
  const { positions, treeEdgeSet, childrenOf } = computeRadialLayout(
    sub.centerId,
    sub.neighborsByDepth,
    graph.edges,
    { parentId: sub.parentId }
  )

  for (const [id, pos] of positions) {
    if (id !== VIRTUAL_CENTER && id < graph.nodes.length) {
      graph.nodes[id].position = pos
    }
  }

  graph.initialDepthMap = sub.depthMap
  graph.treeEdgeSet = treeEdgeSet
  graph.childrenOf = childrenOf
}

function moveCameraToNode(cam: CameraControlsImpl, graph: Graph, nodeId: number) {
  const p = graph.nodes[nodeId].position
  const treeKids = graph.childrenOf?.get(nodeId) ?? []
  const allPts = [p, ...treeKids.map((nid) => graph.nodes[nid]?.position).filter(Boolean)]
  const avgX = allPts.reduce((s, pt) => s + pt.x, 0) / allPts.length
  const avgZ = allPts.reduce((s, pt) => s + pt.z, 0) / allPts.length
  let maxRadius = 0
  for (const pt of allPts) {
    const dx = pt.x - avgX
    const dz = pt.z - avgZ
    maxRadius = Math.max(maxRadius, Math.sqrt(dx * dx + dz * dz))
  }
  const fovRad = (50 / 2) * (Math.PI / 180)
  const cameraHeight = Math.max(5, (maxRadius * 1.05) / Math.tan(fovRad))
  cam.setLookAt(avgX, p.y + cameraHeight, avgZ + 0.1, avgX, p.y, avgZ, true)
}

interface GraphCanvasProps {
  nodes: ApiNode[]
  edges: ApiEdge[]
  schemas: SchemaNode[]
  onNodeSelect?: (node: ApiNode) => void
}

export function GraphCanvas({ nodes, edges, schemas, onNodeSelect }: GraphCanvasProps) {
  const cameraRef = useRef<CameraControlsImpl>(null)

  const { graph, indexMap } = useMemo(() => {
    const result = apiToGraph(nodes, edges, schemas)
    applyLayout(result.graph)
    return result
  }, [nodes, edges, schemas])

  const [viewState, setViewState] = useState<ViewState>({ mode: "overview" })

  // Reset view when data changes
  useEffect(() => {
    setViewState({ mode: "overview" })
    const cam = cameraRef.current
    if (cam) cam.setLookAt(0, 80, 0.1, 0, 0, 0, true)
  }, [nodes, edges])

  const handleNodeClick = useCallback(
    (nodeId: number) => {
      const refId = indexMap.get(nodeId)
      if (refId && onNodeSelect) {
        const apiNode = nodes.find((n) => n.ref_id === refId)
        if (apiNode) onNodeSelect(apiNode)
      }

      const sub = extractSubgraph(graph, nodeId, 30, { useAdj: "undirected" })

      setViewState((prev) => {
        const prevHistory = prev.mode === "subgraph" ? prev.navigationHistory : []
        const existingIdx = prevHistory.indexOf(nodeId)
        const newHistory =
          existingIdx !== -1
            ? prevHistory.slice(0, existingIdx + 1)
            : [...prevHistory, nodeId]

        const prevVisible = prev.mode === "subgraph" ? prev.visibleNodeIds : []
        const prevSet = new Set(prevVisible)
        const newNodes = sub.nodeIds.filter((n) => !prevSet.has(n))
        const allVisible = [...prevVisible, ...newNodes]
        const visibleSet = new Set(allVisible)
        for (const hid of newHistory) {
          if (!visibleSet.has(hid)) {
            allVisible.push(hid)
            visibleSet.add(hid)
          }
        }

        const depthMap = new Map(sub.depthMap)
        const prevNodeId = newHistory.length >= 2 ? newHistory[newHistory.length - 2] : null
        if (prevNodeId !== null && !depthMap.has(prevNodeId)) {
          depthMap.set(prevNodeId, -1)
        }

        return {
          mode: "subgraph" as const,
          selectedNodeId: nodeId,
          navigationHistory: newHistory,
          depthMap,
          neighborsByDepth: sub.neighborsByDepth,
          parentId: sub.parentId,
          visibleNodeIds: allVisible,
        }
      })

      const cam = cameraRef.current
      if (cam) moveCameraToNode(cam, graph, nodeId)
    },
    [graph, indexMap, nodes, onNodeSelect]
  )

  const handleReset = useCallback(() => {
    setViewState({ mode: "overview" })
    const cam = cameraRef.current
    if (cam) cam.setLookAt(0, 80, 0.1, 0, 0, 0, true)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && viewState.mode === "subgraph") handleReset()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [viewState.mode, handleReset])

  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{ position: [0, 80, 0.1], fov: 50 }}
        style={{ background: "oklch(0.06 0.02 260)" }}
      >
        <ambientLight intensity={0.3} />
        <GraphView
          graph={graph}
          viewState={viewState}
          onNodeClick={handleNodeClick}
        />
        <OffscreenIndicators
          graph={graph}
          viewState={viewState}
          onNodeClick={handleNodeClick}
        />
        <PrevNodeIndicator
          graph={graph}
          viewState={viewState}
          onNodeClick={handleNodeClick}
        />
        <CameraControls
          ref={cameraRef}
          makeDefault
          dollySpeed={0.5}
          truckSpeed={1}
          dollyToCursor
        />
        <EffectComposer>
          <Bloom
            luminanceThreshold={0.2}
            luminanceSmoothing={0.9}
            intensity={0.6}
          />
        </EffectComposer>
      </Canvas>

      {viewState.mode === "subgraph" && (
        <button
          onClick={handleReset}
          className="absolute top-4 right-4 rounded-md bg-background/80 px-3 py-1.5 text-xs text-foreground backdrop-blur hover:bg-background"
        >
          Reset view
        </button>
      )}
    </div>
  )
}
