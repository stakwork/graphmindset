import type { SchemaNode, SchemaEdge } from "./page"

const COLORS = [
  "#6366f1", "#0d9488", "#d97706", "#8b5cf6", "#ef4444",
  "#ec4899", "#14b8a6", "#f59e0b", "#3b82f6", "#10b981",
  "#64748b", "#e11d48", "#0ea5e9", "#a855f7", "#f97316",
]

function color(i: number) {
  return COLORS[i % COLORS.length]
}

function attrs(keys: string[]): SchemaNode["attributes"] {
  return keys.map((k, i) => ({
    key: k,
    type: k.includes("date") || k.includes("year") ? "date"
      : k.includes("count") || k.includes("age") || k.includes("amount") ? "int"
      : k.includes("rating") || k.includes("score") ? "float"
      : k.includes("active") || k.includes("verified") ? "boolean"
      : "string",
    required: i === 0,
  }))
}

export const LARGE_SCHEMAS: SchemaNode[] = [
  // Layer 0: Root
  { ref_id: "thing", type: "Thing", parent: "", color: color(0), node_key: "name", attributes: attrs(["name"]) },

  // Layer 1: Top-level categories
  { ref_id: "entity", type: "Entity", parent: "Thing", color: color(1), node_key: "name", attributes: attrs(["name", "description"]) },
  { ref_id: "concept", type: "Concept", parent: "Thing", color: color(2), node_key: "name", attributes: attrs(["name", "definition"]) },
  { ref_id: "artifact", type: "Artifact", parent: "Thing", color: color(3), node_key: "name", attributes: attrs(["name", "created_date"]) },
  { ref_id: "event-root", type: "Event", parent: "Thing", color: color(4), node_key: "name", attributes: attrs(["name", "date", "location"]) },

  // Layer 2: Entity subtypes
  { ref_id: "person", type: "Person", parent: "Entity", color: color(5), node_key: "name", attributes: attrs(["name", "twitter_handle", "image_url", "bio", "age"]) },
  { ref_id: "org", type: "Organization", parent: "Entity", color: color(6), node_key: "name", attributes: attrs(["name", "website", "industry", "founded_year", "employee_count"]) },
  { ref_id: "group", type: "Group", parent: "Entity", color: color(7), node_key: "name", attributes: attrs(["name", "purpose", "member_count"]) },
  { ref_id: "bot", type: "Bot", parent: "Entity", color: color(8), node_key: "name", attributes: attrs(["name", "platform", "active"]) },

  // Layer 2: Concept subtypes
  { ref_id: "topic", type: "Topic", parent: "Concept", color: color(9), node_key: "name", attributes: attrs(["name"]) },
  { ref_id: "category", type: "Category", parent: "Concept", color: color(10), node_key: "name", attributes: attrs(["name", "description"]) },
  { ref_id: "skill", type: "Skill", parent: "Concept", color: color(11), node_key: "name", attributes: attrs(["name", "difficulty"]) },
  { ref_id: "theory", type: "Theory", parent: "Concept", color: color(12), node_key: "name", attributes: attrs(["name", "field", "description"]) },
  { ref_id: "protocol", type: "Protocol", parent: "Concept", color: color(13), node_key: "name", attributes: attrs(["name", "version", "spec_url"]) },

  // Layer 2: Artifact subtypes
  { ref_id: "content", type: "Content", parent: "Artifact", color: color(14), node_key: "name", attributes: attrs(["name", "media_url", "source_link"]) },
  { ref_id: "software", type: "Software", parent: "Artifact", color: color(0), node_key: "name", attributes: attrs(["name", "github_url", "language", "stars_count"]) },
  { ref_id: "product", type: "Product", parent: "Artifact", color: color(1), node_key: "name", attributes: attrs(["name", "price_amount", "description"]) },
  { ref_id: "document", type: "Document", parent: "Artifact", color: color(2), node_key: "name", attributes: attrs(["name", "author", "published_date"]) },
  { ref_id: "dataset", type: "Dataset", parent: "Artifact", color: color(3), node_key: "name", attributes: attrs(["name", "source", "record_count", "format"]) },

  // Layer 2: Event subtypes
  { ref_id: "conference", type: "Conference", parent: "Event", color: color(4), node_key: "name", attributes: attrs(["name", "date", "location", "attendee_count"]) },
  { ref_id: "meetup", type: "Meetup", parent: "Event", color: color(5), node_key: "name", attributes: attrs(["name", "date", "city"]) },
  { ref_id: "incident", type: "Incident", parent: "Event", color: color(6), node_key: "name", attributes: attrs(["name", "date", "severity", "description"]) },

  // Layer 3: Person subtypes
  { ref_id: "developer", type: "Developer", parent: "Person", color: color(7), node_key: "name", attributes: attrs(["name", "github_handle", "languages", "verified"]) },
  { ref_id: "researcher", type: "Researcher", parent: "Person", color: color(8), node_key: "name", attributes: attrs(["name", "institution", "field", "h_index_count"]) },
  { ref_id: "creator", type: "Creator", parent: "Person", color: color(9), node_key: "name", attributes: attrs(["name", "platform", "subscriber_count"]) },
  { ref_id: "investor", type: "Investor", parent: "Person", color: color(10), node_key: "name", attributes: attrs(["name", "fund", "portfolio_count"]) },

  // Layer 3: Org subtypes
  { ref_id: "company", type: "Company", parent: "Organization", color: color(11), node_key: "name", attributes: attrs(["name", "ticker", "market_cap_amount", "sector"]) },
  { ref_id: "nonprofit", type: "Nonprofit", parent: "Organization", color: color(12), node_key: "name", attributes: attrs(["name", "mission", "founded_year"]) },
  { ref_id: "dao", type: "DAO", parent: "Organization", color: color(13), node_key: "name", attributes: attrs(["name", "token", "treasury_amount", "member_count"]) },
  { ref_id: "govt", type: "Government", parent: "Organization", color: color(14), node_key: "name", attributes: attrs(["name", "jurisdiction", "level"]) },

  // Layer 3: Content subtypes
  { ref_id: "article", type: "Article", parent: "Content", color: color(0), node_key: "name", attributes: attrs(["name", "author", "published_date", "word_count"]) },
  { ref_id: "podcast", type: "Podcast", parent: "Content", color: color(1), node_key: "name", attributes: attrs(["name", "host", "episode_count", "rss_url"]) },
  { ref_id: "video", type: "Video", parent: "Content", color: color(2), node_key: "name", attributes: attrs(["name", "channel", "duration", "views_count"]) },
  { ref_id: "tweet", type: "Tweet", parent: "Content", color: color(3), node_key: "name", attributes: attrs(["name", "author", "likes_count", "retweet_count"]) },
  { ref_id: "paper", type: "Paper", parent: "Content", color: color(4), node_key: "name", attributes: attrs(["name", "authors", "journal", "citation_count", "doi"]) },
  { ref_id: "book", type: "Book", parent: "Content", color: color(5), node_key: "name", attributes: attrs(["name", "author", "isbn", "page_count"]) },

  // Layer 3: Software subtypes
  { ref_id: "library", type: "Library", parent: "Software", color: color(6), node_key: "name", attributes: attrs(["name", "language", "version", "downloads_count"]) },
  { ref_id: "framework", type: "Framework", parent: "Software", color: color(7), node_key: "name", attributes: attrs(["name", "language", "version"]) },
  { ref_id: "app", type: "Application", parent: "Software", color: color(8), node_key: "name", attributes: attrs(["name", "platform", "version", "active_users_count"]) },
  { ref_id: "smart-contract", type: "SmartContract", parent: "Software", color: color(9), node_key: "name", attributes: attrs(["name", "chain", "address", "verified"]) },

  // Layer 3: Protocol subtypes
  { ref_id: "blockchain", type: "Blockchain", parent: "Protocol", color: color(10), node_key: "name", attributes: attrs(["name", "consensus", "tps_count", "token"]) },
  { ref_id: "network-protocol", type: "NetworkProtocol", parent: "Protocol", color: color(11), node_key: "name", attributes: attrs(["name", "layer", "spec_url"]) },
  { ref_id: "api-spec", type: "APISpec", parent: "Protocol", color: color(12), node_key: "name", attributes: attrs(["name", "version", "format"]) },

  // Layer 4: Deep subtypes
  { ref_id: "episode", type: "Episode", parent: "Podcast", color: color(13), node_key: "name", attributes: attrs(["name", "episode_number", "duration", "media_url", "transcript"]) },
  { ref_id: "clip", type: "Clip", parent: "Episode", color: color(14), node_key: "name", attributes: attrs(["name", "timestamp", "duration", "media_url"]) },
  { ref_id: "thread", type: "Thread", parent: "Tweet", color: color(0), node_key: "name", attributes: attrs(["name", "author", "tweet_count"]) },
  { ref_id: "pr", type: "PullRequest", parent: "Software", color: color(1), node_key: "name", attributes: attrs(["name", "repo", "status", "author"]) },
  { ref_id: "issue", type: "Issue", parent: "Software", color: color(2), node_key: "name", attributes: attrs(["name", "repo", "status", "priority"]) },
  { ref_id: "token", type: "Token", parent: "Blockchain", color: color(3), node_key: "name", attributes: attrs(["name", "symbol", "supply_count", "chain"]) },
  { ref_id: "nft", type: "NFT", parent: "Token", color: color(4), node_key: "name", attributes: attrs(["name", "collection", "token_id", "owner"]) },
  { ref_id: "defi", type: "DeFiProtocol", parent: "SmartContract", color: color(5), node_key: "name", attributes: attrs(["name", "tvl_amount", "chain", "category"]) },
]

