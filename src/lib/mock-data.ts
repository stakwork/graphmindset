import type { GraphNode, GraphEdge, GraphData } from "./graph-api"

export const MOCK_NODES: GraphNode[] = [
  {
    ref_id: "n1",
    node_type: "Topic",
    properties: { name: "Bitcoin", description: "A peer-to-peer electronic cash system" },
  },
  {
    ref_id: "n2",
    node_type: "Tweet",
    properties: { name: "Bitcoin is freedom tech", description: "Tweet by @jack about Bitcoin adoption", image_url: "https://picsum.photos/seed/tweet-jack/120" },
  },
  {
    ref_id: "n3",
    node_type: "Person",
    properties: { name: "Satoshi Nakamoto", description: "Creator of Bitcoin", twitter_handle: "satoshi", image_url: "https://picsum.photos/seed/satoshi/120" },
  },
  {
    ref_id: "n4",
    node_type: "Episode",
    properties: { name: "What Bitcoin Did #412", description: "Peter McCormack interviews a Lightning developer about Bitcoin scaling", thumbnail: "https://picsum.photos/seed/wbd412/120" },
  },
  {
    ref_id: "n5",
    node_type: "Video",
    properties: { name: "Bitcoin for Beginners", description: "An introductory video explaining how Bitcoin works and why it matters", image_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Bitcoin.svg/320px-Bitcoin.svg.png" },
  },
  {
    ref_id: "n6",
    node_type: "Document",
    properties: { name: "Bitcoin Whitepaper", description: "The original paper describing a peer-to-peer electronic cash system", image_url: "https://picsum.photos/seed/whitepaper/120" },
  },
  {
    ref_id: "n7",
    node_type: "Topic",
    properties: { name: "Sphinx Chat", description: "Decentralized messaging on Lightning" },
  },
  {
    ref_id: "n8",
    node_type: "Clip",
    properties: { name: "Bitcoin Mining Explained", description: "A 3-minute clip explaining proof-of-work mining", thumbnail: "https://example.invalid/this-image-404.jpg" },
  },
  {
    ref_id: "n9",
    node_type: "TwitterAccount",
    properties: { twitter_handle: "AnthropicAI", name: "Anthropic", profile_image_url: "https://picsum.photos/seed/anthropic-ai/120", verified: true },
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
          profile_image_url: "https://picsum.photos/seed/anthropic-ai/96",
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

const MOCK_RADAR_TS = Math.floor(Date.now() / 1000) - 3600
const baseRadarConfig = {
  namespace: "default",
  workflow_id: "12345",
  created_at: MOCK_RADAR_TS,
  updated_at: MOCK_RADAR_TS,
}
export const MOCK_RADAR_CONFIGS = [
  { ...baseRadarConfig, ref_id: "rc-twitter", source_type: "twitter_handle" as const, enabled: true, cadence: "0 */6 * * *" },
  { ...baseRadarConfig, ref_id: "rc-youtube", source_type: "youtube_channel" as const, enabled: true, cadence: "0 */12 * * *" },
  { ...baseRadarConfig, ref_id: "rc-rss", source_type: "rss" as const, enabled: false, cadence: "0 */12 * * *" },
  { ...baseRadarConfig, ref_id: "rc-topic", source_type: "topic" as const, enabled: true, cadence: "*/10 * * * *" },
]

export const MOCK_DOMAINS = {
  domains: ["content", "codegraph", "workflow"],
  hidden_types: [] as string[],
  hidden_domains: [] as string[],
}

export function isMocksEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCKS === "true"
}
