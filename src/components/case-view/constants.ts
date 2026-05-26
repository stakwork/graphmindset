// LOD thresholds — measured in apparent screen-px of an entity's radius
// (entity.r * cam.scale). Same primitive everywhere, threshold decides which
// rendering variant runs. Ported from graph-viz/src/components/SignalCanvasPage.
export const LOD = {
  MIN_VISIBLE: 2,    // below this: skip entirely
  GLYPH_MIN: 6,      // below this: single dot
  LABEL_VISIBLE: 12, // when leaf label appears
  LEAF_DETAIL: 30,   // when type/region subtitle appears
  LEAF_DEEP: 60,     // when full property card appears
}

export const C = {
  bg0: "#05080c",
  bg1: "#0a1016",
  ink: "#d7e6ea",
  inkDim: "#7a8e96",
  inkFaint: "#3d4a52",
  accent: "#4ae0d2",
  accentLine: "rgba(74, 224, 210, 0.55)",
  accentSoft: "rgba(74, 224, 210, 0.15)",
  warm: "#f5b65a",
  selected: "#ffd11a",
  panel: "rgba(10, 16, 22, 0.92)",
  panelBorder: "rgba(120, 200, 220, 0.28)",
}

export const FONT_SANS = '"Space Grotesk", system-ui, sans-serif'
export const FONT_MONO = '"JetBrains Mono", ui-monospace, monospace'

// Per-type hue mapping. Fall back to accent if a type isn't listed.
export const TYPE_HUES: Record<string, string> = {
  Person: "#7aa8df",
  Organization: "#a78bfa",
  Location: "#6ad3a4",
  Station: "#f5b65a",
  Weapon: "#f472b6",
  Item: "#5cc9d8",
  Transport: "#f59e0b",
  Creature: "#fb7185",
  Episode: "#4ae0d2",
  Chapter: "#4ae0d2",
  Clip: "#4ae0d2",
  Topic: "#a78bfa",
  Tweet: "#5cc9d8",
}

// Per-type visual radius (world units). Bigger means more prominent. Selected
// gets multiplied by SELECTED_SCALE in the layout pass.
export const KIND_RADIUS: Record<string, number> = {
  Person: 18,
  Organization: 22,
  Location: 20,
  Station: 16,
  Weapon: 14,
  Item: 14,
  Transport: 16,
  Creature: 16,
  Episode: 22,
  Chapter: 18,
  Clip: 14,
  Topic: 20,
  Tweet: 14,
}

export const DEFAULT_KIND_RADIUS = 16
export const SELECTED_SCALE = 1.35
