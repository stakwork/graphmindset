/**
 * Sidebar selection should trigger the exact same "focus" behavior as a
 * direct canvas click: viewState flips into subgraph mode (centered on the
 * selected node, showing only its subgraph) and the camera target moves.
 *
 * This does NOT re-test unrelated existing behavior (cluster/append logic is
 * covered by cluster-merge.test.ts; useNeighborFetch's own fetch/merge
 * behavior is unchanged and untouched by this change).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, act } from "@testing-library/react"
import React from "react"
import { useGraphStore } from "@/stores/graph-store"
import type { GraphNode as ApiNode, GraphEdge as ApiEdge } from "@/lib/graph-api"

// ── Mock the R3F/three rendering stack. GraphCanvas mounts a real <Canvas>,
// which needs a WebGL context jsdom doesn't provide. We only care about the
// plain-JS focus logic (viewState + camera-target refs), so replace the
// renderer with pass-through/no-op stand-ins and capture what we need. ──

const frameCallbacks: Array<(delta: number) => void> = []
const fakeCameraControls = {
  getPosition: (v: { x: number; y: number; z: number }) => {
    v.x = 0; v.y = 80; v.z = 0.1
    return v
  },
  getTarget: (v: { x: number; y: number; z: number }) => {
    v.x = 0; v.y = 0; v.z = 0
    return v
  },
  setLookAt: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  azimuthAngle: 0,
}

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useFrame: (cb: (delta: number) => void) => {
    frameCallbacks.push(cb)
  },
  useThree: (selector?: (s: { controls: null }) => unknown) =>
    selector ? selector({ controls: null }) : { controls: null },
}))

vi.mock("@react-three/drei", () => ({
  CameraControls: React.forwardRef(function CameraControlsMock(
    _props: unknown,
    ref: React.Ref<typeof fakeCameraControls>
  ) {
    React.useImperativeHandle(ref, () => fakeCameraControls)
    return null
  }),
}))

vi.mock("@react-three/postprocessing", () => ({
  EffectComposer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Bloom: () => null,
}))

// Captures the latest props GraphView was rendered with so tests can assert
// on viewState without needing a real 3D scene.
let lastGraphViewProps: { viewState: unknown; onNodeClick: (id: number) => void } | null = null

vi.mock("@/graph-viz-kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/graph-viz-kit")>()
  return {
    ...actual,
    GraphView: (props: { viewState: unknown; onNodeClick: (id: number) => void }) => {
      lastGraphViewProps = props
      return <div data-testid="graph-view" />
    },
    OffscreenIndicators: () => null,
    PrevNodeIndicator: () => null,
  }
})

vi.mock("@/components/universe/hover-preview-card", () => ({
  HoverPreviewCard: () => null,
}))

import { GraphCanvas } from "@/components/universe/graph-canvas"

const nodeA: ApiNode = { ref_id: "a", node_type: "topic", properties: {} }
const nodeB: ApiNode = { ref_id: "b", node_type: "topic", properties: {} }
const nodeC: ApiNode = { ref_id: "c", node_type: "topic", properties: {} }
const apiNodes: ApiNode[] = [nodeA, nodeB, nodeC]
const apiEdges: ApiEdge[] = [
  { source: "a", target: "b", edge_type: "MENTIONS" },
  { source: "a", target: "c", edge_type: "MENTIONS" },
]

function tick(delta = 0.5) {
  act(() => {
    for (const cb of frameCallbacks) cb(delta)
  })
}

beforeEach(() => {
  lastGraphViewProps = null
  frameCallbacks.length = 0
  fakeCameraControls.setLookAt.mockClear()
  useGraphStore.setState({
    sidebarSelectedNode: null,
    hoveredNode: null,
    selectedNode: null,
  })
})

afterEach(() => {
  useGraphStore.setState({
    sidebarSelectedNode: null,
    hoveredNode: null,
    selectedNode: null,
  })
})

describe("GraphCanvas — sidebar selection triggers focus", () => {
  it("switches viewState into subgraph mode for the sidebar-selected node", async () => {
    render(<GraphCanvas nodes={apiNodes} edges={apiEdges} schemas={[]} />)
    expect(lastGraphViewProps).not.toBeNull()
    expect(lastGraphViewProps!.viewState).toEqual({ mode: "overview" })

    await act(async () => {
      useGraphStore.getState().setSidebarSelectedNode(nodeB)
    })

    const vs = lastGraphViewProps!.viewState as {
      mode: string
      selectedNodeId: number
      visibleNodeIds: number[]
    }
    expect(vs.mode).toBe("subgraph")
    // "b" is the second node loaded → index 1 in the built graph.
    expect(vs.selectedNodeId).toBe(1)
    // Undirected subgraph from b reaches a and (through a) c as well.
    expect(vs.visibleNodeIds.sort()).toEqual([0, 1, 2])
  })

  it("moves the camera target when a node is selected from the sidebar", async () => {
    render(<GraphCanvas nodes={apiNodes} edges={apiEdges} schemas={[]} />)

    await act(async () => {
      useGraphStore.getState().setSidebarSelectedNode(nodeC)
    })

    // Drive one animation frame so CameraSync's lerp applies the freshly-set
    // camera target via CameraControls.setLookAt.
    tick()

    expect(fakeCameraControls.setLookAt).toHaveBeenCalled()
  })

  it("does not re-focus when the same ref_id reselects via a new object instance", async () => {
    render(<GraphCanvas nodes={apiNodes} edges={apiEdges} schemas={[]} />)

    await act(async () => {
      useGraphStore.getState().setSidebarSelectedNode(nodeB)
    })
    const firstViewState = lastGraphViewProps!.viewState

    // A fresh object with the SAME ref_id (e.g. a re-fetched/re-serialized
    // node) still counts as "already focused" and must not re-run the focus
    // sequence (which would otherwise fight incremental subgraph growth from
    // a neighbor fetch already in flight for this node).
    await act(async () => {
      useGraphStore.getState().setSidebarSelectedNode({ ...nodeB })
    })

    expect(lastGraphViewProps!.viewState).toBe(firstViewState)
  })
})
