"use client"

import {
  Layers,
  Plus,
  Settings,
  Zap,
  CircleDot,
} from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { useUserStore } from "@/stores/user-store"
import { useAppStore } from "@/stores/app-store"
import { useModalStore } from "@/stores/modal-store"
import { isSphinx } from "@/lib/sphinx/detect"
import { hasWebLN } from "@/lib/sphinx/bridge"

function NavItem({
  icon: Icon,
  label,
  onClick,
  active = false,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick?: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`nav-item flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 hover:text-sidebar-foreground transition-colors ${active ? "active text-sidebar-foreground" : ""}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  )
}

export function AppSidebar({
  sourcesOpen,
  onToggleSources,
}: {
  sourcesOpen: boolean
  onToggleSources: () => void
}) {
  const { isAdmin, budget } = useUserStore()
  const { graphName } = useAppStore()
  const openModal = useModalStore((s) => s.open)

  const formattedBudget =
    budget !== null && budget !== undefined
      ? budget.toLocaleString()
      : "--"

  const sphinxConnected = typeof window !== "undefined" && isSphinx()
  const weblnAvailable = typeof window !== "undefined" && hasWebLN()

  const connectionLabel = sphinxConnected
    ? "Sphinx Connected"
    : weblnAvailable
      ? "WebLN Available"
      : "Browser Mode"

  const connectionActive = sphinxConnected || weblnAvailable

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar noise-bg">
      {/* Header */}
      <div className="relative z-10 flex flex-col gap-3 p-5 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
            <CircleDot className="h-4 w-4 text-primary" />
          </div>
          <div className="flex flex-col gap-0 overflow-hidden">
            <span className="truncate text-sm font-heading font-semibold tracking-wide text-sidebar-foreground">
              {graphName || "Knowledge Graph"}
            </span>
            <button
              onClick={() => openModal("budget")}
              className="flex items-center gap-1.5 group cursor-pointer w-fit"
            >
              <Zap className="h-3 w-3 text-amber glow-text-amber transition-transform group-hover:scale-110" />
              <span className="text-xs font-mono text-amber/80 group-hover:text-amber transition-colors">
                {formattedBudget} sats
              </span>
            </button>
          </div>
        </div>

        {/* Connection indicator */}
        <div className="flex items-center gap-2 px-1">
          <div
            className={`h-1.5 w-1.5 rounded-full ${
              connectionActive
                ? "bg-emerald-400 shadow-[0_0_4px_theme(colors.emerald.400)]"
                : "bg-muted-foreground/40"
            }`}
          />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading font-medium">
            {connectionLabel}
          </span>
        </div>
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Navigation */}
      <nav className="relative z-10 flex flex-1 flex-col gap-1 p-3 overflow-y-auto">
        <p className="px-3 pb-1.5 pt-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-heading font-semibold">
          Content
        </p>
        <NavItem
          icon={Plus}
          label="Add Content"
          onClick={() => openModal("addContent")}
        />
        <NavItem
          icon={Layers}
          label="Sources"
          active={sourcesOpen}
          onClick={onToggleSources}
        />

      </nav>

      {/* Footer — Settings at the bottom */}
      <div className="relative z-10 border-t border-sidebar-border p-3">
        {isAdmin && (
          <NavItem
            icon={Settings}
            label="Settings"
            onClick={() => openModal("settings")}
          />
        )}
      </div>
    </aside>
  )
}
