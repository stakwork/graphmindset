"use client"

import { Sparkles, Workflow, GitMerge } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useModalStore, type AddTab } from "@/stores/modal-store"
import { AddSourceForm } from "@/components/modals/add-source-form"
import { AddNodeForm } from "@/components/modals/add-node-form"
import { AddEdgeForm } from "@/components/modals/add-edge-form"

// All three modes are open to everyone — like Add Node, edge creation is a
// paid action gated by sats (handled in the form), not by role.
const TABS: { id: AddTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "source", label: "Smart", icon: Sparkles },
  { id: "node", label: "Node", icon: Workflow },
  { id: "edge", label: "Edge", icon: GitMerge },
]

export function AddModal() {
  const activeModal = useModalStore((s) => s.activeModal)
  const tab = useModalStore((s) => s.addTab)
  const setTab = useModalStore((s) => s.setAddTab)
  const close = useModalStore((s) => s.close)

  const isOpen = activeModal === "add"

  // Guard against a stale/invalid tab id.
  const activeTab = TABS.some((t) => t.id === tab) ? tab : "source"

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="border-border/50 bg-card noise-bg sm:max-w-[560px]">
        <DialogHeader className="pr-8">
          <DialogTitle className="font-heading text-xl tracking-wide">
            Add to graph
          </DialogTitle>
          <DialogDescription className="max-w-[400px] leading-relaxed">
            Paste a link and we&apos;ll build it for you — or switch modes to create a node or edge by hand.
          </DialogDescription>
        </DialogHeader>

        {/* Segmented control */}
        <div className="mt-1 flex items-center gap-1 rounded-lg border border-border/50 bg-muted/30 p-1">
          {TABS.map((t) => {
            const Icon = t.icon
            const active = t.id === activeTab
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-[13px] font-semibold transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Only the active tab is mounted — gives each form fresh state and
            re-runs its on-mount fetches when selected. */}
        {activeTab === "source" && <AddSourceForm />}
        {activeTab === "node" && <AddNodeForm />}
        {activeTab === "edge" && <AddEdgeForm />}
      </DialogContent>
    </Dialog>
  )
}
