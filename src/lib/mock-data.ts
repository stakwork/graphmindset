import type { GraphNode, GraphEdge, GraphData, Review, StakworkRun } from "./graph-api"
import type { CreatorInsightsResponse } from "./creator-insights"

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
    ref_id: "n10a",
    node_type: "Section",
    properties: {
      text: "Section 1 — Introduction",
      summary: "Commerce on the Internet has come to rely almost exclusively on financial institutions serving as trusted third parties to process electronic payments. While the system works well enough for most transactions, it still suffers from the inherent weaknesses of the trust based model.",
    },
  },
  {
    ref_id: "n10b",
    node_type: "Section",
    properties: {
      text: "Section 2 — Transactions",
      summary: "We define an electronic coin as a chain of digital signatures. Each owner transfers the coin to the next by digitally signing a hash of the previous transaction and the public key of the next owner and adding these to the end of the coin.",
    },
  },
  {
    ref_id: "n10c",
    node_type: "Section",
    properties: {
      text: "Section 3 — Timestamp Server",
      summary: "The solution we propose begins with a timestamp server. A timestamp server works by taking a hash of a block of items to be timestamped and widely publishing the hash, such as in a newspaper or Usenet post.",
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
  // Hot Takes seed — recent Clip nodes so the landing-page section renders in mocks mode.
  {
    ref_id: "n12",
    node_type: "Clip",
    date_added_to_graph: Math.floor(Date.now() / 1000) - 60 * 60 * 2,
    properties: {
      name: "Proof-of-work is a clock",
      description: "Proof-of-work is a clock. That's the whole thing.",
      show: "What Bitcoin Did",
      episode_number: 412,
      duration: 47,
      timestamp: 1240,
      speaker_name: "Adam Back",
      thumbnail: "https://picsum.photos/seed/clip-pow-clock/600/400",
      boost: 412,
    },
  },
  {
    ref_id: "n13",
    node_type: "Clip",
    date_added_to_graph: Math.floor(Date.now() / 1000) - 60 * 60 * 5,
    properties: {
      name: "Separation of money and state",
      description: "The separation of money and state is happening whether governments like it or not.",
      show: "Citation Needed",
      episode_number: 87,
      duration: 62,
      timestamp: 1840,
      speaker_name: "Lyn Alden",
      thumbnail: "https://picsum.photos/seed/clip-money-state/600/400",
      boost: 380,
    },
  },
  {
    ref_id: "n14",
    node_type: "Clip",
    date_added_to_graph: Math.floor(Date.now() / 1000) - 60 * 60 * 8,
    properties: {
      name: "Possession vs ownership",
      description: "Custody is the line between possession and ownership. Everything else is detail.",
      show: "Coin Stories",
      episode_number: 142,
      duration: 38,
      timestamp: 420,
      speaker_name: "Jameson Lopp",
      thumbnail: "https://picsum.photos/seed/clip-custody/600/400",
      boost: 290,
    },
  },
  {
    ref_id: "n15",
    node_type: "Clip",
    date_added_to_graph: Math.floor(Date.now() / 1000) - 60 * 60 * 11,
    properties: {
      name: "Lightning as settlement",
      description: "Lightning isn't a scaling solution, it's a settlement layer for the global economy.",
      show: "What Bitcoin Did",
      episode_number: 408,
      duration: 54,
      timestamp: 2100,
      speaker_name: "Roy Sheinfeld",
      thumbnail: "https://picsum.photos/seed/clip-lightning/600/400",
      boost: 245,
    },
  },
  {
    ref_id: "n20",
    node_type: "WebPage",
    properties: { name: "Sphinx Chat Website", description: "Decentralised messaging on Lightning." },
  },
  // Cluster 1: additional clips from same episode as n12 (What Bitcoin Did #412)
  {
    ref_id: "n22",
    node_type: "Clip",
    date_added_to_graph: Math.floor(Date.now() / 1000) - 60 * 60 * 2 - 30,
    properties: {
      name: "Hash rate follows price",
      description: "Hash rate is a lagging indicator. It always follows price, not the other way around.",
      show: "What Bitcoin Did",
      episode_number: 412,
      duration: 41,
      timestamp: 1400,
      speaker_name: "Adam Back",
      thumbnail: "https://picsum.photos/seed/clip-hashrate/600/400",
      boost: 310,
    },
  },
  {
    ref_id: "n23",
    node_type: "Clip",
    date_added_to_graph: Math.floor(Date.now() / 1000) - 60 * 60 * 2 - 60,
    properties: {
      name: "Miners are the backbone",
      description: "Miners don't control Bitcoin. They secure it. There's a difference.",
      show: "What Bitcoin Did",
      episode_number: 412,
      duration: 35,
      timestamp: 1560,
      speaker_name: "Adam Back",
      thumbnail: "https://picsum.photos/seed/clip-miners/600/400",
      boost: 275,
    },
  },
  {
    ref_id: "n24",
    node_type: "Clip",
    date_added_to_graph: Math.floor(Date.now() / 1000) - 60 * 60 * 2 - 90,
    properties: {
      name: "Difficulty adjustment is genius",
      description: "The difficulty adjustment is Satoshi's most underrated innovation. Pure elegance.",
      show: "What Bitcoin Did",
      episode_number: 412,
      duration: 29,
      timestamp: 1700,
      speaker_name: "Adam Back",
      thumbnail: "https://picsum.photos/seed/clip-difficulty/600/400",
      boost: 198,
    },
  },
  // Cluster 2: additional clips from same episode as n13 (Citation Needed #87)
  {
    ref_id: "n25",
    node_type: "Clip",
    date_added_to_graph: Math.floor(Date.now() / 1000) - 60 * 60 * 5 - 30,
    properties: {
      name: "Dollar debasement is policy",
      description: "Inflation isn't an accident or a mistake. It is the policy. It always has been.",
      show: "Citation Needed",
      episode_number: 87,
      duration: 55,
      timestamp: 2050,
      speaker_name: "Lyn Alden",
      thumbnail: "https://picsum.photos/seed/clip-debasement/600/400",
      boost: 322,
    },
  },
  {
    ref_id: "n26",
    node_type: "Clip",
    date_added_to_graph: Math.floor(Date.now() / 1000) - 60 * 60 * 5 - 60,
    properties: {
      name: "Energy is the unit of account",
      description: "If you want a truly neutral reserve asset, it has to be backed by something scarce — like energy.",
      show: "Citation Needed",
      episode_number: 87,
      duration: 48,
      timestamp: 2200,
      speaker_name: "Lyn Alden",
      thumbnail: "https://picsum.photos/seed/clip-energy/600/400",
      boost: 287,
    },
  },
  {
    ref_id: "n27",
    node_type: "Clip",
    date_added_to_graph: Math.floor(Date.now() / 1000) - 60 * 60 * 5 - 90,
    properties: {
      name: "Network effects compound",
      description: "Bitcoin's network effect is not linear. It's exponential. Every new user makes it stronger.",
      show: "Citation Needed",
      episode_number: 87,
      duration: 43,
      timestamp: 2350,
      speaker_name: "Lyn Alden",
      thumbnail: "https://picsum.photos/seed/clip-network/600/400",
      boost: 241,
    },
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
      {
        ref_id: "n10a",
        node_type: "Section",
        properties: {
          text: "Section 1 — Introduction",
          summary: "Commerce on the Internet has come to rely almost exclusively on financial institutions serving as trusted third parties to process electronic payments. While the system works well enough for most transactions, it still suffers from the inherent weaknesses of the trust based model.",
        },
      },
      {
        ref_id: "n10b",
        node_type: "Section",
        properties: {
          text: "Section 2 — Transactions",
          summary: "We define an electronic coin as a chain of digital signatures. Each owner transfers the coin to the next by digitally signing a hash of the previous transaction and the public key of the next owner and adding these to the end of the coin.",
        },
      },
      {
        ref_id: "n10c",
        node_type: "Section",
        properties: {
          text: "Section 3 — Timestamp Server",
          summary: "The solution we propose begins with a timestamp server. A timestamp server works by taking a hash of a block of items to be timestamped and widely publishing the hash, such as in a newspaper or Usenet post.",
        },
      },
    ],
    edges: [
      { source: "n6", target: "n10a", edge_type: "HAS", properties: { index: 0 } },
      { source: "n6", target: "n10b", edge_type: "HAS", properties: { index: 1 } },
      { source: "n6", target: "n10c", edge_type: "HAS", properties: { index: 2 } },
    ],
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
  n20: {
    nodes: [
      {
        ref_id: "n20",
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
  n10a: {
    nodes: [
      {
        ref_id: "n10a",
        node_type: "Section",
        properties: {
          text: "Section 1 — Introduction",
          summary: "Commerce on the Internet has come to rely almost exclusively on financial institutions serving as trusted third parties to process electronic payments. While the system works well enough for most transactions, it still suffers from the inherent weaknesses of the trust based model.",
        },
      },
      {
        ref_id: "n6",
        node_type: "Document",
        properties: {
          title: "Bitcoin Whitepaper",
          source_link: "https://bitcoin.org/bitcoin.pdf",
          author: "Satoshi Nakamoto",
          content_type: "paper",
          summary: "A purely peer-to-peer version of electronic cash would allow online payments to be sent directly from one party to another without going through a financial institution.",
        },
      },
    ],
    edges: [
      { source: "n6", target: "n10a", edge_type: "HAS", properties: { index: 0 } },
    ],
  },
  n10b: {
    nodes: [
      {
        ref_id: "n10b",
        node_type: "Section",
        properties: {
          text: "Section 2 — Transactions",
          summary: "We define an electronic coin as a chain of digital signatures. Each owner transfers the coin to the next by digitally signing a hash of the previous transaction and the public key of the next owner and adding these to the end of the coin.",
        },
      },
      {
        ref_id: "n6",
        node_type: "Document",
        properties: {
          title: "Bitcoin Whitepaper",
          source_link: "https://bitcoin.org/bitcoin.pdf",
          author: "Satoshi Nakamoto",
          content_type: "paper",
          summary: "A purely peer-to-peer version of electronic cash would allow online payments to be sent directly from one party to another without going through a financial institution.",
        },
      },
    ],
    edges: [
      { source: "n6", target: "n10b", edge_type: "HAS", properties: { index: 1 } },
    ],
  },
  n10c: {
    nodes: [
      {
        ref_id: "n10c",
        node_type: "Section",
        properties: {
          text: "Section 3 — Timestamp Server",
          summary: "The solution we propose begins with a timestamp server. A timestamp server works by taking a hash of a block of items to be timestamped and widely publishing the hash, such as in a newspaper or Usenet post.",
        },
      },
      {
        ref_id: "n6",
        node_type: "Document",
        properties: {
          title: "Bitcoin Whitepaper",
          source_link: "https://bitcoin.org/bitcoin.pdf",
          author: "Satoshi Nakamoto",
          content_type: "paper",
          summary: "A purely peer-to-peer version of electronic cash would allow online payments to be sent directly from one party to another without going through a financial institution.",
        },
      },
    ],
    edges: [
      { source: "n6", target: "n10c", edge_type: "HAS", properties: { index: 2 } },
    ],
  },
  n11: {
    nodes: [
      {
        ref_id: "n11",
        node_type: "Claim",
        properties: {
          name: "Lightning enables instant Bitcoin payments",
          claim_text: "The Lightning Network allows Bitcoin transactions to settle instantly off-chain by routing payments through a network of bidirectional payment channels. This is achieved by locking funds into a 2-of-2 multisig address on-chain and exchanging signed commitment transactions off-chain, only broadcasting to the blockchain when the channel is closed.",
          speaker_name: "Lightning developer",
          source_role: "guest",
        },
      },
    ],
    edges: [],
  },
  "n-graphrag-deep": {
    nodes: [
      {
        ref_id: "n-graphrag-deep",
        node_type: "Topic",
        properties: {
          name: "GraphRAG",
          description:
            "GraphRAG is a technique that combines knowledge graphs with retrieval-augmented generation (RAG) to improve LLM reasoning over large corpora. Rather than embedding flat text chunks, GraphRAG first extracts a structured entity-relationship graph from documents and then uses that graph topology to retrieve richer, more contextually grounded evidence at query time.",
          summary:
            "Originated in a 2024 Microsoft Research paper by Edge et al. Key contributors include Darren Edge, Ha Trinh, and Jonathan Larson. Closely related to MSFT's Project Graphiti and academic work on graph-based RAG from Stanford and CMU.",
          image_url: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&q=80",
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
  // Episode → Clip HAS edges for Hot Takes diversification
  { source: "ep-wbd-412", target: "n12", edge_type: "HAS" },
  { source: "ep-wbd-412", target: "n22", edge_type: "HAS" },
  { source: "ep-wbd-412", target: "n23", edge_type: "HAS" },
  { source: "ep-wbd-412", target: "n24", edge_type: "HAS" },
  { source: "ep-cn-87", target: "n13", edge_type: "HAS" },
  { source: "ep-cn-87", target: "n25", edge_type: "HAS" },
  { source: "ep-cn-87", target: "n26", edge_type: "HAS" },
  { source: "ep-cn-87", target: "n27", edge_type: "HAS" },
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
      properties: { name: "What Bitcoin Did #412", description: "Peter McCormack interviews a Lightning developer", status: "error", project_id: 123456, date_added_to_graph: 1712900000, thumbnail: "https://picsum.photos/seed/content-c3/120" },
    },
    {
      node_type: "Document",
      ref_id: "c4",
      properties: { name: "Bitcoin Whitepaper", description: "A peer-to-peer electronic cash system", status: "complete", date_added_to_graph: 1712800000 },
    },
    {
      node_type: "Tweet",
      ref_id: "c5",
      properties: { name: "Lightning Network scaling", text: "Lightning is making micropayments a reality", status: "processing", project_id: 789012, date_added_to_graph: 1712700000, image_url: "https://example.invalid/content-c5-broken.jpg" },
    },
  ],
  totalCount: 5,
  totalProcessing: 2,
}

export const MOCK_PURCHASED_NODES: { nodes: GraphNode[] } = {
  nodes: [
    {
      ref_id: 'mock-purchased-1',
      node_type: 'Episode',
      properties: {
        name: 'The Future of Bitcoin Layer 2',
        status: 'completed',
        thumbnail: null,
      },
    },
    {
      ref_id: 'mock-purchased-2',
      node_type: 'Topic',
      properties: {
        name: 'Zero Knowledge Proofs',
        status: 'completed',
        thumbnail: null,
      },
    },
    {
      ref_id: 'mock-purchased-3',
      node_type: 'Video',
      properties: {
        name: 'Lightning Network Deep Dive',
        status: 'completed',
        thumbnail: null,
      },
    },
  ],
}

export const MOCK_TRANSACTIONS = {
  transactions: [
    { action: "top_up", type: "credit" as const, amount: 500, created_at: "2026-04-15T10:00:00Z" },
    { action: "search", type: "debit" as const, amount: 10, created_at: "2026-04-15T10:05:00Z" },
    { action: "search", type: "debit" as const, amount: 10, created_at: "2026-04-15T10:06:30Z" },
    { action: "purchase", type: "debit" as const, amount: 0, created_at: "2026-04-15T10:07:00Z" },
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
  last_run_at: MOCK_CRON_TS,
}
export const MOCK_CRON_CONFIGS = [
  { ...baseCronConfig, ref_id: "rc-twitter", source_type: "twitter_handle" as const, kind: "source" as const, enabled: true, cadence: "0 */6 * * *" },
  { ...baseCronConfig, ref_id: "rc-youtube", source_type: "youtube_channel" as const, kind: "source" as const, enabled: true, cadence: "0 */12 * * *" },
  { ...baseCronConfig, ref_id: "rc-rss", source_type: "rss" as const, kind: "source" as const, enabled: false, cadence: "0 */12 * * *" },
  { ...baseCronConfig, ref_id: "rc-topic", source_type: "topic" as const, kind: "source" as const, enabled: true, cadence: "*/10 * * * *" },
  { ...baseCronConfig, ref_id: "rc-deduplication", source_type: "deduplication" as const, kind: "janitor" as const, enabled: false, cadence: "0 * * * *", workflow_id: "mock-gm-workflow-id", label: "Deduplication" },
  { ...baseCronConfig, ref_id: "rc-content-review", source_type: "content_review" as const, kind: "janitor" as const, enabled: false, cadence: "0 * * * *", label: "Content review" },
  { ...baseCronConfig, ref_id: "rc-topic-review", source_type: "topic_review" as const, kind: "janitor" as const, enabled: false, cadence: "0 * * * *", label: "Topic review" },
]

/** @deprecated Use MOCK_CRON_CONFIGS */
export const MOCK_RADAR_CONFIGS = MOCK_CRON_CONFIGS

import type { CronConfig, WorkflowMarketplaceItem } from "./graph-api"
const MOCK_CRON_CONFIGS_TYPED: CronConfig[] = MOCK_CRON_CONFIGS
export const MOCK_WORKFLOW_MARKETPLACE: WorkflowMarketplaceItem[] =
  MOCK_CRON_CONFIGS_TYPED.map(({ ref_id, label, source_type, kind, enabled }) => ({
    ref_id,
    label,
    source_type,
    kind,
    enabled,
  }))

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
  {
    ref_id: "mock-run-cr-1",
    source_type: "content_review",
    kind: "janitor",
    status: "completed",
    trigger: "MANUAL",
    created_at: Date.now() / 1000 - 3600,
  },
  {
    ref_id: "mock-run-cr-2",
    source_type: "content_review",
    kind: "janitor",
    status: "error",
    trigger: "SCHEDULED",
    created_at: Date.now() / 1000 - 7200,
  },
  {
    ref_id: "mock-run-tr-1",
    source_type: "topic_review",
    kind: "janitor",
    status: "completed",
    trigger: "MANUAL",
    created_at: Date.now() / 1000 - 1800,
  },
  {
    ref_id: "mock-run-tr-2",
    source_type: "topic_review",
    kind: "janitor",
    status: "error",
    trigger: "SCHEDULED",
    created_at: Date.now() / 1000 - 5400,
  },
]

export const MOCK_DOMAINS = {
  domains: ["content", "codegraph", "workflow"],
  hidden_types: [] as string[],
  hidden_domains: [] as string[],
}

// Enriched Topic node for Deep Research mock UI (graphRAG-style)
export const MOCK_DEEP_RESEARCH_TOPIC: GraphNode = {
  ref_id: "n-graphrag-deep",
  node_type: "Topic",
  properties: {
    name: "GraphRAG",
    description:
      "GraphRAG is a technique that combines knowledge graphs with retrieval-augmented generation (RAG) to improve LLM reasoning over large corpora. Rather than embedding flat text chunks, GraphRAG first extracts a structured entity-relationship graph from documents and then uses that graph topology to retrieve richer, more contextually grounded evidence at query time.",
    summary:
      "Originated in a 2024 Microsoft Research paper by Edge et al. The core insight is that community detection on the extracted knowledge graph enables hierarchical summarisation, dramatically improving global reasoning tasks over long documents. Key contributors include Darren Edge, Ha Trinh, and Jonathan Larson. Closely related to MSFT's Project Graphiti and academic work on graph-based RAG from Stanford and CMU. Feeds to watch: Microsoft Research Blog, Arxiv cs.IR/cs.CL, Darren Edge on GitHub.",
    image_url: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&q=80",
  },
}

// StakworkRun fixtures for Deep Research, one per lifecycle status
export const MOCK_DEEP_RESEARCH_RUNS: StakworkRun[] = [
  {
    ref_id: "dr-run-pending",
    job_type: "deep_research",
    status: "PENDING",
    created_at: Math.floor(Date.now() / 1000) - 10,
  },
  {
    ref_id: "dr-run-running",
    job_type: "deep_research",
    status: "RUNNING",
    created_at: Math.floor(Date.now() / 1000) - 60,
    started_at: Math.floor(Date.now() / 1000) - 55,
  },
  {
    ref_id: "dr-run-completed",
    job_type: "deep_research",
    status: "COMPLETED",
    created_at: Math.floor(Date.now() / 1000) - 300,
    started_at: Math.floor(Date.now() / 1000) - 295,
    finished_at: Math.floor(Date.now() / 1000) - 120,
  },
  {
    ref_id: "dr-run-failed",
    job_type: "deep_research",
    status: "FAILED",
    error_message: "Stakwork workflow timed out",
    created_at: Math.floor(Date.now() / 1000) - 600,
    started_at: Math.floor(Date.now() / 1000) - 595,
    finished_at: Math.floor(Date.now() / 1000) - 500,
  },
]

export function isMocksEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCKS === "true"
}

// Helper to produce ISO strings N days ago
function daysAgo(n: number): string {
  const d = new Date("2026-05-04T09:00:00Z")
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

export const MOCK_CREATOR_INSIGHTS: CreatorInsightsResponse = {
  period: "week",
  total_sats_earned: 130,
  total_unlocks: 13,
  nodes: [
    { ref_id: "c1", unlock_count: 7, sats_earned: 70, previous_unlock_count: 4 }, // ▲ up
    { ref_id: "c2", unlock_count: 3, sats_earned: 30, previous_unlock_count: 3 }, // — flat
    { ref_id: "c3", unlock_count: 2, sats_earned: 20, previous_unlock_count: 5 }, // ▼ down
    { ref_id: "c4", unlock_count: 1, sats_earned: 10, previous_unlock_count: 0 }, // ▲ up
    { ref_id: "c5", unlock_count: 0, sats_earned: 0, previous_unlock_count: 0 }, // no badge
  ],
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
  {
    ref_id: "mock-rev-content-1",
    type: "content_review_candidate",
    status: "pending",
    priority: 1,
    rationale: "This content node has not been accessed or linked for 90 days and may be irrelevant.",
    subject_ids: ["mock-node-content-1"],
    subject_nodes: [{ ref_id: "mock-node-content-1", node_type: "Episode", properties: { name: "Mock Episode" } }],
    action_name: "soft_delete",
    action_payload: { ref_id: "mock-node-content-1" },
    fingerprint: "fp-content-rev-1",
    display_label: "Content review",
    accent: "rose",
    action_verb: "Soft delete",
    icon: "trash-2",
    created_at: new Date(Date.now() - 600_000).toISOString(),
  },
  {
    ref_id: "mock-rev-topic-1",
    type: "topic_review_candidate",
    status: "pending",
    priority: 2,
    rationale: "This topic has no connections to any content or entity nodes and appears orphaned.",
    subject_ids: ["mock-node-topic-1"],
    subject_nodes: [{ ref_id: "mock-node-topic-1", node_type: "Topic", properties: { name: "Orphaned Topic" } }],
    action_name: "soft_delete",
    action_payload: { ref_id: "mock-node-topic-1" },
    fingerprint: "fp-topic-rev-1",
    display_label: "Topic review",
    accent: "violet",
    action_verb: "Soft delete",
    icon: "trash-2",
    created_at: new Date(Date.now() - 300_000).toISOString(),
  },
  {
    ref_id: "mock-new-source-1",
    type: "new_source_candidate",
    rationale: "This YouTube channel is frequently referenced by existing graph nodes and has not yet been added as a source.",
    subject_ids: [],
    subject_nodes: [],
    action_name: "add_source",
    action_payload: { source: "https://www.youtube.com/@lexfridman", source_type: "youtube_channel" },
    status: "pending",
    fingerprint: "mock-fingerprint-new-source-1",
    priority: 1,
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    display_label: "Add Youtube Channel: https://www.youtube.com/@lexfridman",
    accent: "green",
    action_verb: "Add",
    icon: "plus-circle",
  },
  {
    ref_id: "mock-new-source-2",
    type: "new_source_candidate",
    rationale: "Suggested RSS feed already exists in the radar.",
    subject_ids: [],
    subject_nodes: [],
    action_name: "add_source",
    action_payload: { source: "https://feeds.transistor.fm/example", source_type: "rss" },
    status: "failed",
    error_message: "add_source failed: Source already exists",
    fingerprint: "mock-fingerprint-new-source-2",
    priority: 0,
    created_at: new Date(Date.now() - 7_200_000).toISOString(),
    display_label: "Add Rss: https://feeds.transistor.fm/example",
    accent: "green",
    action_verb: "Add",
    icon: "plus-circle",
  },
]
