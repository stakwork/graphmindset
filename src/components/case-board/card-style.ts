// Shared visual tokens for the case board (cards + group containers). Kept in
// one place so CaseCard and CaseGroup stay in sync. Accents are saturated
// enough to read as neon chrome against the very dark fills.

export const TYPE_ACCENT: Record<string, string> = {
  Person: "#5cc9d8",
  Organization: "#a78bfa",
  Location: "#6ee7b7",
  Station: "#fbbf24",
  Weapon: "#f87171",
  Item: "#5cc9d8",
  Transport: "#fb923c",
  Creature: "#f9a8d4",
  Episode: "#93c5fd",
  Chapter: "#93c5fd",
  Clip: "#93c5fd",
  Topic: "#a78bfa",
  Tweet: "#5cc9d8",
  Claim: "#fcd34d",
}

export const DEFAULT_ACCENT = "#94a3b8"

export const INK_PRIMARY = "#e8edf2"
export const INK_BODY = "#c9d1d9"
export const INK_DIM = "#6b7280"
export const CARD_BG = "#0d1218"
export const FIELD_BG = "#070b11"

export function accentFor(type: string | null | undefined): string {
  return (type && TYPE_ACCENT[type]) || DEFAULT_ACCENT
}
