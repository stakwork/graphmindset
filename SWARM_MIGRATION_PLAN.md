# Swarm Migration Plan: nav-fiber -> graphmindset

Replace `sphinxlightning/sphinx-nav-fiber` (Nginx, port 80) with `sphinxlightning/graphmindset` (Next.js, port 3000) across sphinx-swarm.

---

## Phase 1: Graphmindset — Docker Setup

The graphmindset repo has no Docker files. Create them so it can be built and pushed as `sphinxlightning/graphmindset`.

### 1.1 Create `Dockerfile`

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

Requires `next.config.ts` to enable standalone output:

```ts
const nextConfig = {
  output: "standalone",
}
```

### 1.2 Create `.dockerignore`

```
node_modules
.next
.git
.env.local
```

### 1.3 Update `next.config.ts`

Add `output: "standalone"` so the Docker build produces a self-contained server.

### 1.4 Environment Variables

Nav-fiber received `BOLTWALL_URL` and `STAKWORK_WEBSOCKET_URL` from swarm. Graphmindset uses `NEXT_PUBLIC_API_URL` instead.

The swarm image config should pass `NEXT_PUBLIC_API_URL` (mapped from whatever the swarm host resolves to, or from the existing `BOLTWALL_URL` env var).

Graphmindset already has auto-detection logic in `src/lib/api.ts` that rewrites `nav.*.swarm.*` -> `boltwall.*.swarm.*`. This continues to work as-is.

### 1.5 Build & Push

```bash
docker build -t sphinxlightning/graphmindset:latest .
docker push sphinxlightning/graphmindset:latest
```

Set up CI (GitHub Actions) to auto-build and push on merge to main.

---

## Phase 2: Swarm — New Image Definition

### 2.1 Create `src/images/graphmindset.rs` (new image module)

Model after `src/images/navfiber.rs` with these changes:

| Field | nav-fiber | graphmindset |
|-------|-----------|--------------|
| Docker image | `sphinxlightning/sphinx-nav-fiber` | `sphinxlightning/graphmindset` |
| Inner port | `80` (nginx) | `3000` (next.js) |
| External port | `8000` | `8000` (keep same for backwards compat) |
| Root volume | `/usr/src/app/` | `/app/` |
| Env vars | `BOLTWALL_URL`, `STAKWORK_WEBSOCKET_URL` | `NEXT_PUBLIC_API_URL` |
| Host prefix | `nav.{host}` | `nav.{host}` (keep same) |

Key differences from `navfiber.rs`:
- No nginx port override hack (remove the `inner_port = "80"` and `single_host_port_from` logic — just bind `8000:3000` directly)
- Repo returns `"graphmindset"` instead of `"sphinx-nav-fiber"`
- Env vars: pass `NEXT_PUBLIC_API_URL` instead of `BOLTWALL_URL`

```rust
// src/images/graphmindset.rs
use super::traefik::traefik_labels;
use super::*;
use crate::config::Node;
use crate::utils::{domain, exposed_ports, getenv, host_config};
use anyhow::Result;
use async_trait::async_trait;
use bollard::container::Config;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, Eq, PartialEq)]
pub struct GraphMindsetImage {
    pub name: String,
    pub version: String,
    pub port: String,
    pub host: Option<String>,
    pub links: Links,
}

impl GraphMindsetImage {
    pub fn new(name: &str, version: &str, port: &str) -> Self {
        Self {
            name: name.to_string(),
            version: version.to_string(),
            port: port.to_string(),
            links: vec![],
            host: None,
        }
    }
    pub fn links(&mut self, links: Vec<&str>) {
        self.links = strarr(links)
    }
    pub fn host(&mut self, eh: Option<String>) {
        if let Some(h) = eh {
            self.host = Some(format!("nav.{}", h));
        }
    }
}

#[async_trait]
impl DockerConfig for GraphMindsetImage {
    async fn make_config(&self, _nodes: &Vec<Node>, _docker: &Docker) -> Result<Config<String>> {
        Ok(graphmindset_config(self))
    }
}

impl DockerHubImage for GraphMindsetImage {
    fn repo(&self) -> Repository {
        Repository {
            registry: Registry::DockerHub,
            org: "sphinxlightning".to_string(),
            repo: "graphmindset".to_string(),
            root_volume: "/app/".to_string(),
        }
    }
}

fn graphmindset_config(node: &GraphMindsetImage) -> Config<String> {
    let name = node.name.clone();
    let repo = node.repo();
    let img = node.image();
    let root_vol = repo.root_volume;
    let ports = vec![node.port.clone()];

    let mut env = vec![];

    if let Ok(api_url) = getenv("NEXT_PUBLIC_API_URL") {
        env.push(format!("NEXT_PUBLIC_API_URL={}", api_url));
    }

    let mut c = Config {
        image: Some(format!("{}:{}", img, node.version)),
        hostname: Some(domain(&name)),
        exposed_ports: exposed_ports(ports.clone()),
        host_config: host_config(&name, ports, &root_vol, None, None),
        env: Some(env),
        ..Default::default()
    };

    if let Some(host) = node.host.clone() {
        c.labels = Some(traefik_labels(&node.name, &host, "3000", false));
    }

    c
}
```

### 2.2 Update `src/images/mod.rs`

Replace the `NavFiber` variant with `GraphMindset`:

```rust
// Remove:
pub mod navfiber;
// Add:
pub mod graphmindset;

// In the Image enum, replace:
//   NavFiber(navfiber::NavFiberImage),
// With:
GraphMindset(graphmindset::GraphMindsetImage),
```

Update all match arms (`name()`, `host()`, `typ()`, `set_version()`, `set_host()`, `make_config()`, `repo()`) — replace `Image::NavFiber(n)` with `Image::GraphMindset(n)`.

