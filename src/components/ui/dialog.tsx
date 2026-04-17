"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { XIcon } from "lucide-react"

interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <DialogContext.Provider value={{ open: !!open, onOpenChange }}>
      {children}
    </DialogContext.Provider>
  )
}

const DialogContext = React.createContext<{
  open: boolean
  onOpenChange?: (open: boolean) => void
}>({ open: false })

function useDialog() {
  return React.useContext(DialogContext)
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  const { open, onOpenChange } = useDialog()
  const [mounted, setMounted] = React.useState(false)
  const { showCloseButton = true, ...divProps } = props

  React.useEffect(() => setMounted(true), [])

  if (!mounted || !open) return null

  return createPortal(
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        style={{ zIndex: 16777273 }}
        onClick={() => onOpenChange?.(false)}
      />
      {/* Content */}
      <div
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[calc(100%-2rem)] gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 sm:max-w-sm",
          className
        )}
        style={{ zIndex: 16777274 }}
        onClick={(e) => e.stopPropagation()}
        {...divProps}
      >
        {children}
        {showCloseButton && (
          <button
            className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => onOpenChange?.(false)}
          >
            <XIcon className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        )}
      </div>
    </>,
    document.body
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="dialog-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
}