export const LARGE_EDGES: SchemaEdge[] = [
  // Person relationships
  { ref_id: "e01", source: "person", target: "content", edge_type: "CREATED_BY" },
  { ref_id: "e02", source: "person", target: "org", edge_type: "MEMBER_OF" },
  { ref_id: "e03", source: "person", target: "skill", edge_type: "HAS" },
  { ref_id: "e04", source: "person", target: "event-root", edge_type: "ATTENDED" },
  { ref_id: "e05", source: "developer", target: "software", edge_type: "CONTRIBUTES_TO" },
  { ref_id: "e06", source: "developer", target: "pr", edge_type: "AUTHORED" },
  { ref_id: "e07", source: "researcher", target: "paper", edge_type: "AUTHORED" },
  { ref_id: "e08", source: "creator", target: "podcast", edge_type: "HOSTS" },
  { ref_id: "e09", source: "investor", target: "company", edge_type: "INVESTED_IN" },
  { ref_id: "e10", source: "investor", target: "dao", edge_type: "INVESTED_IN" },

  // Content relationships
  { ref_id: "e11", source: "content", target: "topic", edge_type: "MENTIONS" },
  { ref_id: "e12", source: "content", target: "person", edge_type: "FEATURES" },
  { ref_id: "e13", source: "article", target: "paper", edge_type: "CITES" },
  { ref_id: "e14", source: "tweet", target: "topic", edge_type: "TAGGED" },
  { ref_id: "e15", source: "video", target: "person", edge_type: "FEATURES" },
  { ref_id: "e16", source: "paper", target: "dataset", edge_type: "USES" },

  // Software relationships
  { ref_id: "e17", source: "software", target: "org", edge_type: "DEVELOPED_BY" },
  { ref_id: "e18", source: "library", target: "framework", edge_type: "USED_BY" },
  { ref_id: "e19", source: "app", target: "api-spec", edge_type: "IMPLEMENTS" },
  { ref_id: "e20", source: "smart-contract", target: "blockchain", edge_type: "DEPLOYED_ON" },
  { ref_id: "e21", source: "defi", target: "token", edge_type: "USES" },
  { ref_id: "e22", source: "framework", target: "library", edge_type: "DEPENDS_ON" },

  // Organization relationships
  { ref_id: "e23", source: "company", target: "product", edge_type: "PRODUCES" },
  { ref_id: "e24", source: "company", target: "software", edge_type: "MAINTAINS" },
  { ref_id: "e25", source: "dao", target: "token", edge_type: "GOVERNS" },
  { ref_id: "e26", source: "nonprofit", target: "topic", edge_type: "ADVOCATES" },
  { ref_id: "e27", source: "govt", target: "protocol", edge_type: "REGULATES" },

  // Event relationships
  { ref_id: "e28", source: "conference", target: "topic", edge_type: "COVERS" },
  { ref_id: "e29", source: "conference", target: "org", edge_type: "ORGANIZED_BY" },
  { ref_id: "e30", source: "meetup", target: "group", edge_type: "HOSTED_BY" },
  { ref_id: "e31", source: "incident", target: "software", edge_type: "AFFECTS" },

  // Cross-cutting
  { ref_id: "e32", source: "topic", target: "category", edge_type: "BELONGS_TO" },
  { ref_id: "e33", source: "theory", target: "paper", edge_type: "DESCRIBED_IN" },
  { ref_id: "e34", source: "protocol", target: "document", edge_type: "SPECIFIED_IN" },
  { ref_id: "e35", source: "blockchain", target: "network-protocol", edge_type: "EXTENDS" },
  { ref_id: "e36", source: "product", target: "software", edge_type: "POWERED_BY" },
  { ref_id: "e37", source: "book", target: "person", edge_type: "AUTHORED_BY" },
  { ref_id: "e38", source: "nft", target: "creator", edge_type: "CREATED_BY" },
  { ref_id: "e39", source: "episode", target: "person", edge_type: "GUEST" },
  { ref_id: "e40", source: "clip", target: "topic", edge_type: "DISCUSSES" },
]
