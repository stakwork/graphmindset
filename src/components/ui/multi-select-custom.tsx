"use client"

import { useState, useRef, useEffect } from "react"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"

export interface MultiSelectOption {
  value: string
  label: string
  disabled?: boolean
  hint?: string
}

interface MultiSelectCustomProps {
  value: string[]
  onChange: (values: string[]) => void
  options: MultiSelectOption[]
  placeholder?: string
  className?: string
}

export function MultiSelectCustom({
  value,
  onChange,
  options,
  placeholder = "Select...",
  className,
}: MultiSelectCustomProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open])

  const selectedLabels = value
    .map((v) => options.find((o) => o.value === v)?.label ?? v)
    .join(", ")

  const toggle = (optValue: string) => {
    if (value.includes(optValue)) {
      onChange(value.filter((v) => v !== optValue))
    } else {
      onChange([...value, optValue])
    }
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between rounded-md border border-border/50 bg-muted/50 text-sm text-foreground",
          "hover:border-border focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20",
          "h-8 px-2.5"
        )}
      >
        <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
          {value.length === 0 ? placeholder : selectedLabels}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 ml-2 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[120px] rounded-md border border-border/50 bg-popover py-1 shadow-lg shadow-black/20">
          <div className="max-h-[200px] overflow-y-auto">
            {options.map((opt) => {
              const isSelected = value.includes(opt.value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => !opt.disabled && toggle(opt.value)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors",
                    isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/50",
                    opt.disabled && "cursor-not-allowed opacity-50"
                  )}
                >
                  <Check
                    className={cn("h-3 w-3 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{opt.label}</span>
                  {opt.hint && (
                    <span className="ml-1 shrink-0 text-[10px] text-muted-foreground">
                      {opt.hint}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
