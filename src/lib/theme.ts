// Theme detection — single source of truth for metro-vs-default visuals.
// Read from NEXT_PUBLIC_THEME so swapping themes is a deploy-config concern
// rather than a code change.
export function isMetroTheme(): boolean {
  return process.env.NEXT_PUBLIC_THEME === "metro"
}
