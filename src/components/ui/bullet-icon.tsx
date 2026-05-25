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
      <g transform="rotate(-35 12 12)">
        <path d="M12 1.5c-1.6 1.8-2.6 3.8-2.6 5.6V8.8h5.2V7.1C14.6 5.3 13.6 3.3 12 1.5Z" />
        <rect x="9.4" y="8.8" width="5.2" height="13.7" rx="0.6" />
        <line x1="9.4" y1="11.7" x2="14.6" y2="11.7" />
        <line x1="9.4" y1="20" x2="14.6" y2="20" />
      </g>
    </svg>
  )
}
