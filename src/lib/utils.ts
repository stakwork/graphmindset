import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function displayNodeType(nodeType: string): string {
  return nodeType === "Radar" ? "Source" : nodeType
}
