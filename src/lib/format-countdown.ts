/** Converts seconds into a "MM:SS" string (e.g. 90 → "01:30"). */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`
}
