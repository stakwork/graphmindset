import type { SchemaNode, SchemaEdge } from "./page"

export const SMALL_SCHEMAS: SchemaNode[] = [
  {
    ref_id: "s-thing",
    type: "Thing",
    parent: "",
    color: "#6366f1",
    node_key: "name",
    attributes: [{ key: "name", type: "string", required: true }],
  },
  {
    ref_id: "s-person",
    type: "Person",
    parent: "Thing",
    color: "#0d9488",
    node_key: "name",
    attributes: [
      { key: "name", type: "string", required: true },
      { key: "twitter_handle", type: "string", required: false },
      { key: "image_url", type: "string", required: false },
      { key: "description", type: "string", required: false },
    ],
  },
  {
    ref_id: "s-org",
    type: "Organization",
    parent: "Thing",
    color: "#d97706",
    node_key: "name",
    attributes: [
      { key: "name", type: "string", required: true },
      { key: "website", type: "string", required: false },
      { key: "description", type: "string", required: false },
    ],
  },
  {
    ref_id: "s-topic",
    type: "Topic",
    parent: "Thing",
    color: "#8b5cf6",
    node_key: "name",
    attributes: [{ key: "name", type: "string", required: true }],
  },
  {
    ref_id: "s-content",
    type: "Content",
    parent: "Thing",
    color: "#ef4444",
    node_key: "name",
    attributes: [
      { key: "name", type: "string", required: true },
      { key: "media_url", type: "string", required: false },
      { key: "source_link", type: "string", required: false },
      { key: "description", type: "string", required: false },
    ],
  },
  {
    ref_id: "s-event",
    type: "Event",
    parent: "Thing",
    color: "#ec4899",
    node_key: "name",
    attributes: [
      { key: "name", type: "string", required: true },
      { key: "date", type: "string", required: false },
      { key: "location", type: "string", required: false },
    ],
  },
  {
    ref_id: "s-software",
    type: "Software",
    parent: "Thing",
    color: "#14b8a6",
    node_key: "name",
    attributes: [
      { key: "name", type: "string", required: true },
      { key: "github_url", type: "string", required: false },
      { key: "language", type: "string", required: false },
    ],
  },
]

export const SMALL_EDGES: SchemaEdge[] = [
  { ref_id: "e1", source: "s-person", target: "s-content", edge_type: "CREATED_BY" },
  { ref_id: "e2", source: "s-person", target: "s-org", edge_type: "MEMBER_OF" },
  { ref_id: "e3", source: "s-content", target: "s-topic", edge_type: "MENTIONS" },
  { ref_id: "e4", source: "s-software", target: "s-org", edge_type: "DEVELOPED_BY" },
  { ref_id: "e5", source: "s-event", target: "s-topic", edge_type: "RELATED_TO" },
]
