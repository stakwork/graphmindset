# Node Detail View — Peaky Blinders-style Case Board

## Goal

When the user selects a node in the 3D universe (e.g. Artyom) and zooms in, transition into a 2D editable case-board view inspired by Peaky Blinders / Maltego-style investigation graphs:

- The selected node becomes a rich card with image, structured fields, and connection handles
- Direct 1-hop connections render as cards around it, joined by dashed bezier "linked to" edges
- The user can pan/zoom within the 2D view, drag-bend edges, possibly add/remove links
- Backing out returns to the 3D universe view

**Reference UX:** see the Peaky Blinders screenshot — entity-typed cards (PERSON / PHONE / VEHICLE) with a colored chrome per type, hero image, labeled fields, blue-dot connection handles, dashed bezier edges with mid-edge "linked to" pills.

---

## Current architecture (what's already in place)

Relevant files in graphmindset's existing 3D view:

- `src/components/universe/graph-canvas.tsx` — main R3F `<Canvas>` with `CameraControls`, EffectComposer/Bloom, metro overlay layers
- `src/graph-viz-kit/GraphView.tsx` — 3D node rendering, label sizing, hover/select state
- `src/data/metro.ts` — fixture + `BACKEND_REF_ID_MAP` resolving fixture ref_ids to backend UUIDs
- `src/components/layout/node-preview-panel.tsx` — current sidebar detail (text-only, no graph visualization)
- `src/stores/graph-store.ts` — selection state (selected node, sidebar selected, hovered)

Already wired for this work:
- `CameraControls` from `camera-controls` supports `setLookAt(..., enableTransition: true)` for animated camera moves
- Node positions are available in world coordinates via the existing layout pipeline
- Backend serves full node + edges via `/v2/nodes/<ref_id>?expand=edges`

---

## Two architectural paths

### Path 1 — Continuous semantic zoom (the Pixar feel)

**One scene, three render variants per node, driven by camera distance.** No view switch — fly the camera in and the same node morphs from 3D sphere → label pill → full 2D card.

Primitive: **`<Html />` from `@react-three/drei`** attaches DOM elements to world coordinates. Sized via `distanceFactor` so they scale with camera distance.

```tsx
function NodeWithLOD({ position, node }: Props) {
  const distance = useNodeDistance(position) // useFrame + camera.distanceTo
  const variant =
    distance > 60 ? "dot"      // current 3D sphere
    : distance > 15 ? "pill"   // your current label
    : "card"                   // Peaky Blinders full card

  return (
    <>
      {variant === "dot" && <NodeSphere position={position} />}
      {variant !== "dot" && (
        <Html position={position} center distanceFactor={20}>
          {variant === "pill"
            ? <CompactPill node={node} />
            : <PeakyCard node={node} />}
        </Html>
      )}
    </>
  )
}
```

Camera animation already available via existing `cameraRef`:
```ts
function flyToNode(node: GraphNode) {
  const target = new Vector3(node.x, node.y, node.z)
  cameraRef.current.setLookAt(
    target.x, target.y + 2, target.z + 10, // close-up position
    target.x, target.y, target.z,           // look at
    true                                     // animate
  )
}
```

**Edges during transition** — three options for handling the visual:
- **Fade 3D lines out** as cards fade in. Simplest.
- **Re-draw as 2D SVG** when zoomed-in, using projected node positions. Overlay `<svg>` outside `<Canvas>` reading projected coords each frame. Looks exactly like Peaky Blinders dashed beziers.
- **Hybrid** — 3D LineSegments far out, lerp opacity, swap to 2D-style dashed at close range.

**Pros:**
- Continuous; one camera, one source of truth, no view switching
- Cinematic — feels like flying into the node

**Cons:**
- Card density at close zoom can hammer DOM — mitigate with frustum + distance culling
- Edge rendering during transition is tricky
- Several-day refactor of how nodes render

---

### Path 2 — View handoff with shared anchor (simpler to ship)

**Two views, cross-faded with the node "landing" at the same screen position.** Less ambitious, faster, looks great if the handoff is precise.

Flow:
1. User clicks Artyom in 3D → camera dollies in for ~400 ms
2. At animation midpoint, project Artyom's 3D world position → screen coords
3. Mount a React Flow canvas as a fullscreen overlay, with Artyom's node initialized at the same screen position
4. Fade 3D scene → 0, React Flow → 1 over ~300 ms
5. React Flow's `fitView()` smoothly re-centers the graph after the fade completes

