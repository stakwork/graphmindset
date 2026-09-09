/**
 * Sidebar selection swaps the canvas to a brand-new graph: the picked node
 * plus its 1-hop neighborhood (store.focusGraph), laid out fresh with that
 * node at the center and the camera fitted to the whole thing. Nothing from
 * the previous drawing carries over.
 *
 * Covers: the store's focusGraph lifecycle, and GraphCanvas honoring
 * `layoutRootRefId` (root at origin + fit camera).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, act } from "@testing-library/react"
import React from "react"
import { useGraphStore } from "@/stores/graph-store"
import type { GraphNode as ApiNode, GraphEdge as ApiEdge } from "@/lib/graph-api"

// ── Mock the R3F/three rendering stack. GraphCanvas mounts a real <Canvas>,
// which needs a WebGL context jsdom doesn't provide. ──

// R3F's useFrame callback signature is (state, delta).
const frameCallbacks: Array<(state: unknown, delta: number) => void> = []
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
  camera: { aspect: 16 / 9 },
}

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useFrame: (cb: (state: unknown, delta: number) => void) => {
    frameCallbacks.push(cb)
  },
  useThree: (selector?: (s: { controls: null }) => unknown) =>
    selector ? selector({ controls: null }) : { controls: null },
}))

vi.mock("@react-three/drei", () => ({
  CameraControls: React.forwardRef(function CameraControlsMock(
    _props: unknown,
    ref: React.ForwardedRef<unknown>
  ) {
    React.useImperativeHandle(ref, () => fakeCameraControls)
    return null
  }),
}))

vi.mock("@react-three/postprocessing", () => ({
  EffectComposer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Bloom: () => null,
}))

type Pos = { x: number; y: number; z: number }
let lastGraphViewProps: { graph: { nodes: { position: Pos }[] }; viewState: unknown } | null = null

vi.mock("@/graph-viz-kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/graph-viz-kit")>()
  return {
    ...actual,
    GraphView: (props: { graph: { nodes: { position: Pos }[] }; viewState: unknown }) => {
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
    for (const cb of frameCallbacks) cb({}, delta)
  })
}

const near = (p: Pos, x: number, z: number) => Math.hypot(p.x - x, p.z - z) < 1e-6

beforeEach(() => {
  lastGraphViewProps = null
  frameCallbacks.length = 0
  fakeCameraControls.setLookAt.mockClear()
  useGraphStore.setState({
    nodes: [],
    edges: [],
    focusGraph: null,
    sidebarSelectedNode: null,
    hoveredNode: null,
    selectedNode: null,
  })
})

afterEach(() => {
  useGraphStore.setState({ focusGraph: null, sidebarSelectedNode: null, hoveredNode: null, selectedNode: null })
})

describe("graph-store focusGraph lifecycle", () => {
  it("setFocusGraph replaces the canvas dataset (bumps dataVersion) but keeps search results", () => {
    const st = useGraphStore.getState()
    st.setGraphData(apiNodes, apiEdges)
    const v0 = useGraphStore.getState().dataVersion

    st.setFocusGraph({ rootRefId: "b", nodes: [nodeB, nodeA], edges: [apiEdges[0]] })
    const s = useGraphStore.getState()
    expect(s.dataVersion).toBe(v0 + 1)
    expect(s.focusGraph?.rootRefId).toBe("b")
    expect(s.focusGraph?.nodes.map((n) => n.ref_id)).toEqual(["b", "a"])
    // Sidebar list source is untouched.
    expect(s.nodes.map((n) => n.ref_id)).toEqual(["a", "b", "c"])
  })

  it("addNodes appends into the focus graph while one is active", () => {
    const st = useGraphStore.getState()
    st.setGraphData(apiNodes, apiEdges)
    st.setFocusGraph({ rootRefId: "b", nodes: [nodeB], edges: [] })
    const v1 = useGraphStore.getState().dataVersion

    const nodeD: ApiNode = { ref_id: "d", node_type: "topic", properties: {} }
    st.addNodes([nodeB, nodeD], [{ source: "b", target: "d", edge_type: "MENTIONS" }])
    const s = useGraphStore.getState()
    expect(s.focusGraph?.nodes.map((n) => n.ref_id)).toEqual(["b", "d"])
    expect(s.focusGraph?.edges).toHaveLength(1)
    expect(s.nodes).toHaveLength(3) // search results untouched
    expect(s.dataVersion).toBe(v1) // append, not a swap
  })

  it("clearSelection and a new search both drop the focus graph", () => {
    const st = useGraphStore.getState()
    st.setGraphData(apiNodes, apiEdges)
    st.setFocusGraph({ rootRefId: "b", nodes: [nodeB], edges: [] })
    const v1 = useGraphStore.getState().dataVersion

    st.clearSelection()
    expect(useGraphStore.getState().focusGraph).toBeNull()
    expect(useGraphStore.getState().dataVersion).toBe(v1 + 1) // back to results = swap

    st.setFocusGraph({ rootRefId: "c", nodes: [nodeC], edges: [] })
    st.setGraphData([nodeA], [])
    expect(useGraphStore.getState().focusGraph).toBeNull()
  })
})

describe("GraphCanvas — focus graph (layoutRootRefId)", () => {
  it("lays the graph out around the root node instead of the dataset's own roots", () => {
    // Default: `a` is the only zero-in-degree node → it is the center.
    render(<GraphCanvas nodes={apiNodes} edges={apiEdges} schemas={[]} />)
    let g = lastGraphViewProps!.graph
    expect(near(g.nodes[0].position, 0, 0)).toBe(true)
    expect(near(g.nodes[1].position, 0, 0)).toBe(false)

    // Focus graph rooted on `b`: b sits at the origin, a and c ring outward.
    lastGraphViewProps = null
    render(<GraphCanvas nodes={apiNodes} edges={apiEdges} schemas={[]} layoutRootRefId="b" />)
    g = lastGraphViewProps!.graph
    expect(near(g.nodes[1].position, 0, 0)).toBe(true)
    expect(near(g.nodes[0].position, 0, 0)).toBe(false)
    expect(near(g.nodes[2].position, 0, 0)).toBe(false)
    // Whole graph visible — no subgraph filtering, nothing hidden.
    expect(lastGraphViewProps!.viewState).toEqual({ mode: "overview" })
  })

  it("keeps every node inside the frustum for a one-edge focus graph", () => {
    // Root `b` + one neighbor `a`. Ring 1 sits BELOW the root in y, so a fit
    // measured from the mean height used to leave the root outside the view.
    const two: ApiNode[] = [nodeA, nodeB]
    const oneEdge: ApiEdge[] = [apiEdges[0]]
    render(<GraphCanvas nodes={two} edges={oneEdge} schemas={[]} layoutRootRefId="b" />)
    // Drive the camera transition to completion (progress += delta / 1.2).
    tick(); tick(); tick(); tick()
    const last = fakeCameraControls.setLookAt.mock.calls.at(-1)!
    const [px, py, pz, lx, , lz] = last as number[]
    const g = lastGraphViewProps!.graph
    const tanV = Math.tan((50 / 2) * (Math.PI / 180))
    const tanH = tanV * (16 / 9)
    expect(near(g.nodes[1].position, 0, 0)).toBe(true) // root at origin
    for (const n of g.nodes) {
      const depth = py - n.position.y
      expect(depth).toBeGreaterThan(0) // camera is above every node
      // Azimuth 0 → screen-horizontal is x, screen-vertical is z (top-down).
      expect(Math.abs(n.position.x - lx) / depth).toBeLessThan(tanH)
      expect(Math.abs(n.position.z - lz) / depth).toBeLessThan(tanV)
    }
    expect(Math.abs(px - lx)).toBeLessThan(0.2)
    expect(Math.abs(pz - lz)).toBeLessThan(0.2)
    // The camera is centered ON the selected node, not on the bounding box.
    expect(Math.abs(lx - g.nodes[1].position.x)).toBeLessThan(1e-6)
    expect(Math.abs(lz - g.nodes[1].position.z)).toBeLessThan(1e-6)
  })

  it("keeps the root centered even when its neighbors are lopsided", () => {
    // Root `a` with two children: bounding-box center would sit between b and
    // c, away from a. The camera must still look straight at a and keep b, c
    // inside the frustum.
    render(<GraphCanvas nodes={apiNodes} edges={apiEdges} schemas={[]} layoutRootRefId="a" />)
    tick(); tick(); tick(); tick()
    const [, py, , lx, , lz] = fakeCameraControls.setLookAt.mock.calls.at(-1)! as number[]
    const g = lastGraphViewProps!.graph
    expect(Math.abs(lx - g.nodes[0].position.x)).toBeLessThan(1e-6)
    expect(Math.abs(lz - g.nodes[0].position.z)).toBeLessThan(1e-6)
    const tanV = Math.tan((50 / 2) * (Math.PI / 180))
    const tanH = tanV * (16 / 9)
    for (const n of g.nodes) {
      const depth = py - n.position.y
      expect(depth).toBeGreaterThan(0)
      expect(Math.abs(n.position.x - lx) / depth).toBeLessThan(tanH)
      expect(Math.abs(n.position.z - lz) / depth).toBeLessThan(tanV)
    }
  })

})
