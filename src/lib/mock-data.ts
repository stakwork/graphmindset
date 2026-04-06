import type { GraphNode, GraphEdge } from "./graph-api"

export const MOCK_NODES: GraphNode[] = [
  {
    ref_id: "n1",
    node_type: "Topic",
    properties: { name: "Bitcoin", description: "A peer-to-peer electronic cash system" },
    name: "Bitcoin",
  },
  {
    ref_id: "n2",
    node_type: "Topic",
    properties: { name: "Lightning Network", description: "Layer 2 payment protocol" },
    name: "Lightning Network",
  },
  {
    ref_id: "n3",
    node_type: "Person",
    properties: { name: "Satoshi Nakamoto", twitter_handle: "satoshi" },
    name: "Satoshi Nakamoto",
  },
  {
    ref_id: "n4",
    node_type: "Topic",
    properties: { name: "Nostr", description: "Notes and Other Stuff Transmitted by Relays" },
    name: "Nostr",
  },
  {
    ref_id: "n5",
    node_type: "Person",
    properties: { name: "Jack Dorsey", twitter_handle: "jack" },
    name: "Jack Dorsey",
  },
  {
    ref_id: "n6",
    node_type: "Content",
    properties: { name: "Bitcoin Whitepaper", source_link: "https://bitcoin.org/bitcoin.pdf" },
    name: "Bitcoin Whitepaper",
  },
  {
    ref_id: "n7",
    node_type: "Topic",
    properties: { name: "Sphinx Chat", description: "Decentralized messaging on Lightning" },
    name: "Sphinx Chat",
  },
  {
    ref_id: "n8",
    node_type: "Person",
    properties: { name: "Elizabeth Stark", twitter_handle: "staborobot" },
    name: "Elizabeth Stark",
  },
]

export const MOCK_EDGES: GraphEdge[] = [
  { source: "n1", target: "n2", edge_type: "RELATED_TO" },
  { source: "n3", target: "n1", edge_type: "CREATED_BY" },
  { source: "n3", target: "n6", edge_type: "CREATED_BY" },
  { source: "n5", target: "n4", edge_type: "SUPPORTS" },
  { source: "n5", target: "n1", edge_type: "SUPPORTS" },
  { source: "n7", target: "n2", edge_type: "USES" },
  { source: "n8", target: "n2", edge_type: "CREATED_BY" },
  { source: "n4", target: "n1", edge_type: "RELATED_TO" },
]

export const MOCK_SOURCES = [
  { ref_id: "s1", source: "jack", source_type: "twitter_handle" },
  { ref_id: "s2", source: "staborobot", source_type: "twitter_handle" },
  { ref_id: "s3", source: "https://www.youtube.com/@bitcoinmagazine", source_type: "youtube_channel" },
  { ref_id: "s4", source: "https://bitcoinist.com/feed/", source_type: "rss" },
  { ref_id: "s5", source: "https://github.com/nicksparks/sphinx-nav-fiber", source_type: "github_repository" },
]

export function useMocks(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCKS === "true"
}
