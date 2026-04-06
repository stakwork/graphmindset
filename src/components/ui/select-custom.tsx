"use client"

import { useState, useRef, useEffect } from "react"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface Option {
  value: string
  label: string
}

interface SelectCustomProps {
  value: string
  onChange: (value: string) => void
  options: Option[]
  placeholder?: string
  className?: string
  compact?: boolean
}

export function SelectCustom({
  value,
  onChange,
  options,
  placeholder,
  className,
  compact = false,
}: SelectCustomProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)

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

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between rounded-md border border-border/50 bg-muted/50 text-sm text-foreground",
          "hover:border-border focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20",
          compact ? "h-6 px-2 text-[10px] font-mono" : "h-8 px-2.5"
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder ?? "Select..."}
        </span>
        <ChevronDown
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            compact ? "h-3 w-3 ml-1" : "h-3.5 w-3.5 ml-2",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[120px] rounded-md border border-border/50 bg-popover py-1 shadow-lg shadow-black/20">
          <div className="max-h-[200px] overflow-y-auto">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 text-left text-sm transition-colors",
                  compact ? "py-1 text-[10px] font-mono" : "py-1.5",
                  opt.value === value
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted/50"
                )}
              >
                <Check
                  className={cn(
                    "h-3 w-3 shrink-0",
                    opt.value === value ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="truncate">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
