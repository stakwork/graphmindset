import type { GraphNode, GraphEdge, GraphData, Review, StakworkRun } from "./graph-api"

export const MOCK_NODES: GraphNode[] = [
  {
    ref_id: "n1",
    node_type: "Topic",
    properties: { name: "Bitcoin", description: "A peer-to-peer electronic cash system" },
  },
  {
    ref_id: "n2",
    node_type: "Tweet",
    properties: {
      name: "Jack Dorsey",
      twitter_handle: "jack",
      text: "Bitcoin is freedom tech. It’s the most important invention since the internet.",
      tweet_id: "1725483021849382912",
      date: 1700179200,
      image_url: "https://picsum.photos/seed/tweet-jack/120",
    },
  },
  {
    ref_id: "n3",
    node_type: "Person",
    properties: { name: "Satoshi Nakamoto", description: "Creator of Bitcoin", twitter_handle: "satoshi", image_url: "https://picsum.photos/seed/satoshi/120" },
  },
  {
    ref_id: "n4",
    node_type: "Episode",
    properties: {
      episode_title: "What Bitcoin Did #412",
      description: "Peter McCormack interviews a Lightning developer about Bitcoin scaling, Layer 2, and the future of payments.",
      show_title: "What Bitcoin Did",
      date: "2024-08-12",
      thumbnail: "https://picsum.photos/seed/wbd412/120",
    },
  },
  {
    ref_id: "n5",
    node_type: "Video",
    properties: {
      episode_title: "Bitcoin for Beginners",
      description: "An introductory video explaining how Bitcoin works and why it matters",
      date: "2024-03-04",
      image_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Bitcoin.svg/320px-Bitcoin.svg.png",
    },
  },
  {
    ref_id: "n6",
    node_type: "Document",
    properties: {
      title: "Bitcoin Whitepaper",
      summary: "A purely peer-to-peer version of electronic cash without a financial intermediary.",
      author: "Satoshi Nakamoto",
      content_type: "paper",
      source_link: "https://bitcoin.org/bitcoin.pdf",
      image_url: "https://picsum.photos/seed/whitepaper/120",
    },
  },
  {
    ref_id: "n7",
    node_type: "Topic",
    properties: { name: "Sphinx Chat", description: "Decentralized messaging on Lightning" },
  },
  {
    ref_id: "n8",
    node_type: "Clip",
    properties: {
      episode_title: "Bitcoin Mining Explained",
      description: "A 3-minute clip explaining proof-of-work mining, hash rates, and difficulty adjustments.",
      date: "2024-09-19",
      thumbnail: "https://example.invalid/this-image-404.jpg",
    },
  },
  {
    ref_id: "n9",
    node_type: "TwitterAccount",
    properties: { twitter_handle: "AnthropicAI", name: "Anthropic", image_url: "https://picsum.photos/seed/anthropic-ai/120", verified: true },
  },
  {
    ref_id: "n10",
    node_type: "Section",
    properties: {
      text: "Section 4 — Proof-of-Work",
      summary: "To implement a distributed timestamp server on a peer-to-peer basis, we will need to use a proof-of-work system similar to Adam Back's Hashcash.",
      source_link: "https://bitcoin.org/bitcoin.pdf",
    },
  },
  {
    ref_id: "n11",
    node_type: "Claim",
    properties: {
      name: "Lightning enables instant Bitcoin payments",
      claim_text: "The Lightning Network allows Bitcoin transactions to settle instantly off-chain by routing payments through a network of bidirectional payment channels.",
      speaker_name: "Lightning developer",
      source_role: "guest",
    },
  },
  {
    ref_id: "n12",
    node_type: "WebPage",
    properties: { name: "Sphinx Chat Website", description: "Decentralised messaging on Lightning." },
  },
]

