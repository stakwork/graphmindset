export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface GraphNode {
  id: number;
  label: string;
  position: Vec3;
  degree: number;
  link?: string;
  icon?: string;
  status?: "executing" | "done" | "idle";
  progress?: number; // 0–1 for executing nodes
  content?: string; // descriptive text for detail view
  loaderId?: string;
  nodeType?: string;
  weight?: number; // 0–1 importance/relevance for visual prominence
}

export type LayoutStrategyName = "radial" | "force" | "auto";

export interface LayoutResult {
  positions: Map<number, Vec3>;
  treeEdgeSet: Set<string>;
  childrenOf: Map<number, number[]>;
}

export interface GraphEdge {
  src: number;
  dst: number;
  label?: string;
  type?: string;
  /** When true, the label's semantic direction is dst→src (e.g. flipped for layout). */
  displayReverse?: boolean;
}

export const UNSTRUCTURED_EDGE_TYPES = new Set(["references", "mentions", "relates"]);

export function isStructuralEdge(edge: GraphEdge): boolean {
  return edge.type === undefined || !UNSTRUCTURED_EDGE_TYPES.has(edge.type);
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  adj: number[][];
  outAdj: number[][];  // children: source→target (directed)
  inAdj: number[][];   // parents: target→source (directed)
  structuralAdj?: number[][];
  structuralOutAdj?: number[][];
  structuralInAdj?: number[][];
  unstructuredNodeIds?: Set<number>;
  unstructuredRegions?: { id: number; proxyNodeId: number; memberIds: number[]; expanded: boolean; radius: number; center: Vec3 }[];
  initialDepthMap?: Map<number, number>;
  treeEdgeSet?: Set<string>;
  childrenOf?: Map<number, number[]>;
}

/** Undirected edge key (order-independent) */
export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export type ViewState =
  | { mode: "overview" }
  | {
      mode: "subgraph";
      selectedNodeId: number;
      navigationHistory: number[];
      depthMap: Map<number, number>;
      neighborsByDepth: number[][];
      parentId?: number;
      visibleNodeIds: number[];
    };
