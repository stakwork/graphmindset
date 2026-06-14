/** Converts seconds into a "MM:SS" string (e.g. 90 → "01:30") or "HH:MM:SS" for durations ≥ 1 hour (e.g. 86046 → "23:54:06"). */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rem = s % 60
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`
  }
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`
}
