export const DISPLAY_KEY_FALLBACKS = ["name", "title", "label", "text", "content", "body"] as const

export function pickString(
  props: Record<string, unknown> | undefined,
  key: string | undefined
): string | undefined {
  if (!props || !key) return undefined
  const v = props[key]
  return typeof v === "string" && v.length > 0 ? v : undefined
}