---

## Phase 3: Swarm — Stack Definitions

### 3.1 Update `src/graphmindset.rs` (stack)

```rust
// Replace import:
//   use crate::images::navfiber::NavFiberImage;
// With:
use crate::images::graphmindset::GraphMindsetImage;

// In auto_update list, replace "navfiber" with "graphmindset"

// In graph_mindset_imgs(), replace:
//   let mut nav = NavFiberImage::new("navfiber", v, "8000");
// With:
let mut nav = GraphMindsetImage::new("graphmindset", v, "8000");

// In the return vec, replace:
//   Image::NavFiber(nav),
// With:
//   Image::GraphMindset(nav),
```

### 3.2 Update `src/secondbrain.rs` (stack)

Same changes as 3.1 — swap `NavFiberImage` import and usage to `GraphMindsetImage`.

---

## Phase 4: Swarm — Traefik Routing

### 4.1 Update `src/images/traefik.rs`

Replace all references to `"navfiber"` with `"graphmindset"`:

- `is_navfiber_or_boltwall()` -> rename to `is_graphmindset_or_boltwall()`
- Update the shared host check: `name == "navfiber"` -> `name == "graphmindset"`
- Port-based SSL: the special case `if port == "80" { "8000" }` can be removed — graphmindset uses port `3000`, so the entrypoint becomes `port8000` via normal config (or update the special case to handle `"3000"` -> `"8000"`)

### 4.2 Keep `NAV_BOLTWALL_SHARED_HOST` Working

The shared host pattern (graphmindset catches all routes, boltwall catches `/api` and `/socket.io`) still applies. Just update the name checks.

---

## Phase 5: Swarm — Peripheral Files

### 5.1 `src/dock.rs`

Remove `"sphinx-nav-fiber"` from the `m1_not_supported` list (or replace with `"graphmindset"` if needed).

### 5.2 `src/bin/super/checker.rs`

Update `get_boltwall_and_navfiber_url()`:
- Rename to `get_boltwall_and_graphmindset_url()` (or keep generic)
- `get_navfiber_status()` -> `get_graphmindset_status()`
- Update error messages from "Navfiber" to "Graphmindset"

### 5.3 `stop.sh`

Replace `navfiber` in the valid services list with `graphmindset`.

### 5.4 `scripts/delete_all_danger.sh`

Replace:
```bash
docker stop navfiber.sphinx
docker rm navfiber.sphinx
docker volume rm navfiber.sphinx
```
With:
```bash
docker stop graphmindset.sphinx
docker rm graphmindset.sphinx
docker volume rm graphmindset.sphinx
```

### 5.5 `second-brain-2.yml`

If navfiber is referenced here, update to graphmindset. Port 8000 on traefik entrypoint stays the same.

---

## Phase 6: Swarm — Frontend (Svelte Admin UI)

### 6.1 `app/src/helpers/swarm.ts`

Replace the image name mapping:
```ts
// From:
if (node_name === "navfiber") name = "sphinx-nav-fiber"
// To:
if (node_name === "graphmindset") name = "graphmindset"
```

### 6.2 `app/src/nodes.ts`

- Replace `NodeType` value `"NavFiber"` with `"GraphMindset"`
- Update default position: `graphmindset: [1150, 475]`

### 6.3 `app/src/NavFiber.svelte` -> `app/src/GraphMindset.svelte`

Rename the component. Update internal references (title can stay "Second Brain" or change to "Graph Mindset").

### 6.4 `app/src/controls/controls.ts`

Replace `navfiberControls` with `graphmindsetControls`.

### 6.5 `app/src/controls/Controller.svelte`

- Update import: `NavFiber` -> `GraphMindset`
- Update condition: `$selectedNode.name !== "navfiber"` -> `$selectedNode.name !== "graphmindset"`
- Update route: `type === "NavFiber"` -> `type === "GraphMindset"`

---

## Summary: All Files Changed

### Graphmindset Repo (this repo)

| File | Action |
|------|--------|
| `Dockerfile` | **Create** — multi-stage Next.js build |
| `.dockerignore` | **Create** |
| `next.config.ts` | **Edit** — add `output: "standalone"` |

### Sphinx-Swarm Repo

| File | Action |
|------|--------|
| `src/images/graphmindset.rs` | **Create** — new image definition |
| `src/images/navfiber.rs` | **Delete** |
| `src/images/mod.rs` | **Edit** — swap NavFiber -> GraphMindset enum variant |
| `src/images/traefik.rs` | **Edit** — rename navfiber checks |
| `src/graphmindset.rs` | **Edit** — use GraphMindsetImage |
| `src/secondbrain.rs` | **Edit** — use GraphMindsetImage |
| `src/dock.rs` | **Edit** — remove from m1_not_supported |
| `src/bin/super/checker.rs` | **Edit** — rename functions/messages |
| `app/src/helpers/swarm.ts` | **Edit** — update image name mapping |
| `app/src/nodes.ts` | **Edit** — swap node type |
| `app/src/NavFiber.svelte` | **Rename** -> `GraphMindset.svelte` |
| `app/src/controls/controls.ts` | **Edit** — rename controls |
| `app/src/controls/Controller.svelte` | **Edit** — update imports/conditions |
| `stop.sh` | **Edit** — rename service |
| `scripts/delete_all_danger.sh` | **Edit** — rename container/volume |

---

## Deployment Order

1. Merge graphmindset Docker changes (this repo) and push image to DockerHub
2. Merge swarm changes (sphinx-swarm repo)
3. On existing deployments: stop old `navfiber.sphinx` container, redeploy stack — swarm will create `graphmindset.sphinx` automatically
4. Clean up old `navfiber.sphinx` volumes if no longer needed
