export const CADENCE_PRESETS: { label: string; value: string }[] = [
  { label: "Every 10 minutes", value: "*/10 * * * *" },
  { label: "Every hour",       value: "0 * * * *" },
  { label: "Every 3 hours",    value: "0 */3 * * *" },
  { label: "Every 6 hours",    value: "0 */6 * * *" },
  { label: "Every 12 hours",   value: "0 */12 * * *" },
  { label: "Weekly",           value: "0 0 * * 0" },
]

export function snapToPreset(cron: string): string {
  const match = CADENCE_PRESETS.find((p) => p.value === cron)
  if (match) return cron
  // Default to "Every 6 hours" as a safe fallback
  return "0 */6 * * *"
}
