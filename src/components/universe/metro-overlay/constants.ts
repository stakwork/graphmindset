// Y offset for the schematic map — pushes lines and bullets below the node
// layer so nodes float visibly on top instead of sharing the y=0 plane.
export const MAP_Y_OFFSET = -0.6

// Lore graph nodes are lifted onto a higher Y plane so they float above the
// metro schematic. Stations keep their fixed positions at y=0; edges crossing
// the gap visually connect the two layers.
export const LORE_Y_LIFT = 18

// Real Moscow Metro line colors — applied to TUNNEL_TO edges so the
// schematic map reads the way an actual metro guide does.
export const METRO_LINE_COLORS: Record<string, [number, number, number]> = {
  red: [0.878, 0.188, 0.188],
  green: [0.0, 0.627, 0.188],
  darkblue: [0.0, 0.376, 0.69],
  lightblue: [0.0, 0.69, 0.941],
  brown: [0.565, 0.251, 0.125],
  orange: [0.941, 0.439, 0.0],
  purple: [0.565, 0.188, 0.627],
  yellow: [0.941, 0.753, 0.0],
  gray: [0.61, 0.64, 0.66],
  lightgreen: [0.61, 0.8, 0.33],
}

// Station state — drives the bullet fill and (via either endpoint) marks
// tunnel segments as blocked. Encodes the lore status the way a player would
// think of it: "is this place safe, abandoned, or hostile?"
export type StationState =
  | "inhabited"
  | "neutral"
  | "lost"
  | "anomaly"
  | "scorched"
  | "flood"
  | "quarantine"

export const STATION_FILL: Record<StationState, string> = {
  inhabited: "#f5efde",
  neutral: "#6b7280",
  lost: "#374151",
  anomaly: "#dc2626",
  scorched: "#1f1410",
  flood: "#1d5bbf",
  quarantine: "#d4a017",
}

export const STATION_STATE_LABEL: Record<StationState, string> = {
  inhabited: "Inhabited",
  neutral: "Neutral",
  lost: "Lost",
  anomaly: "Anomaly (creatures)",
  scorched: "Scorched",
  flood: "Flooded",
  quarantine: "Quarantine",
}

// Atmospheric glow color per state — used by the legend bullets.
export const STATION_GLOW: Record<StationState, string> = {
  inhabited: "#e89c4a",
  neutral: "#7a6f63",
  lost: "#c11e34",
  anomaly: "#7a1822",
  scorched: "#d97a1f",
  flood: "#2879d6",
  quarantine: "#a89000",
}

// States that make a tunnel impassable in lore — render its segments at
// reduced opacity so the map reads as "trunk lines that still work" plus
// "abandoned spurs you wouldn't dare walk."
export const BLOCKING_STATES = new Set<StationState>([
  "lost",
  "anomaly",
  "scorched",
  "flood",
  "quarantine",
])

export function statusToState(status: unknown, faction: unknown): StationState {
  const s = typeof status === "string" ? status : ""
  const f = typeof faction === "string" ? faction : "none"
  if (s === "anomaly") return "anomaly"
  if (s === "lost") return "lost"
  if (s === "scorched") return "scorched"
  if (s === "flood") return "flood"
  if (s === "quarantine") return "quarantine"
  if (s === "stronghold") return "inhabited"
  if (f !== "none" && f !== "") return "inhabited"
  return "neutral"
}

// Lore node types that should always cluster under labeled hubs in the metro
// view, even when individual members are well-connected. Each grouped type
// adds one hub on the hop-1 ring, which is what spreads the lore graph evenly
// around the circle outside the schematic.
export const METRO_FORCE_GROUPED_TYPES = new Set([
  "Person",
  "Organization",
  "Weapon",
  "Item",
  "Transport",
  "Creature",
])