// Full node data returned after unlock (simulates GET /v2/nodes/:ref_id?expand=edges)
export const MOCK_FULL_NODES: Record<string, GraphData> = {
  n1: {
    nodes: [
      {
        ref_id: "n1",
        node_type: "Topic",
        properties: {
          name: "Bitcoin",
          description: "A peer-to-peer electronic cash system enabling online payments without a financial institution. Proposed by Satoshi Nakamoto in 2008 and launched in January 2009.",
          source_link: "https://bitcoin.org",
        },
      },
      {
        ref_id: "n3",
        node_type: "Person",
        properties: {
          name: "Satoshi Nakamoto",
          description: "Pseudonymous creator of Bitcoin and author of the original whitepaper.",
          twitter_handle: "satoshi",
          bio: "Invented Bitcoin in 2008, mined the genesis block on January 3, 2009.",
        },
      },
    ],
    edges: [
      { source: "n3", target: "n1", edge_type: "MENTIONS" },
    ],
  },
  n2: {
    nodes: [
      {
        ref_id: "n2",
        node_type: "Tweet",
        properties: {
          name: "Jack Dorsey",
          twitter_handle: "jack",
          text: "Bitcoin is freedom tech. It\u2019s the most important invention since the internet. Don\u2019t let anyone tell you otherwise. The separation of money and state is happening whether governments like it or not.",
          tweet_id: "1725483021849382912",
          date: 1700179200,
          image_url: "https://picsum.photos/seed/tweet-jack-avatar/96",
          verified: true,
          reply_count: 1240,
          retweet_count: 12400,
          like_count: 42800,
          quote_count: 380,
          impression_count: 2_140_000,
        },
      },
    ],
    edges: [],
  },
  n3: {
    nodes: [
      {
        ref_id: "n3",
        node_type: "Person",
        properties: {
          name: "Satoshi Nakamoto",
          description: "Pseudonymous creator of Bitcoin and author of the original whitepaper. Identity remains unknown.",
          twitter_handle: "satoshi",
          image_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Bitcoin_UV_front.jpg/320px-Bitcoin_UV_front.jpg",
          bio: "Invented Bitcoin in 2008, mined the genesis block on January 3, 2009. Disappeared from public communication in 2011.",
        },
      },
    ],
    edges: [],
  },
  n4: {
    nodes: [
      {
        ref_id: "n4",
        node_type: "Episode",
        properties: {
          episode_title: "What Bitcoin Did #412",
          description: "Peter McCormack interviews a Lightning developer about Bitcoin scaling, Layer 2 solutions, and the future of payments over the Lightning Network.",
          source_link: "https://www.whatbitcoindid.com/podcast/lightning-network-412",
          media_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
          duration: 3840,
          episode_number: 412,
          show_title: "What Bitcoin Did",
          date: "2024-08-12",
          image_url: "https://picsum.photos/seed/wbd412/120",
          transcript: "Peter: Welcome to What Bitcoin Did. Today we\u2019re talking about Lightning, the Layer 2 scaling solution that\u2019s changing how we think about Bitcoin payments.\n\nGuest: Thanks for having me, Peter. Lightning is really about making Bitcoin usable for everyday transactions. The base layer gives us security and settlement, but Lightning gives us speed and low fees.\n\nPeter: Can you explain how it works for someone who\u2019s new to this?\n\nGuest: Sure. Imagine you and I open a payment channel. We lock some Bitcoin on-chain, and then we can send payments back and forth instantly, off-chain. When we\u2019re done, we settle back on the main chain. The magic is that these channels connect into a network, so I can pay anyone, not just you.",
        },
      },
      {
        ref_id: "n3",
        node_type: "Person",
        properties: {
          name: "Satoshi Nakamoto",
          description: "Pseudonymous creator of Bitcoin and author of the original whitepaper.",
          twitter_handle: "satoshi",
          bio: "Invented Bitcoin in 2008, mined the genesis block on January 3, 2009.",
        },
      },
    ],
    edges: [
      { source: "n4", target: "n3", edge_type: "FEATURES" },
    ],
  },
  n5: {
    nodes: [
      {
        ref_id: "n5",
        node_type: "Video",
        properties: {
          name: "Bitcoin for Beginners",
          description: "An introductory video explaining how Bitcoin works, covering mining, wallets, and the Lightning Network.",
          media_url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
          duration: 596,
          channel: "Bitcoin Magazine",
          thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Bitcoin.svg/320px-Bitcoin.svg.png",
        },
      },
    ],
    edges: [],
  },
  n6: {
    nodes: [
      {
        ref_id: "n6",
        node_type: "Document",
        properties: {
          title: "Bitcoin Whitepaper",
          source_link: "https://bitcoin.org/bitcoin.pdf",
          author: "Satoshi Nakamoto",
          content_type: "paper",
          summary: "A purely peer-to-peer version of electronic cash would allow online payments to be sent directly from one party to another without going through a financial institution. Digital signatures provide part of the solution, but the main benefits are lost if a trusted third party is still required to prevent double-spending. We propose a solution to the double-spending problem using a peer-to-peer network.",
        },
      },
    ],
    edges: [],
  },
  n9: {
    nodes: [
      {
        ref_id: "n9",
        node_type: "TwitterAccount",
        properties: {
          twitter_handle: "AnthropicAI",
          name: "Anthropic",
          author_id: "1641421906432466944",
          image_url: "https://picsum.photos/seed/anthropic-ai/96",
          verified: true,
          verified_type: "business",
          is_identity_verified: true,
          followers: 412_000,
        },
      },
    ],
    edges: [],
  },
  n7: {
    nodes: [
      {
        ref_id: "n7",
        node_type: "Topic",
        properties: {
          name: "Sphinx Chat",
          description: "Decentralized messaging application built on the Lightning Network. Messages are transmitted as Lightning payments, ensuring censorship resistance and privacy.",
          source_link: "https://sphinx.chat",
        },
      },
    ],
    edges: [],
  },
  n8: {
    nodes: [
      {
        ref_id: "n8",
        node_type: "Clip",
        properties: {
          name: "Bitcoin Mining Explained",
          description: "A 3-minute clip explaining proof-of-work mining, hash rates, and difficulty adjustments.",
          media_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
          duration: 185,
          timestamp: 1240,
          show: "What Bitcoin Did",
          episode_number: 412,
          transcript: "So mining is essentially a competition. Miners around the world are racing to solve a mathematical puzzle. The first one to find the answer gets to add the next block of transactions to the blockchain and earns a reward \u2014 currently 3.125 Bitcoin. The puzzle is designed so that it takes about 10 minutes on average for the entire network to find a solution.",
        },
      },
    ],
    edges: [],
  },
  n12: {
    nodes: [
      {
        ref_id: "n12",
        node_type: "WebPage",
        properties: {
          name: "Sphinx Chat Website",
          description: "Decentralised messaging on Lightning.",
          link: "https://sphinx.chat",
        },
      },
    ],
    edges: [],
  },
}

