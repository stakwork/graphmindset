import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Display labels for node types. Backend types are camel-case
// (e.g. "TwitterAccount") which renders awkwardly as a chip — split on
// case boundaries and override specific cases.
const NODE_TYPE_LABELS: Record<string, string> = {
  Radar: "Source",
  TwitterAccount: "X Account",
  Twitteraccount: "X Account",
}

export function displayNodeType(nodeType: string): string {
  const override = NODE_TYPE_LABELS[nodeType]
  if (override) return override
  return nodeType.replace(/([a-z])([A-Z])/g, "$1 $2")
}
