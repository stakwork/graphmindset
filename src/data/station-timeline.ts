import type { GraphNode } from "@/lib/graph-api"
import {
  STATION_FILL,
  STATION_GLOW,
  STATION_STATE_LABEL,
  statusToState,
  type StationState,
} from "@/components/universe/metro-overlay"

// Station time dial — five canonical epochs of the Metro universe. The dial
// is a navigation/framing mechanic; it carries only data we can stand behind:
//   • Pre-war / War — universal facts of the setting (every Moscow station
//     opened as civic infrastructure and sealed as a shelter in 2013).
//   • 2033 / 2036 — no per-station records exist yet, so these read as
//     "no archival record" rather than inventing station-specific lore.
//   • Present day — the real fixture state (status, description).
// Hand-authored or sourced per-era stories can later populate `text` (and the
// 2033/2036 status/faction) without changing the dial itself.

export type EraId = "prewar" | "war" | "y2033" | "y2036" | "now"

export interface Era {
  id: EraId
  // Short dial-notch label.
  year: string
  // Zone-plate era title.
  label: string
}

export const ERAS: Era[] = [
  { id: "prewar", year: "1935", label: "PRE-WAR ERA" },
  { id: "war", year: "2013", label: "THE WAR" },
  { id: "y2033", year: "2033", label: "YEAR 2033" },
  { id: "y2036", year: "2036", label: "EXODUS ERA" },
  { id: "now", year: "2087", label: "PRESENT DAY" },
]

export interface EraSnapshot {
  era: EraId
  year: string
  label: string
  // Status chip word + colors for this era. `status` is null when there's no
  // record to show (the card then renders a "no archival record" placeholder).
  status: string | null
  statusFill: string
  statusGlow: string
  // Zone-plate secondary line (controlling power of the era).
  faction: string | null
  // The story paragraph — null when no real record exists for the era.
  text: string | null
}

// Chip palette for the canonical bookend statuses.
const ERA_CHIP: Record<string, { fill: string; glow: string }> = {
  CIVIC: { fill: "#cfe8ef", glow: "#7fd4e8" },
  SHELTER: { fill: "#d4a017", glow: "#e8b54a" },
  NEUTRAL: { fill: "#9aa3ab", glow: "#b8c2cc" },
}

// Dim accent for eras with no record — used by the zone-plate marker bar.
const NO_RECORD = { fill: "#39424a", glow: "#5a646c" }

// Current-state story templates for the "now" era when a station has no
// authored description. Describes the present real status, not past events.
const NOW_TEXT: Record<StationState, string> = {
  inhabited:
    "Still inhabited in 2087 — cook-fires on the platform, a generation born here that has never seen the sky. The tunnels are watched in both directions.",
  neutral:
    "Holding on as neutral ground in 2087. Travelers pass through, few stay; the station keeps its lamps low and its opinions lower.",
  lost: "Lost. The lights failed decades ago and nobody reclaimed the dark. Caravans seal their masks and pass the platform at a run.",
  anomaly:
    "An anomaly zone in 2087 — instruments spin, sounds arrive before their causes, and the things on the platform are not always there when you look twice.",
  scorched:
    "Scorched out — fire took the station and the burn shadow still stains the vault. Nothing has grown back. Nothing will.",
  flood: "Drowned. Black water stands to the escalator crowns, and divers tell stories about what swims the lower halls.",
  quarantine:
    "Under quarantine — the seals went up after the outbreak and no faction has dared cut them since. The warning signs are repainted every year.",
}

function stateWord(label: string): string {
  return label.split(" (")[0].toUpperCase()
}

function chipSpread(status: string): { statusFill: string; statusGlow: string } {
  const c = ERA_CHIP[status] ?? ERA_CHIP.NEUTRAL
  return { statusFill: c.fill, statusGlow: c.glow }
}

export function stationTimeline(node: GraphNode): EraSnapshot[] {
  const p = node.properties as Record<string, unknown>
  const state = statusToState(p.station_status ?? p.status, p.faction)
  const description = typeof p.description === "string" ? p.description : null

  // Canonical bookends — true of every station in the setting, so framed
  // without inventing station-specific narrative.
  const prewar: EraSnapshot = {
    era: "prewar",
    year: "1935",
    label: "PRE-WAR ERA",
    status: "CIVIC",
    ...chipSpread("CIVIC"),
    faction: "MOSCOW METROPOLITEN",
    text: null,
  }

  const war: EraSnapshot = {
    era: "war",
    year: "2013",
    label: "THE WAR",
    status: "SHELTER",
    ...chipSpread("SHELTER"),
    faction: "CIVIL DEFENSE",
    text: null,
  }

  // No per-station records for the book years — leave them empty rather than
  // fabricate lore.
  const y2033: EraSnapshot = {
    era: "y2033",
    year: "2033",
    label: "YEAR 2033",
    status: null,
    statusFill: NO_RECORD.fill,
    statusGlow: NO_RECORD.glow,
    faction: null,
    text: null,
  }

  const y2036: EraSnapshot = {
    era: "y2036",
    year: "2036",
    label: "EXODUS ERA",
    status: null,
    statusFill: NO_RECORD.fill,
    statusGlow: NO_RECORD.glow,
    faction: null,
    text: null,
  }

  const now: EraSnapshot = {
    era: "now",
    year: "2087",
    label: "PRESENT DAY",
    status: stateWord(STATION_STATE_LABEL[state]),
    statusFill: STATION_FILL[state],
    statusGlow: STATION_GLOW[state],
    faction: null,
    text: description ?? NOW_TEXT[state],
  }

  return [prewar, war, y2033, y2036, now]
}
