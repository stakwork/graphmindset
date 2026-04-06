# GraphMindset

Knowledge graph explorer frontend. Connects to [jarvis-backend](https://github.com/stakwork/jarvis-backend) and [jarvis-boltwall](https://github.com/stakwork/jarvis-boltwall).

## Stack

- Next.js 16 + TypeScript
- Tailwind v4 + shadcn/ui
- Zustand for state management
- sphinx-bridge for Sphinx app integration
- dagre for ontology graph layout

## Setup

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

## Environment Variables

```
NEXT_PUBLIC_API_URL=        # Boltwall API URL (auto-detects on swarm deployments)
NEXT_PUBLIC_USE_MOCKS=true  # Use mock data for local development
```

## Architecture

```
src/
├── app/
│   ├── page.tsx            # Main app (auth guard → sidebar + graph viewport)
│   └── ontology/           # Schema/ontology editor with dagre visualization
├── components/
│   ├── auth/               # Sphinx bridge auth guard
│   ├── layout/             # Sidebar, sources panel, search results panel
│   ├── modals/             # Add content, settings, budget modals
│   ├── search/             # Search bar (wired to v2/nodes)
│   ├── universe/           # Graph viewport placeholder
│   ├── player/             # Media player (audio/video from node media_url)
│   └── boost/              # Lightning boost button (keysend via Sphinx)
├── lib/
│   ├── api.ts              # API client with signed requests + L402 payment retry
│   ├── sphinx/             # Bridge detection, signing, L402, payment utilities
│   ├── graph-api.ts        # v2/nodes, v2/edges CRUD
│   ├── source-detection.ts # URL regex → source type auto-detection
│   └── mock-data.ts        # Mock fixtures for local dev
└── stores/                 # Zustand stores (user, app, graph, schema, player, etc.)
```

## Auth Flow

1. `sphinx-bridge` sends postMessage to Sphinx webview host
2. On success: gets pubkey, sets `isSphinx=true`
3. Calls `GET /isAdmin` on boltwall for admin status + feature flags
4. All API requests append `sig` + `msg` query params (signed message auth)
5. Paid endpoints return 402 → `payL402()` handles invoice + payment + retry

## Key Backend Endpoints

- `GET /isAdmin` — auth + feature flags (boltwall)
- `GET /v2/nodes` — search/list nodes (jarvis-backend)
- `GET /schema/all` — ontology schemas + edges (jarvis-backend)
- `POST /radar` — add content source (boltwall)
- `POST /boost` — boost a node with Lightning (boltwall)
- `GET /about` — graph metadata (jarvis-backend)