export const MOCK_EDGES: GraphEdge[] = [
  { source: "n1", target: "n4", edge_type: "MENTIONED_IN" },
  { source: "n3", target: "n1", edge_type: "CREATED" },
  { source: "n3", target: "n6", edge_type: "AUTHORED" },
  { source: "n2", target: "n1", edge_type: "ABOUT" },
  { source: "n5", target: "n1", edge_type: "ABOUT" },
  { source: "n7", target: "n1", edge_type: "RELATED_TO" },
  { source: "n8", target: "n4", edge_type: "CLIP_OF" },
]

export const MOCK_SOURCES = [
  { ref_id: "s1", source: "jack", source_type: "twitter_handle" },
  { ref_id: "s2", source: "staborobot", source_type: "twitter_handle" },
  { ref_id: "s3", source: "https://www.youtube.com/@bitcoinmagazine", source_type: "youtube_channel" },
  { ref_id: "s4", source: "https://bitcoinist.com/feed/", source_type: "rss" },
  { ref_id: "s5", source: "https://github.com/nicksparks/sphinx-nav-fiber", source_type: "github_repository" },
]

export const MOCK_CONTENT = {
  nodes: [
    {
      node_type: "Tweet",
      ref_id: "c1",
      properties: { name: "Bitcoin is freedom tech", text: "Bitcoin is freedom tech. The separation of money and state.", status: "complete", date_added_to_graph: 1713100000, boost: 150, image_url: "https://picsum.photos/seed/content-c1/120" },
    },
    {
      node_type: "Video",
      ref_id: "c2",
      properties: { name: "Bitcoin for Beginners", description: "An introductory video explaining how Bitcoin works", status: "complete", date_added_to_graph: 1713000000, boost: 40, thumbnail: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Bitcoin.svg/320px-Bitcoin.svg.png" },
    },
    {
      node_type: "Podcast",
      ref_id: "c3",
      properties: { name: "What Bitcoin Did #412", description: "Peter McCormack interviews a Lightning developer", status: "error", project_id: "123456", date_added_to_graph: 1712900000, thumbnail: "https://picsum.photos/seed/content-c3/120" },
    },
    {
      node_type: "Document",
      ref_id: "c4",
      properties: { name: "Bitcoin Whitepaper", description: "A peer-to-peer electronic cash system", status: "complete", date_added_to_graph: 1712800000 },
    },
    {
      node_type: "Tweet",
      ref_id: "c5",
      properties: { name: "Lightning Network scaling", text: "Lightning is making micropayments a reality", status: "processing", project_id: "789012", date_added_to_graph: 1712700000, image_url: "https://example.invalid/content-c5-broken.jpg" },
    },
  ],
  totalCount: 5,
  totalProcessing: 2,
}

export const MOCK_TRANSACTIONS = {
  transactions: [
    { action: "top_up", type: "credit" as const, amount: 500, created_at: "2026-04-15T10:00:00Z" },
    { action: "search", type: "debit" as const, amount: 10, created_at: "2026-04-15T10:05:00Z" },
    { action: "search", type: "debit" as const, amount: 10, created_at: "2026-04-15T10:06:30Z" },
    { action: "purchase", type: "debit" as const, amount: 10, created_at: "2026-04-15T10:08:00Z" },
    { action: "boost", type: "debit" as const, amount: 10, created_at: "2026-04-15T10:10:00Z", refunded: true },
    { action: "add_content", type: "debit" as const, amount: 10, created_at: "2026-04-15T10:15:00Z" },
    { action: "add_source", type: "debit" as const, amount: 10, created_at: "2026-04-15T10:20:00Z" },
    { action: "purchase", type: "debit" as const, amount: 10, created_at: "2026-04-15T10:25:00Z" },
    { action: "top_up", type: "credit" as const, amount: 100, created_at: "2026-04-15T11:00:00Z" },
  ],
  scope: "pubkey" as const,
}

const MOCK_CRON_TS = Math.floor(Date.now() / 1000) - 3600
const baseCronConfig = {
  namespace: "default",
  workflow_id: "12345",
  created_at: MOCK_CRON_TS,
  updated_at: MOCK_CRON_TS,
}
export const MOCK_CRON_CONFIGS = [
  { ...baseCronConfig, ref_id: "rc-twitter", source_type: "twitter_handle" as const, kind: "source" as const, enabled: true, cadence: "0 */6 * * *" },
  { ...baseCronConfig, ref_id: "rc-youtube", source_type: "youtube_channel" as const, kind: "source" as const, enabled: true, cadence: "0 */12 * * *" },
  { ...baseCronConfig, ref_id: "rc-rss", source_type: "rss" as const, kind: "source" as const, enabled: false, cadence: "0 */12 * * *" },
  { ...baseCronConfig, ref_id: "rc-topic", source_type: "topic" as const, kind: "source" as const, enabled: true, cadence: "*/10 * * * *" },
  { ...baseCronConfig, ref_id: "rc-deduplication", source_type: "deduplication" as const, kind: "janitor" as const, enabled: false, cadence: "0 * * * *", workflow_id: "mock-gm-workflow-id" },
]

/** @deprecated Use MOCK_CRON_CONFIGS */
export const MOCK_RADAR_CONFIGS = MOCK_CRON_CONFIGS

const MOCK_RUN_NOW = new Date("2026-05-04T09:00:00Z")
const mockRunTs = (minutesAgo: number): number => {
  return (MOCK_RUN_NOW.getTime() - minutesAgo * 60 * 1000) / 1000
}

export const MOCK_STAKWORK_RUNS: StakworkRun[] = [
  {
    ref_id: "run-001",
    namespace: "default",
    source_type: "deduplication",
    kind: "janitor",
    job_type: "deduplication",
    trigger: "SCHEDULED",
    status: "completed",
    created_at: mockRunTs(120),
    started_at: mockRunTs(119),
    finished_at: mockRunTs(110),
  },
  {
    ref_id: "run-002",
    namespace: "default",
    source_type: "deduplication",
    kind: "janitor",
    job_type: "deduplication",
    trigger: "MANUAL",
    status: "error",
    error: "Stakwork dispatch timeout",
    created_at: mockRunTs(60),
    started_at: mockRunTs(59),
    finished_at: mockRunTs(55),
  },
  {
    ref_id: "run-003",
    namespace: "default",
    source_type: "deduplication",
    kind: "janitor",
    job_type: "deduplication",
    trigger: "SCHEDULED",
    status: "halted",
    error: "Job paused by operator",
    created_at: mockRunTs(30),
    started_at: mockRunTs(29),
    finished_at: mockRunTs(25),
  },
  {
    ref_id: "run-004",
    namespace: "default",
    source_type: "deduplication",
    kind: "janitor",
    job_type: "deduplication",
    trigger: "SCHEDULED",
    status: "in_progress",
    created_at: mockRunTs(5),
    started_at: mockRunTs(4),
  },
  {
    ref_id: "run-005",
    namespace: "default",
    source_type: "deduplication",
    kind: "janitor",
    job_type: "deduplication",
    trigger: "MANUAL",
    status: "pending",
    created_at: mockRunTs(1),
  },
]

export const MOCK_DOMAINS = {
  domains: ["content", "codegraph", "workflow"],
  hidden_types: [] as string[],
  hidden_domains: [] as string[],
}

export function isMocksEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCKS === "true"
}

