import { type SVGProps } from "react"

import { cn } from "@/lib/utils"

type BulletIconProps = SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string
}

export function BulletIcon({
  className,
  strokeWidth = 1.5,
  ...rest
}: BulletIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
      {...rest}
    >
      {/* bullet tip, occluded by the ingot below y=10 */}
      <path d="M9 10.3 C9 6.7 10 3.8 12 1.3 C14 3.8 15 6.7 15 10.3" />
      {/* casing, visible below the ingot */}
      <path d="M9 17 V21.4 C9 22.1 10 22.6 12 22.6 C14 22.6 15 22.1 15 21.4 V17" />
      {/* ingot: front, top and side faces */}
      <path d="M4 17 L6 12.5 L14.5 12.5 L16.5 17 Z" />
      <path d="M6 12.5 L9 10 L17.5 10 L14.5 12.5 Z" />
      <path d="M16.5 17 L14.5 12.5 L17.5 10 L19.5 14.5 Z" />
    </svg>
  )
}
