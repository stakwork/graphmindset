"use client"

import { Sparkles, Workflow, GitMerge, Scale } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useModalStore, type AddTab } from "@/stores/modal-store"
import { useAppStore } from "@/stores/app-store"
import { AddSourceForm } from "@/components/modals/add-source-form"
import { AddNodeForm } from "@/components/modals/add-node-form"
import { AddEdgeForm } from "@/components/modals/add-edge-form"
import { AddLegalForm } from "@/components/modals/add-legal-form"

export function AddModal() {
  const activeModal = useModalStore((s) => s.activeModal)
  const tab = useModalStore((s) => s.addTab)
  const setTab = useModalStore((s) => s.setAddTab)
  const close = useModalStore((s) => s.close)
  const activeSkin = useAppStore((s) => s.activeSkin)

  const isOpen = activeModal === "add"
  const isLegalSkin = activeSkin === "legal"

  // Build tabs dynamically based on active skin.
  const TABS: { id: AddTab; label: string; icon: React.ComponentType<{ className?: string }> }[] =
    isLegalSkin
      ? [
          { id: "legal", label: "Legal", icon: Scale },
          { id: "source", label: "Other", icon: Sparkles },
          { id: "node", label: "Node", icon: Workflow },
          { id: "edge", label: "Edge", icon: GitMerge },
        ]
      : [
          { id: "source", label: "Smart", icon: Sparkles },
          { id: "node", label: "Node", icon: Workflow },
          { id: "edge", label: "Edge", icon: GitMerge },
        ]

  // Guard against a stale/invalid tab id — falls back to the first available tab.
  const activeTab = TABS.some((t) => t.id === tab) ? tab : TABS[0].id

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
        {activeTab === "legal" && <AddLegalForm />}
        {activeTab === "source" && <AddSourceForm />}
        {activeTab === "node" && <AddNodeForm />}
        {activeTab === "edge" && <AddEdgeForm />}
      </DialogContent>
    </Dialog>
  )
}