The trick that sells the handoff: **place the target node at the exact same pixel location** before fading, so the user's eye doesn't lose it. Everything else is opacity.

Tech stack additions:
- **React Flow** (`@xyflow/react`) — 2D node/edge canvas, custom node types, pan/zoom, edge bending
- New route: `/case/[refId]` or modal overlay (either works)
- Reuse existing `metroSeries` + backend `/v2/nodes/<refId>?expand=edges` for the 1-hop fetch

**Pros:**
- Clean separation; each view uses the right tool (3D for spatial overview, React Flow for editable case-board)
- No perf concerns from `<Html />` overload
- 1–2 day prototype to validate UX
- React Flow handles all the editing affordances (drag-bend, connection handles, edge labels) out of the box

**Cons:**
- There's a discontinuity — feels like a smart cut, not flying in
- Two view trees to maintain

---

## Recommended plan

**Start with Path 2** to validate the UX in ~1–2 days. If the cross-fade feels right, ship it. If it feels jarring and the cinematic version is worth the investment, *then* do Path 1.

The piece that's reusable between both paths: **the `<PeakyCard />` component** that takes a node and renders the case-board card with image, fields, and connection-handle dots. Build that first — it's the same artifact regardless of which path wins.

---

## Shared building block — `<PeakyCard />`

Spec for the component used by both paths.

```tsx
type PeakyCardProps = {
  node: GraphNode
  variant?: "default" | "selected"
  onClick?: () => void
  /** Render connection handles at top/right/bottom/left for React Flow integration */
  showHandles?: boolean
}
```

Visual requirements (matching reference screenshot):
- Rounded card with type-colored chrome border + glow (Person = teal, Vehicle = orange, etc.)
- Type label pill at top ("PERSON", "VEHICLE", "PHONE")
- Hero image or icon if `node.properties.image_url` / type-default icon
- Title (large, bold) — `node.properties.name`
- 2–4 labeled field rows from `node.properties` (whitelist per type, e.g. Person → Born, Phone, Role)
- Blue connection handle dots on each edge (top/right/bottom/left) when `showHandles`
- Drop shadow + subtle backdrop blur for depth on dark bg

Type → field config:
```ts
const FIELD_CONFIG: Record<string, { label: string; key: string }[]> = {
  Person: [
    { label: "Title", key: "title" },
    { label: "Role", key: "role" },
    { label: "Home", key: "home" },
    { label: "Faction", key: "faction" },
  ],
  Station: [
    { label: "Line", key: "metro_line" },
    { label: "Status", key: "station_status" },
    { label: "Faction", key: "faction" },
  ],
  Organization: [
    { label: "Alias", key: "alias" },
    { label: "Ideology", key: "ideology" },
  ],
  // ... etc per node_type
}
```

Type → chrome color:
```ts
const TYPE_THEME: Record<string, { border: string; pill: string; glow: string }> = {
  Person:       { border: "border-cyan-500/50",   pill: "bg-cyan-500/20 text-cyan-300",   glow: "shadow-cyan-500/30" },
  Organization: { border: "border-purple-500/50", pill: "bg-purple-500/20 text-purple-300", glow: "shadow-purple-500/30" },
  Location:     { border: "border-emerald-500/50",pill: "bg-emerald-500/20 text-emerald-300", glow: "shadow-emerald-500/30" },
  Station:      { border: "border-amber-500/50",  pill: "bg-amber-500/20 text-amber-300", glow: "shadow-amber-500/30" },
  Weapon:       { border: "border-red-500/50",    pill: "bg-red-500/20 text-red-300",     glow: "shadow-red-500/30" },
  Item:         { border: "border-slate-500/50",  pill: "bg-slate-500/20 text-slate-300", glow: "shadow-slate-500/30" },
  Transport:    { border: "border-orange-500/50", pill: "bg-orange-500/20 text-orange-300", glow: "shadow-orange-500/30" },
  Creature:     { border: "border-rose-500/50",   pill: "bg-rose-500/20 text-rose-300",   glow: "shadow-rose-500/30" },
}
```

---

## Implementation steps (Path 2)

Concrete punch list:

1. **Build `<PeakyCard />`** (~half day)
   - New file: `src/components/case/peaky-card.tsx`
   - Storybook-able / can be dropped into existing sidebar for visual testing first
   - Field whitelist + type theme as above

