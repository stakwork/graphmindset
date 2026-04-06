# GraphMindset

## Project Overview
Knowledge graph explorer frontend. Rebuilds the core of sphinx-nav-fiber with Next.js + shadcn/ui.

## Key Architecture Decisions
- Uses `sphinx-bridge` npm package (postMessage-based, not window.sphinx) for Sphinx app auth
- Custom Dialog component using React createPortal (base-ui Dialog had portal issues with Next.js)
- `.noise-bg` class uses `isolation: isolate` not `position: relative` (breaks fixed positioning on modals)
- Schema/ontology visualization uses dagre for layout, rendered as SVG
- All API requests go through `src/lib/api.ts` which appends signed message params and handles L402 402 retries
- `NEXT_PUBLIC_USE_MOCKS=true` enables mock mode — skips all API calls, uses local fixtures

## Backend Services
- **jarvis-boltwall**: Auth gateway (isAdmin, feature flags, L402 payments, radar/sources)
- **jarvis-backend**: Graph data (v2/nodes, v2/edges, schema/all, stats, about)
- Boltwall proxies most requests to jarvis-backend; schema endpoints go direct

## Code Conventions
- No hardcoded secrets or keys — use NEXT_PUBLIC_ env vars
- Stores in `src/stores/` use Zustand
- All components that use browser APIs need `"use client"` directive
- Native `<select>` elements must not be used — use `SelectCustom` component instead
- Keep imports at top of files, no dynamic imports mid-function
