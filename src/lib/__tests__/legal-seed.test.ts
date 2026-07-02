/**
 * Unit tests for getLegalInitialNodes() and related legal-skin components.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ── Sphinx / auth mocks ───────────────────────────────────────────────────────
const { getL402Mock, getSignedMessageMock } = vi.hoisted(() => ({
  getL402Mock: vi.fn(),
  getSignedMessageMock: vi.fn(),
}))

vi.mock("@/lib/sphinx", () => ({
  getL402: getL402Mock,
  getSignedMessage: getSignedMessageMock,
}))

// Real API mode by default (overridden per-test where needed)
vi.mock("@/lib/mock-data", () => ({
  isMocksEnabled: () => false,
  MOCK_NODES: [],
  MOCK_EDGES: [],
  MOCK_REVIEWS: [],
  MOCK_WORKFLOW_MARKETPLACE: [],
}))

import { getLegalInitialNodes } from "@/lib/graph-api"
import type { GraphNode, GraphEdge } from "@/lib/graph-api"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNode(ref_id: string, node_type: string): GraphNode {
  return { ref_id, node_type, properties: { name: ref_id } }
}

function makeEdge(source: string, target: string, edge_type = "RELATED", ref_id?: string): GraphEdge {
  return { source, target, edge_type, ref_id }
}

// Build a minimal fetch mock that handles all the expected URL patterns
function buildFetchMock(config: {
  agreements: GraphNode[]
  expansions: Record<string, { nodes: GraphNode[]; edges: GraphEdge[] }>
  topupOrgs?: GraphNode[]
  topupPersons?: GraphNode[]
}) {
  return vi.fn(async (url: string) => {
    const u = url.toString()

    // Agreement latest
    if (u.includes("node_type=Agreement")) {
      return { ok: true, json: async () => ({ nodes: config.agreements }) }
    }
    // Organization top-up
    if (u.includes("node_type=Organization")) {
      return { ok: true, json: async () => ({ nodes: config.topupOrgs ?? [] }) }
    }
    // Person top-up
    if (u.includes("node_type=Person")) {
      return { ok: true, json: async () => ({ nodes: config.topupPersons ?? [] }) }
    }
    // Node expand (/v2/nodes/:refId?expand=edges)
    const expandMatch = u.match(/\/v2\/nodes\/([^?]+)\?expand=edges/)
    if (expandMatch) {
      const refId = expandMatch[1]
      const data = config.expansions[refId] ?? { nodes: [], edges: [] }
      return { ok: true, json: async () => data }
    }

    return { ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch
}

const originalFetch = global.fetch

beforeEach(() => {
  getSignedMessageMock.mockResolvedValue({ signature: "", message: "" })
  getL402Mock.mockResolvedValue(null)
})

afterEach(() => {
  global.fetch = originalFetch
  vi.clearAllMocks()
})

// ── getLegalInitialNodes ───────────────────────────────────────────────────────

describe("getLegalInitialNodes", () => {
  it("returns agreements + expanded orgs/persons and filters edges correctly", async () => {
    const agreement = makeNode("agr-1", "Agreement")
    const org1 = makeNode("org-1", "Organization")
    const person1 = makeNode("per-1", "Person")
    const edgeInSet = makeEdge("agr-1", "org-1", "HAS_PARTY", "e-1")
    const edgeOutOfSet = makeEdge("agr-1", "unknown-node", "UNRELATED", "e-2")

    global.fetch = buildFetchMock({
      agreements: [agreement],
      expansions: {
        "agr-1": {
          nodes: [org1, person1],
          edges: [edgeInSet, edgeOutOfSet],
        },
      },
      topupOrgs: [], // not needed — already ≥ 1 (test with < 10 but no top-up orgs)
      topupPersons: [],
    })

    const result = await getLegalInitialNodes()

    // Final nodes: 1 agreement + 1 org + 1 person
    expect(result.nodes).toHaveLength(3)
    const refIds = result.nodes.map((n) => n.ref_id)
    expect(refIds).toContain("agr-1")
    expect(refIds).toContain("org-1")
    expect(refIds).toContain("per-1")

    // Only the edge with both endpoints in the final set is kept
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].ref_id).toBe("e-1")
  })

  it("fires top-up for both Org and Person when no neighbors found (0 expansion)", async () => {
    const agreement = makeNode("agr-1", "Agreement")
    const topupOrg = makeNode("org-tu-1", "Organization")
    const topupPerson = makeNode("per-tu-1", "Person")

    global.fetch = buildFetchMock({
      agreements: [agreement],
      expansions: { "agr-1": { nodes: [], edges: [] } },
      topupOrgs: [topupOrg],
      topupPersons: [topupPerson],
    })

    const result = await getLegalInitialNodes()

    const types = result.nodes.map((n) => n.node_type)
    expect(types).toContain("Agreement")
    expect(types).toContain("Organization")
    expect(types).toContain("Person")
  })

  it("top-up adds exactly 2 more orgs when 8 already found via expansion", async () => {
    const agreement = makeNode("agr-1", "Agreement")
    // 8 orgs from expansion
    const expansionOrgs = Array.from({ length: 8 }, (_, i) => makeNode(`org-${i}`, "Organization"))
    const expansionEdges = expansionOrgs.map((o) =>
      makeEdge("agr-1", o.ref_id, "HAS_PARTY", `e-${o.ref_id}`)
    )
    // 5 top-up orgs (only 2 should be taken)
    const topupOrgs = Array.from({ length: 5 }, (_, i) => makeNode(`org-tu-${i}`, "Organization"))

    global.fetch = buildFetchMock({
      agreements: [agreement],
      expansions: { "agr-1": { nodes: expansionOrgs, edges: expansionEdges } },
      topupOrgs,
      topupPersons: [],
    })

    const result = await getLegalInitialNodes()

    const orgNodes = result.nodes.filter((n) => n.node_type === "Organization")
    expect(orgNodes).toHaveLength(10)
  })

  it("deduplicates orgs appearing in multiple agreement expansions", async () => {
    const agr1 = makeNode("agr-1", "Agreement")
    const agr2 = makeNode("agr-2", "Agreement")
    const sharedOrg = makeNode("org-shared", "Organization")
    const edge1 = makeEdge("agr-1", "org-shared", "HAS_PARTY", "e-1")
    const edge2 = makeEdge("agr-2", "org-shared", "HAS_PARTY", "e-2")

    global.fetch = buildFetchMock({
      agreements: [agr1, agr2],
      expansions: {
        "agr-1": { nodes: [sharedOrg], edges: [edge1] },
        "agr-2": { nodes: [sharedOrg], edges: [edge2] },
      },
      topupOrgs: [],
      topupPersons: [],
    })

    const result = await getLegalInitialNodes()

    const orgNodes = result.nodes.filter((n) => n.node_type === "Organization")
    expect(orgNodes).toHaveLength(1)
    expect(orgNodes[0].ref_id).toBe("org-shared")
  })

  it("excludes edges where one or both endpoints are not in the final node set", async () => {
    const agreement = makeNode("agr-1", "Agreement")
    const org = makeNode("org-1", "Organization")
    const outsider = makeNode("outsider-1", "SomeOtherType")

    const edgeValid = makeEdge("agr-1", "org-1", "HAS_PARTY", "e-valid")
    const edgeMissingTarget = makeEdge("agr-1", "outsider-1", "UNRELATED", "e-bad-target")
    const edgeMissingBoth = makeEdge("nobody-a", "nobody-b", "UNRELATED", "e-bad-both")

    global.fetch = buildFetchMock({
      agreements: [agreement],
      expansions: {
        "agr-1": {
          nodes: [org, outsider],
          edges: [edgeValid, edgeMissingTarget, edgeMissingBoth],
        },
      },
      topupOrgs: [],
      topupPersons: [],
    })

    const result = await getLegalInitialNodes()

    // outsider is not Agreement/Organization/Person — not in final set
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].ref_id).toBe("e-valid")
  })

  it("deduplicates edges by ref_id", async () => {
    const agr1 = makeNode("agr-1", "Agreement")
    const agr2 = makeNode("agr-2", "Agreement")
    const org = makeNode("org-1", "Organization")

    // Same edge ref_id returned from two expansions
    const dupEdge1 = makeEdge("agr-1", "org-1", "HAS_PARTY", "dup-edge")
    const dupEdge2 = makeEdge("agr-1", "org-1", "HAS_PARTY", "dup-edge")

    global.fetch = buildFetchMock({
      agreements: [agr1, agr2],
      expansions: {
        "agr-1": { nodes: [org], edges: [dupEdge1] },
        "agr-2": { nodes: [org], edges: [dupEdge2] },
      },
      topupOrgs: [],
      topupPersons: [],
    })

    const result = await getLegalInitialNodes()

    expect(result.edges).toHaveLength(1)
  })

  it("deduplicates edges by composite key when ref_id is absent", async () => {
    const agreement = makeNode("agr-1", "Agreement")
    const org = makeNode("org-1", "Organization")

    // No ref_id on these edges — dedup by source+target+type composite
    const edge1: GraphEdge = { source: "agr-1", target: "org-1", edge_type: "HAS_PARTY" }
    const edge2: GraphEdge = { source: "agr-1", target: "org-1", edge_type: "HAS_PARTY" }

    global.fetch = buildFetchMock({
      agreements: [agreement],
      expansions: { "agr-1": { nodes: [org], edges: [edge1, edge2] } },
      topupOrgs: [],
      topupPersons: [],
    })

    const result = await getLegalInitialNodes()

    expect(result.edges).toHaveLength(1)
  })
})
