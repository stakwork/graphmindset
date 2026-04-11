"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
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

interface Props {
  rawNodes: RawNode[]
  rawEdges: RawEdge[]
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

export function UniverseGraph({ rawNodes, rawEdges }: Props) {
  const cameraRef = useRef<CameraControlsImpl>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  const graph = useMemo(() => {
    const g = buildGraph(rawNodes, rawEdges)
    applyInitialLayout(g)
    return g
  }, [rawNodes, rawEdges])

  const [viewState, setViewState] = useState<ViewState>({ mode: "overview" })

  // Reset camera + view when graph rebuilds (new search or initial load)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewState({ mode: "overview" })
    const cam = cameraRef.current
    if (cam) cam.setLookAt(0, 80, 0.1, 0, 0, 0, true)
  }, [graph])

  const handleNodeClick = useCallback(
    (nodeId: number) => {
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
        const allVisible = [...prevVisible, ...newNodes]
        const visibleSet = new Set(allVisible)
        for (const hid of newHistory) {
          if (!visibleSet.has(hid)) {
            allVisible.push(hid)
            visibleSet.add(hid)
          }
        }
        const depthMap = new Map(sub.depthMap)
        const prevNodeId =
          newHistory.length >= 2 ? newHistory[newHistory.length - 2] : null
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
    },
    [graph, viewState]
  )

  const handleReset = useCallback(() => {
    setViewState({ mode: "overview" })
    const cam = cameraRef.current
    if (cam) cam.setLookAt(0, 80, 0.1, 0, 0, 0, true)
  }, [])

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
          className="absolute top-4 left-4 rounded-md bg-background/80 px-3 py-1.5 text-xs text-foreground backdrop-blur hover:bg-background"
        >
          Reset view
        </button>
      )}
    </div>
  )
}