2. **Add React Flow** (~1 hour)
   - `npm install @xyflow/react`
   - Register `<PeakyCard />` as a custom `NodeTypes` entry
   - Custom `EdgeTypes` for the dashed bezier "linked to" style

3. **New route or modal: `/case/[refId]`** (~half day)
   - On mount: fetch node + 1-hop neighbors via `/v2/nodes/<refId>?expand=edges`
   - Layout: place selected node at center, neighbors in a radial ring around it (simple polar coords)
   - Render React Flow with the data

4. **Click handoff from 3D** (~half day)
   - Add click handler on graph-canvas selected node → trigger camera dolly + navigate to `/case/<refId>`
   - Capture pre-navigation screen position of the clicked node
   - On case view mount: place selected node at that screen position initially, then `fitView()` after fade

5. **Cross-fade animation** (~few hours)
   - Wrap both views in an animation container
   - 3D Canvas opacity → 0 over 300ms after click
   - Case view opacity → 1 over 300ms (overlapping)
   - Back button reverses

6. **Backend integration** (~few hours)
   - Verify `/v2/nodes/<refId>?expand=edges` returns expected shape
   - For metro fixture nodes that don't exist in backend (stations), fall back to local fixture lookup (similar pattern to the existing short-circuit in `node-preview-panel.tsx`)

---

## Open questions / decisions to make

- **Editable or read-only?** Peaky Blinders demo lets you drag-bend edges and presumably add links. For graphmindset's first iteration, probably read-only (no link editing) — pan/zoom + drag node positions only. Editing is a v2.
- **What goes back to the backend?** If editable, link adds/removes need new endpoints. For read-only, nothing.
- **Layout algorithm for the 2D case view?** Options:
  - Radial (selected in center, neighbors around it) — simple, predictable
  - Force-directed (Cytoscape-like) — looks more organic, more compute
  - Manual saved layouts per node (user can drag, persist positions) — most polish, needs storage
- **Multi-hop?** Just 1-hop neighbors, or expand on click for 2-hop / 3-hop? Probably 1-hop default with "expand" affordance per neighbor.
- **Image sources?** Persons have `properties.image_url` in some cases. For nodes without images, use type icon (already have `schema-icons.ts`). Need a default per type.
- **Back UX?** Browser back button, or in-app close button on the case view, or both?
- **Mobile?** Case view on mobile = vertical stack? Skip for v1 and focus desktop?
- **Animation library?** `framer-motion` for the cross-fade, or pure CSS transitions? Probably `framer-motion` for the more complex sequencing.

---

## Inspiration / prior art to study

- **G6 (AntV)** — MIT licensed (`github.com/antvis/G6`), has the cleanest declarative LOD pattern (`{ lod: 1 }` per element). Worth reading `packages/g6/src/elements/nodes/base-node.ts` and the `behaviors/` folder. Patterns translate; code does not (2D Canvas vs our R3F).
- **React Flow / xyflow** — `reactflow.dev`. Built-in semantic zoom via `useViewport()` hook returning `{ zoom }`. Edge bending, connection handles, custom nodes all native.
- **Cytoscape.js** — alternative to React Flow with zoom-conditional styling built into the style API (`min-zoomed-font-size` etc.).
- **The Peaky Blinders demo itself** — almost certainly React Flow under the hood. The blue connection-handle dots and bend-by-drag interaction are giveaways.

---

## Files likely to be touched

When implementing Path 2:
- **New:** `src/components/case/peaky-card.tsx`, `src/components/case/case-view.tsx`, `src/app/case/[refId]/page.tsx` (or a modal slot in the existing layout)
- **Edit:** `src/components/universe/graph-canvas.tsx` — wire click → navigate transition
- **Edit:** `src/stores/graph-store.ts` — possibly add case-view state (current refId, transition phase)
- **New (maybe):** `src/lib/case-layout.ts` — radial/force layout for 2D case view

When implementing Path 1 (later, if pursued):
- **Edit:** `src/graph-viz-kit/GraphView.tsx` — major refactor to use `<Html />` overlays with LOD
- **New:** `src/components/universe/node-lod.tsx` — the variant-switching wrapper component
- **Edit:** `src/components/universe/graph-canvas.tsx` — replace direct rendering with NodeLOD