// Helper to produce ISO strings N days ago
function daysAgo(n: number): string {
  const d = new Date("2026-05-04T09:00:00Z")
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

export const MOCK_REVIEWS: Review[] = [
  {
    ref_id: "rv-001",
    type: "dedup",
    rationale: "Nodes 'Bitcoin Whitepaper' (n6) and 'Satoshi Paper' (n9) share identical abstracts and authorship metadata — likely the same document ingested twice.",
    subject_ids: ["n6", "n9"],
    subject_nodes: [
      { ref_id: "n6", node_type: "Topic", properties: { name: "Bitcoin Whitepaper" } },
      { ref_id: "n9", node_type: "Topic", properties: { name: "Satoshi Paper" } },
    ],
    action_name: "merge_nodes",
    action_payload: { from: ["n9"], to: "n6" },
    status: "pending",
    fingerprint: "fp-abc123",
    priority: 2,
    run_ref_id: "mock-janitor-run-1",
    created_at: daysAgo(1),
  },
  {
    ref_id: "rv-002",
    type: "dedup",
    rationale: "Nodes 'Satoshi Nakamoto' (n3) and 'S. Nakamoto' (n10) refer to the same person; properties overlap by 92%.",
    subject_ids: ["n3", "n10"],
    subject_nodes: [
      { ref_id: "n3", node_type: "Person", properties: { name: "Satoshi Nakamoto" } },
      { ref_id: "n10", node_type: "Person", properties: { name: "S. Nakamoto" } },
    ],
    action_name: "merge_nodes",
    action_payload: { from: ["n10"], to: "n3" },
    status: "pending",
    fingerprint: "fp-def456",
    priority: 3,
    run_ref_id: "mock-janitor-run-1",
    created_at: daysAgo(3),
  },
  {
    ref_id: "rv-003",
    type: "dedup",
    rationale: "Three episode nodes (n4, n11, n12) appear to be the same podcast episode published under slightly different titles across different feed imports.",
    subject_ids: ["n4", "n11", "n12"],
    subject_nodes: [
      { ref_id: "n4", node_type: "Episode", properties: { name: "The Bitcoin Origin Story" } },
      { ref_id: "n11", node_type: "Episode", properties: { name: "Bitcoin Origin Story" } },
      { ref_id: "n-deleted", node_type: null, properties: null },
    ],
    action_name: "merge_nodes",
    action_payload: { from: ["n11", "n12"], to: "n4" },
    status: "pending",
    fingerprint: "fp-ghi789",
    priority: 1,
    created_at: daysAgo(7),
  },
  {
    ref_id: "rv-004",
    type: "supersede",
    rationale: "Article n6 (v1 whitepaper) should be superseded by n13 (annotated v2 edition) as the canonical reference.",
    subject_ids: ["n6", "n13"],
    subject_nodes: [
      { ref_id: "n6", node_type: "Topic", properties: { name: "Bitcoin Whitepaper" } },
      { ref_id: "n13", node_type: "Topic", properties: { name: "Bitcoin Whitepaper v2 (Annotated)" } },
    ],
    action_name: "supersede",
    action_payload: { old: "n6", new: "n13" },
    status: "pending",
    fingerprint: "fp-jkl012",
    priority: 0,
    created_at: daysAgo(12),
  },
  {
    ref_id: "rv-005",
    type: "dedup",
    rationale: "Nodes 'Bitcoin (n1)' and 'BTC (n14)' are identical topics; merged into canonical node n1.",
    subject_ids: ["n1", "n14"],
    subject_nodes: [
      { ref_id: "n1", node_type: "Topic", properties: { name: "Bitcoin" } },
      { ref_id: "n14", node_type: "Topic", properties: { name: "BTC" } },
    ],
    action_name: "merge_nodes",
    action_payload: { from: ["n14"], to: "n1" },
    status: "approved",
    fingerprint: "fp-mno345",
    priority: 2,
    created_at: daysAgo(20),
    decided_at: daysAgo(18),
    decided_by: "admin-pubkey-abc",
  },
  {
    ref_id: "rv-006",
    type: "dedup",
    rationale: "Clip n8 and n15 are the same 3-minute excerpt from different upload sources; n15 is lower quality.",
    subject_ids: ["n8", "n15"],
    subject_nodes: [
      { ref_id: "n8", node_type: "Clip", properties: { name: "Bitcoin Explained (Clip)" } },
      { ref_id: "n15", node_type: "Clip", properties: { name: "Bitcoin Explained (Alt Upload)" } },
    ],
    action_name: "merge_nodes",
    action_payload: { from: ["n15"], to: "n8" },
    status: "dismissed",
    fingerprint: "fp-pqr678",
    priority: 0,
    dismissal_reason: "n15 has unique metadata annotations that should be preserved separately.",
    created_at: daysAgo(25),
    decided_at: daysAgo(24),
    decided_by: "admin-pubkey-abc",
  },
  {
    ref_id: "rv-007",
    type: "supersede",
    rationale: "Topic n7 should supersede n16 per content policy; attempted to run 'supersede' action handler.",
    subject_ids: ["n7", "n16"],
    subject_nodes: [
      { ref_id: "n7", node_type: "Topic", properties: { name: "Proof of Work" } },
      { ref_id: "n16", node_type: "Topic", properties: { name: "PoW Consensus" } },
    ],
    action_name: "supersede",
    action_payload: { old: "n16", new: "n7" },
    status: "failed",
    fingerprint: "fp-stu901",
    priority: 1,
    error_message: "no handler registered for action: supersede",
    created_at: daysAgo(10),
    decided_at: daysAgo(9),
    decided_by: "admin-pubkey-abc",
  },
  {
    ref_id: "rv-008",
    type: "dedup",
    rationale: "URGENT: Three high-signal person nodes (n3, n17, n18) flagged by the janitor with 97% property overlap — immediate deduplication recommended before further graph traversal.",
    subject_ids: ["n3", "n17", "n18"],
    subject_nodes: [
      { ref_id: "n3", node_type: "Person", properties: { name: "Satoshi Nakamoto" } },
      { ref_id: "n17", node_type: "Person", properties: { name: "Nakamoto S." } },
      { ref_id: "n18", node_type: "Person", properties: { name: "S Nakamoto" } },
    ],
    action_name: "merge_nodes",
    action_payload: { from: ["n17", "n18"], to: "n3" },
    status: "pending",
    fingerprint: "fp-vwx234",
    priority: 5,
    run_ref_id: "mock-janitor-run-1",
    created_at: daysAgo(0),
  },
]
