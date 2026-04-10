"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { Canvas } from "@react-three/fiber"
import { CameraControls, Html } from "@react-three/drei"
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
import type { SchemaNode, SchemaEdge } from "./page"

interface Props {
  schemas: SchemaNode[]
  edges: SchemaEdge[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function schemasToGraph(
  schemas: SchemaNode[],
  edges: SchemaEdge[]
): { graph: Graph; indexMap: Map<number, string> } {
  const rawNodes: RawNode[] = schemas.map((s) => ({
    id: s.ref_id,
    label: s.type,
  }))

  const rawEdges: RawEdge[] = []
  const edgeSet = new Set<string>()

  for (const e of edges) {
    const key = `${e.source}-${e.target}`
    if (!edgeSet.has(key)) {
      edgeSet.add(key)
      const isChildOf = e.edge_type === "CHILD_OF"
      rawEdges.push({
        source: isChildOf ? e.target : e.source,
        target: isChildOf ? e.source : e.target,
        label: e.edge_type,
        displayReverse: isChildOf,
      })
    }
  }

  const hasChildOf = edges.some((e) => e.edge_type === "CHILD_OF")
  if (!hasChildOf) {
    for (const s of schemas) {
      if (s.parent) {
        const parent = schemas.find((p) => p.type === s.parent)
        if (parent) {
          const key = `${parent.ref_id}-${s.ref_id}`
          if (!edgeSet.has(key)) {
            edgeSet.add(key)
            rawEdges.push({ source: parent.ref_id, target: s.ref_id })
          }
        }
      }
    }
  }

  const graph = buildGraph(rawNodes, rawEdges)

  const indexMap = new Map<number, string>()
  for (let i = 0; i < schemas.length; i++) {
    indexMap.set(i, schemas[i].ref_id)
  }

  return { graph, indexMap }
}

function applyInitialLayout(graph: Graph) {
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

function moveCameraToNode(
  cam: CameraControlsImpl,
  graph: Graph,
  nodeId: number
) {
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

export function OntologyGraph3D({ schemas, edges, selectedId, onSelect }: Props) {
  const cameraRef = useRef<CameraControlsImpl>(null)

  const { graph: baseGraph, indexMap } = useMemo(() => {
    const result = schemasToGraph(schemas, edges)
    applyInitialLayout(result.graph)
    return result
  }, [schemas, edges])

  const [viewState, setViewState] = useState<ViewState>({ mode: "overview" })
  const [pinStack, setPinStack] = useState<number[]>([])
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const pinnedNodeId = pinStack.length > 0 ? pinStack[pinStack.length - 1] : null

  // Pinned view: build a chain of radial layouts
  const pinnedGraph = useMemo(() => {
    if (pinStack.length === 0) return null

    let result = baseGraph

    for (const pid of pinStack) {
      const node = result.nodes[pid]
      if (!node) return null

      const sub = extractSubgraph(result, pid, 4, { useAdj: "undirected" })

      if (sub.neighborsByDepth[0]) {
        sub.neighborsByDepth[0].sort((a, b) => {
          const ta = result.nodes[a]?.label || ""
          const tb = result.nodes[b]?.label || ""
          return ta.localeCompare(tb)
        })
      }

      const layoutEdges = sub.edges.map((e) => ({ src: e.src, dst: e.dst }))
      const layout = computeRadialLayout(pid, sub.neighborsByDepth, layoutEdges, {
        parentId: sub.parentId,
      })

      const cx = node.position.x
      const cy = node.position.y
      const cz = node.position.z

      const clonedNodes = result.nodes.map((n, i) => {
        const layoutPos = layout.positions.get(i)
        if (layoutPos) {
          return { ...n, position: { x: cx + layoutPos.x, y: cy + layoutPos.y, z: cz + layoutPos.z } }
        }
        return n
      })

      const subNodeSet = new Set(sub.nodeIds)
      const filteredAdj = result.adj.map((neighbors, i) =>
        subNodeSet.has(i) ? neighbors.filter((n) => subNodeSet.has(n)) : []
      )
      const filteredEdges = result.edges.filter(
        (e) => subNodeSet.has(e.src) && subNodeSet.has(e.dst)
      )

      result = {
        ...result,
        nodes: clonedNodes,
        adj: filteredAdj,
        edges: filteredEdges,
        childrenOf: layout.childrenOf,
        treeEdgeSet: layout.treeEdgeSet,
        initialDepthMap: sub.depthMap,
      }
    }

    return result
  }, [pinStack, baseGraph])

  // When a node is pinned, set viewState for the pinned graph
  useEffect(() => {
    if (pinnedNodeId === null || !pinnedGraph) return
    const sub = extractSubgraph(pinnedGraph, pinnedNodeId, 30, { useAdj: "undirected" })
    setViewState({
      mode: "subgraph",
      selectedNodeId: pinnedNodeId,
      navigationHistory: [pinnedNodeId],
      depthMap: sub.depthMap,
      neighborsByDepth: sub.neighborsByDepth,
      parentId: sub.parentId,
      visibleNodeIds: sub.nodeIds,
    })

    const cam = cameraRef.current
    if (cam) moveCameraToNode(cam, pinnedGraph, pinnedNodeId)
  }, [pinStack, pinnedGraph, pinnedNodeId])

  const graph = pinnedGraph ?? baseGraph

  const handleNodeClick = useCallback(
    (nodeId: number) => {
      const refId = indexMap.get(nodeId)
      if (refId) onSelect(refId)

      if (viewState.mode === "subgraph" && viewState.selectedNodeId === nodeId) return

      const sub = extractSubgraph(graph, nodeId, 30, { useAdj: "undirected" })

      setViewState((prev) => {
        const prevVisible = prev.mode === "subgraph" ? prev.visibleNodeIds : []
        const prevSet = new Set(prevVisible)
        const newNodes = sub.nodeIds.filter((n) => !prevSet.has(n))
        const prevHistory = prev.mode === "subgraph" ? prev.navigationHistory : []
        const existingIdx = prevHistory.indexOf(nodeId)
        const newHistory =
          existingIdx !== -1
            ? prevHistory.slice(0, existingIdx + 1)
            : [...prevHistory, nodeId]

        // Ensure all nodes in navigation history stay visible
        const allVisible = [...prevVisible, ...newNodes]
        const visibleSet = new Set(allVisible)
        for (const hid of newHistory) {
          if (!visibleSet.has(hid)) {
            allVisible.push(hid)
            visibleSet.add(hid)
          }
        }

        // Ensure previous node has a depth entry so it's not invisible
        const depthMap = new Map(sub.depthMap)
        const prevNodeId = newHistory.length >= 2 ? newHistory[newHistory.length - 2] : null
        if (prevNodeId !== null && !depthMap.has(prevNodeId)) {
          depthMap.set(prevNodeId, -1) // depth -1 = parent-like visibility
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
    [graph, indexMap, onSelect, viewState]
  )

  const handlePin = useCallback(
    (nodeId: number) => {
      if (nodeId === pinnedNodeId) return
      setPinStack((prev) => [...prev, nodeId])
    },
    [pinnedNodeId]
  )

  const handleReset = useCallback(() => {
    setPinStack([])
    setViewState({ mode: "overview" })
    const cam = cameraRef.current
    if (cam) cam.setLookAt(0, 80, 0.1, 0, 0, 0, true)
  }, [])

  // Escape key to reset
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (pinStack.length > 0) {
        // Unpin last
        setPinStack((prev) => prev.slice(0, -1))
      } else if (viewState.mode === "subgraph") {
        handleReset()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [viewState.mode, pinStack.length, handleReset])

  if (schemas.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[oklch(0.06_0.02_260)]">
        <p className="text-muted-foreground">No schema data</p>
      </div>
    )
  }

  // Selected node for pin button
  const selectedNodeId = viewState.mode === "subgraph" ? viewState.selectedNodeId : null

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
          onHoverChange={setHoveredId}
        />
        <OffscreenIndicators
          graph={graph}
          viewState={viewState}
          onNodeClick={handleNodeClick}
          hovered={hoveredId}
        />
        <PrevNodeIndicator
          graph={graph}
          viewState={viewState}
          onNodeClick={handleNodeClick}
        />

        {/* Pin button on selected node */}
        {selectedNodeId !== null && graph.nodes[selectedNodeId] && (
          <Html
            position={[
              graph.nodes[selectedNodeId].position.x,
              graph.nodes[selectedNodeId].position.y,
              graph.nodes[selectedNodeId].position.z,
            ]}
            center
            style={{ pointerEvents: "none" }}
          >
            <button
              onClick={() => handlePin(selectedNodeId)}
              title="Pin as root"
              style={{
                position: "absolute",
                top: -52,
                left: 12,
                width: 40,
                height: 40,
                borderRadius: "50%",
                border: "1.5px solid rgba(77, 217, 232, 0.5)",
                background: "rgba(10, 10, 20, 0.85)",
                backdropFilter: "blur(12px)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "auto",
                boxShadow: "0 0 20px rgba(77, 217, 232, 0.2), inset 0 0 12px rgba(77, 217, 232, 0.05)",
                transition: "transform 0.2s ease, box-shadow 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.15)"
                e.currentTarget.style.boxShadow = "0 0 28px rgba(77, 217, 232, 0.4)"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)"
                e.currentTarget.style.boxShadow = "0 0 20px rgba(77, 217, 232, 0.2)"
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#4dd9e8"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </Html>
        )}

        <CameraControls
          ref={cameraRef}
          makeDefault
          dollySpeed={0.5}
          truckSpeed={1}
        />
        <EffectComposer>
          <Bloom
            luminanceThreshold={0.2}
            luminanceSmoothing={0.9}
            intensity={0.6}
          />
        </EffectComposer>
      </Canvas>

      {/* Controls overlay */}
      {(viewState.mode === "subgraph" || pinStack.length > 0) && (
        <button
          onClick={handleReset}
          className="absolute top-4 left-4 rounded-md bg-background/80 px-3 py-1.5 text-xs text-foreground backdrop-blur hover:bg-background"
        >
          Reset view
        </button>
      )}

      {pinStack.length > 0 && (
        <button
          onClick={() => setPinStack((prev) => prev.slice(0, -1))}
          className="absolute top-4 left-28 rounded-md bg-background/80 px-3 py-1.5 text-xs text-foreground backdrop-blur hover:bg-background"
        >
          Unpin
        </button>
      )}
    </div>
  )
}
