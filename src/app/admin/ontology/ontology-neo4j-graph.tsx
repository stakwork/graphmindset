"use client"

import { memo, useCallback, useEffect, useMemo } from "react"
import { Neo4jCanvas } from "@/components/universe/neo4j-canvas"
import type { GraphNode } from "@/lib/graph-api"
import { HIERARCHY_EDGE_TYPE, ontologyGraphData } from "@/lib/ontology-graph-data"
import type { SchemaNode, SchemaEdge } from "@/lib/schema-types"

interface Props {
  schemas: SchemaNode[]
  edges: SchemaEdge[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Clear the selection (Esc) to return to the full view. */
  onClear?: () => void
  selectedEdgeType?: string | null
}

// The ontology drawn with the main graph's 2D canvas (Neo4jCanvas): each
// schema type is a node, schema relationships are edges, CHILD_OF is a quiet
// dashed skeleton, and types are coloured by their top-level branch.
// Selecting a type swaps in that type and its direct neighbors, centered on
// it; selecting an edge type shows only the types that relationship connects.
//
// Memoized so page re-renders for unrelated reasons (chat busy-state, panel
// toggles) don't re-reconcile the SVG. Keep parent-supplied handlers stable.
export const OntologyNeo4jGraph = memo(function OntologyNeo4jGraph({
  schemas,
  edges,
  selectedId,
  onSelect,
  onClear,
  selectedEdgeType = null,
}: Props) {
  const data = useMemo(
    () => ontologyGraphData(schemas, edges, selectedId, selectedEdgeType),
    [schemas, edges, selectedId, selectedEdgeType]
  )

  const handleNodeSelect = useCallback((node: GraphNode) => onSelect(node.ref_id), [onSelect])

  // Esc clears the selection and returns to the full ontology view.
  useEffect(() => {
    if (!selectedId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClear?.()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selectedId, onClear])

  return (
    <Neo4jCanvas
      nodes={data.nodes}
      edges={data.edges}
      schemas={schemas}
      layoutRootRefId={data.rootRefId}
      layoutKey={data.layoutKey}
      selectedRefId={selectedId}
      nodeGroups={data.groups}
      quietRelType={HIERARCHY_EDGE_TYPE}
      allCaptions
      onNodeSelect={handleNodeSelect}
    />
  )
})
