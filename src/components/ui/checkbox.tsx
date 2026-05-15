"use client"

import { useEffect, useRef } from "react"
import { Check, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  indeterminate?: boolean
  disabled?: boolean
  ariaLabel?: string
  className?: string
  onClick?: (e: React.MouseEvent) => void
}

export function Checkbox({
  checked,
  onChange,
  indeterminate = false,
  disabled = false,
  ariaLabel,
  className,
  onClick,
}: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate && !checked
  }, [indeterminate, checked])

  const showCheck = checked
  const showDash = indeterminate && !checked

  return (
    <span
      className={cn(
        "relative inline-flex h-4 w-4 shrink-0 items-center justify-center",
        className
      )}
    >
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onClick={onClick}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
        className="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none flex h-full w-full items-center justify-center rounded-[3px] border transition-colors",
          showCheck || showDash
            ? "border-primary bg-primary text-background"
            : "border-border bg-background hover:border-muted-foreground/60",
          disabled && "opacity-50"
        )}
      >
        {showCheck && <Check className="h-3 w-3" strokeWidth={3} />}
        {showDash && <Minus className="h-3 w-3" strokeWidth={3} />}
      </span>
    </span>
  )
}
