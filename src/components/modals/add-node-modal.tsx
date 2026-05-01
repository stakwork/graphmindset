"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useModalStore } from "@/stores/modal-store"
import { useUserStore } from "@/stores/user-store"
import { getPrice, payL402 } from "@/lib/sphinx"
import { checkTopicExists, createNode } from "@/lib/graph-api"

type Status = "idle" | "checking" | "submitting" | "success" | "error"

export function AddNodeModal() {
  const { activeModal, close } = useModalStore()
  const setBudget = useUserStore((s) => s.setBudget)
  const pubKey = useUserStore((s) => s.pubKey)

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [price, setPrice] = useState<number | null>(null)
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Fetch price on open
  useEffect(() => {
    if (activeModal !== "addNode") return
    getPrice("v2/nodes", "post").then(setPrice).catch(() => setPrice(null))
  }, [activeModal])

  // Reset on close
  useEffect(() => {
    if (activeModal !== "addNode") {
      setName("")
      setDescription("")
      setErrorMsg(null)
      setStatus("idle")
      abortRef.current?.abort()
    }
  }, [activeModal])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const trimmedName = name.trim()
      if (!trimmedName) {
        setErrorMsg("Name is required")
        return
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      // 1. Preflight duplicate check (free, no payment)
      setStatus("checking")
      setErrorMsg(null)
      try {
        const check = await checkTopicExists(trimmedName, controller.signal)
        if (check.exists) {
          setStatus("error")
          setErrorMsg("A topic with this name already exists in the graph.")
          return
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        // Non-fatal: preflight failed, proceed anyway (server will catch)
      }

      // 2. Submit with payment
      const doCreate = async () => {
        const response = await createNode(
          "Topic",
          { name: trimmedName, description: description.trim() || undefined },
          controller.signal
        )
        // Server-side race-condition duplicate
        if ((response as Record<string, unknown>)?.status === "Warning") {
          setStatus("error")
          setErrorMsg("A topic with this name already exists in the graph.")
          return
        }
        setStatus("success")
        setTimeout(() => close(), 1500)
      }

      setStatus("submitting")
      try {
        await doCreate()
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        if (err instanceof Response && err.status === 402) {
          try {
            await payL402(setBudget)
            await doCreate()
          } catch {
            setStatus("error")
            setErrorMsg("Payment failed. Please try again.")
          }
          return
        }
        setStatus("error")
        setErrorMsg("Something went wrong. Please try again.")
      }
    },
    [name, description, setBudget, close]
  )

  const isOpen = activeModal === "addNode"
  const busy = status === "checking" || status === "submitting" || status === "success"

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg tracking-wide">Add Topic</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Create a new topic node in the graph.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="relative z-10 space-y-4 pt-2">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
              Name <span className="text-destructive">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setErrorMsg(null)
              }}
              placeholder="e.g. Bitcoin"
              maxLength={200}
              disabled={busy}
              className="h-10 w-full rounded-md border border-border/50 bg-muted/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none disabled:opacity-50"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-heading">
              Description{" "}
              <span className="normal-case text-muted-foreground/60">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this topic..."
              rows={3}
              maxLength={1000}
              disabled={busy}
              className="w-full rounded-md border border-border/50 bg-muted/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none resize-none disabled:opacity-50"
            />
          </div>

          {/* Error */}
          {errorMsg && (
            <p className="text-xs text-destructive">{errorMsg}</p>
          )}

          {/* Anon-loss disclosure */}
          {!pubKey && (
            <p className="text-xs text-muted-foreground mt-2">
              Earnings are credited to this browser&#39;s L402. Clearing storage will lose your sats.
            </p>
          )}

          {/* Price + Submit */}
          <div className="flex items-center justify-between pt-1">
            {price !== null && price > 0 ? (
              <span className="text-xs text-muted-foreground font-mono">{price} sats</span>
            ) : (
              <span />
            )}
            <Button
              type="submit"
              disabled={busy}
              className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {status === "checking"
                ? "Checking..."
                : status === "submitting"
                  ? "Adding..."
                  : status === "success"
                    ? "Added!"
                    : price && price > 0
                      ? `Add Topic · ${price} sats`
                      : "Add Topic"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
