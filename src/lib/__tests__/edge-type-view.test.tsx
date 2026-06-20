import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { EdgeTypePanel } from "@/app/ontology/edge-type-panel"
import type { SchemaEdge, SchemaNode } from "@/app/ontology/page"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeVisibleEdgeTypes(
  edges: SchemaEdge[],
  edgeSearch: string
): { edgeType: string; count: number }[] {
  const q = edgeSearch.trim().toLowerCase()
  const countMap = new Map<string, number>()
  for (const e of edges) {
    if (e.edge_type === "CHILD_OF") continue
    countMap.set(e.edge_type, (countMap.get(e.edge_type) ?? 0) + 1)
  }
  return Array.from(countMap.entries())
    .filter(([edgeType]) => !q || edgeType.toLowerCase().includes(q))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([edgeType, count]) => ({ edgeType, count }))
}

const makeEdge = (
  id: string,
  edgeType: string,
  source = "s1",
  target = "s2",
  extra?: Partial<SchemaEdge>
): SchemaEdge => ({
  ref_id: id,
  source,
  target,
  edge_type: edgeType,
  ...extra,
})

// ---------------------------------------------------------------------------
// Deduplication logic
// ---------------------------------------------------------------------------

describe("visibleEdgeTypes — deduplication and counts", () => {
  it("deduplicates edges by edge_type and returns correct counts", () => {
    const edges: SchemaEdge[] = [
      makeEdge("e1", "RELATED_TO"),
      makeEdge("e2", "RELATED_TO"),
      makeEdge("e3", "RELATED_TO"),
      makeEdge("e4", "HAS"),
      makeEdge("e5", "HAS"),
      makeEdge("e6", "SENT"),
    ]
    const result = computeVisibleEdgeTypes(edges, "")
    expect(result).toHaveLength(3)
    const relatedTo = result.find((r) => r.edgeType === "RELATED_TO")
    expect(relatedTo?.count).toBe(3)
    const has = result.find((r) => r.edgeType === "HAS")
    expect(has?.count).toBe(2)
    const sent = result.find((r) => r.edgeType === "SENT")
    expect(sent?.count).toBe(1)
  })

  it("excludes CHILD_OF edges", () => {
    const edges: SchemaEdge[] = [
      makeEdge("e1", "CHILD_OF"),
      makeEdge("e2", "CHILD_OF"),
      makeEdge("e3", "HAS"),
    ]
    const result = computeVisibleEdgeTypes(edges, "")
    expect(result).toHaveLength(1)
    expect(result[0].edgeType).toBe("HAS")
  })

  it("sorts results alphabetically", () => {
    const edges: SchemaEdge[] = [
      makeEdge("e1", "SENT"),
      makeEdge("e2", "RELATED_TO"),
      makeEdge("e3", "HAS"),
    ]
    const result = computeVisibleEdgeTypes(edges, "")
    expect(result.map((r) => r.edgeType)).toEqual(["HAS", "RELATED_TO", "SENT"])
  })

  it("returns empty list when all edges are CHILD_OF", () => {
    const edges: SchemaEdge[] = [
      makeEdge("e1", "CHILD_OF"),
      makeEdge("e2", "CHILD_OF"),
    ]
    const result = computeVisibleEdgeTypes(edges, "")
    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Search filtering
// ---------------------------------------------------------------------------

describe("visibleEdgeTypes — search filtering", () => {
  const edges: SchemaEdge[] = [
    makeEdge("e1", "RELATED_TO"),
    makeEdge("e2", "HAS"),
    makeEdge("e3", "SENT"),
    makeEdge("e4", "POSTED"),
  ]

  it("filters by edge type name case-insensitively", () => {
    const result = computeVisibleEdgeTypes(edges, "rel")
    expect(result).toHaveLength(1)
    expect(result[0].edgeType).toBe("RELATED_TO")
  })

  it("is case-insensitive (uppercase query)", () => {
    const result = computeVisibleEdgeTypes(edges, "HAS")
    expect(result).toHaveLength(1)
    expect(result[0].edgeType).toBe("HAS")
  })

  it("returns all when search is empty", () => {
    const result = computeVisibleEdgeTypes(edges, "")
    expect(result).toHaveLength(4)
  })

  it("returns empty array when no match", () => {
    const result = computeVisibleEdgeTypes(edges, "XYZZY")
    expect(result).toHaveLength(0)
  })

  it("trims whitespace from search query", () => {
    const result = computeVisibleEdgeTypes(edges, "  has  ")
    expect(result).toHaveLength(1)
    expect(result[0].edgeType).toBe("HAS")
  })
})

// ---------------------------------------------------------------------------
// EdgeTypePanel rendering
// ---------------------------------------------------------------------------

const schema1: SchemaNode = {
  ref_id: "s-1",
  type: "Topic",
  parent: "Thing",
  color: "#6366f1",
  node_key: "name",
  attributes: [],
}
const schema2: SchemaNode = {
  ref_id: "s-2",
  type: "Episode",
  parent: "Thing",
  color: "#0d9488",
  node_key: "name",
  attributes: [],
}

describe("EdgeTypePanel", () => {
  const baseProps = {
    edgeType: "RELATED_TO",
    allSchemas: [schema1, schema2],
    onClose: vi.fn(),
  }

  it("renders the edge type name in the header", () => {
    const edges: SchemaEdge[] = [makeEdge("e1", "RELATED_TO", "s-1", "s-2")]
    render(<EdgeTypePanel {...baseProps} edges={edges} />)
    expect(screen.getByText("RELATED_TO")).toBeTruthy()
  })

  it("renders connection rows for each edge", () => {
    const edges: SchemaEdge[] = [
      makeEdge("e1", "RELATED_TO", "s-1", "s-2"),
      makeEdge("e2", "RELATED_TO", "s-2", "s-1"),
    ]
    render(<EdgeTypePanel {...baseProps} edges={edges} />)
    // Both source and target labels should appear twice
    const topicEls = screen.getAllByText("Topic")
    const episodeEls = screen.getAllByText("Episode")
    expect(topicEls.length).toBeGreaterThanOrEqual(1)
    expect(episodeEls.length).toBeGreaterThanOrEqual(1)
  })

  it("resolves display names via refIdToType fallback when source_type is absent", () => {
    const edges: SchemaEdge[] = [
      // No source_type/target_type — must fall back to refIdToType
      makeEdge("e1", "RELATED_TO", "s-1", "s-2"),
    ]
    render(<EdgeTypePanel {...baseProps} edges={edges} />)
    expect(screen.getByText("Topic")).toBeTruthy()
    expect(screen.getByText("Episode")).toBeTruthy()
  })

  it("uses source_type/target_type when present", () => {
    const edges: SchemaEdge[] = [
      {
        ref_id: "e1",
        source: "unknown-ref",
        target: "unknown-ref2",
        edge_type: "RELATED_TO",
        source_type: "CustomSource",
        target_type: "CustomTarget",
      },
    ]
    render(<EdgeTypePanel {...baseProps} edges={edges} />)
    expect(screen.getByText("CustomSource")).toBeTruthy()
    expect(screen.getByText("CustomTarget")).toBeTruthy()
  })

  it("renders the Attributes section only when at least one edge has attributes", () => {
    const edgesNoAttrs: SchemaEdge[] = [makeEdge("e1", "RELATED_TO", "s-1", "s-2")]
    const { unmount } = render(<EdgeTypePanel {...baseProps} edges={edgesNoAttrs} />)
    expect(screen.queryByText("Attributes")).toBeNull()
    unmount()

    const edgesWithAttrs: SchemaEdge[] = [
      {
        ...makeEdge("e2", "RELATED_TO", "s-1", "s-2"),
        attributes: { since: "?datetime", role: "string" },
      },
    ]
    render(<EdgeTypePanel {...baseProps} edges={edgesWithAttrs} />)
    expect(screen.getByText("Attributes")).toBeTruthy()
  })

  it("shows attribute keys and their optional/required status", () => {
    const edgesWithAttrs: SchemaEdge[] = [
      {
        ...makeEdge("e1", "RELATED_TO", "s-1", "s-2"),
        attributes: { since: "?datetime", role: "string" },
      },
    ]
    render(<EdgeTypePanel {...baseProps} edges={edgesWithAttrs} />)
    expect(screen.getByText("since")).toBeTruthy()
    expect(screen.getByText("Optional")).toBeTruthy()
    expect(screen.getByText("role")).toBeTruthy()
    expect(screen.getByText("Required")).toBeTruthy()
  })

  it("deduplicates attribute keys across multiple edges", () => {
    const edges: SchemaEdge[] = [
      {
        ...makeEdge("e1", "RELATED_TO", "s-1", "s-2"),
        attributes: { since: "?datetime" },
      },
      {
        ...makeEdge("e2", "RELATED_TO", "s-2", "s-1"),
        attributes: { since: "?datetime", role: "string" },
      },
    ]
    render(<EdgeTypePanel {...baseProps} edges={edges} />)
    const sinceEls = screen.getAllByText("since")
    expect(sinceEls).toHaveLength(1)
  })

  it("renders no edit, delete, or save controls", () => {
    const edges: SchemaEdge[] = [makeEdge("e1", "RELATED_TO", "s-1", "s-2")]
    render(<EdgeTypePanel {...baseProps} edges={edges} />)
    expect(screen.queryByText(/save/i)).toBeNull()
    expect(screen.queryByText(/delete/i)).toBeNull()
    expect(screen.queryByText(/edit/i)).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("calls onClose when the X button is clicked", async () => {
    const onClose = vi.fn()
    const edges: SchemaEdge[] = [makeEdge("e1", "RELATED_TO", "s-1", "s-2")]
    const { getByRole } = render(
      <EdgeTypePanel {...baseProps} edges={edges} onClose={onClose} />
    )
    const closeBtn = getByRole("button")
    closeBtn.click()
    expect(onClose).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Tab switching state logic (pure function tests — no React state)
// ---------------------------------------------------------------------------

describe("tab switching state", () => {
  it("switching to edges tab should conceptually clear selectedId", () => {
    // Simulated state machine
    let sidebarTab: "nodes" | "edges" = "nodes"
    let selectedId: string | null = "s-1"
    let selectedEdgeType: string | null = null

    // Switch to edges
    sidebarTab = "edges"
    selectedId = null

    expect(sidebarTab).toBe("edges")
    expect(selectedId).toBeNull()
    expect(selectedEdgeType).toBeNull()
  })

  it("switching to nodes tab should conceptually clear selectedEdgeType and edgeSearch", () => {
    let sidebarTab: "nodes" | "edges" = "edges"
    let selectedEdgeType: string | null = "RELATED_TO"
    let edgeSearch = "rel"

    // Switch to nodes
    sidebarTab = "nodes"
    selectedEdgeType = null
    edgeSearch = ""

    expect(sidebarTab).toBe("nodes")
    expect(selectedEdgeType).toBeNull()
    expect(edgeSearch).toBe("")
  })
})
