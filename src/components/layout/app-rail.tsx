"use client"

import { useRouter } from "next/navigation"
import {
  Layers,
  Plus,
  Settings,
  Zap,
  CircleDot,
  Network,
  BookMarked,
  Tag,
} from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useUserStore } from "@/stores/user-store"
import { useAppStore } from "@/stores/app-store"
import { useModalStore } from "@/stores/modal-store"
import { isSphinx } from "@/lib/sphinx/detect"
import { hasWebLN } from "@/lib/sphinx/bridge"
import { cn } from "@/lib/utils"

function formatSatsCompact(n: number): string {
  if (n < 1000) return n.toString()
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
}

function RailIcon({
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
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-md transition-colors text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-muted/40",
              active && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        }
      />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

export function AppRail({
  sourcesOpen,
  onToggleSources,
  myContentOpen,
  onToggleMyContent,
}: {
  sourcesOpen: boolean
  onToggleSources: () => void
  myContentOpen: boolean
  onToggleMyContent: () => void
}) {
  const router = useRouter()
  const { isAdmin, budget, pubKey } = useUserStore()
  const { graphName } = useAppStore()
  const openModal = useModalStore((s) => s.open)

  const formattedBudget =
    budget !== null && budget !== undefined ? formatSatsCompact(budget) : "--"
  const fullBudget =
    budget !== null && budget !== undefined ? `${budget.toLocaleString()} sats` : "Manage budget"

  const sphinxConnected = typeof window !== "undefined" && isSphinx()
  const weblnAvailable = typeof window !== "undefined" && hasWebLN()
  const connectionLabel = sphinxConnected
    ? "Sphinx Connected"
    : weblnAvailable
      ? "WebLN Available"
      : "Browser Mode"
  const connectionActive = sphinxConnected || weblnAvailable

  return (
    <aside className="flex h-full w-[56px] shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar noise-bg">
      {/* Logo */}
      <div className="relative z-10 flex flex-col items-center gap-2 pt-3 pb-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
                <CircleDot className="h-4 w-4 text-primary" />
              </div>
            }
          />
          <TooltipContent side="right">{graphName || "Knowledge Graph"}</TooltipContent>
        </Tooltip>

        {/* Budget badge */}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Manage budget"
                onClick={() => openModal("budget")}
                className="flex flex-col items-center gap-0.5 rounded-md px-1.5 py-1 hover:bg-muted/40 transition-colors group"
              >
                <Zap className="h-3.5 w-3.5 text-amber glow-text-amber transition-transform group-hover:scale-110" />
                <span className="text-[9px] font-mono text-amber/80 group-hover:text-amber leading-none">
                  {formattedBudget}
                </span>
              </button>
            }
          />
          <TooltipContent side="right">{fullBudget}</TooltipContent>
        </Tooltip>

        {/* Connection dot */}
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                aria-label={connectionLabel}
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  connectionActive
                    ? "bg-emerald-400 shadow-[0_0_4px_theme(colors.emerald.400)]"
                    : "bg-muted-foreground/40"
                )}
              />
            }
          />
          <TooltipContent side="right">{connectionLabel}</TooltipContent>
        </Tooltip>
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Nav */}
      <nav className="relative z-10 flex flex-1 flex-col items-center gap-1 py-3">
        <RailIcon icon={Plus} label="Add Content" onClick={() => openModal("addContent")} />
        <RailIcon icon={Tag} label="Add Topic" onClick={() => openModal("addNode")} />
        {pubKey && (
          <RailIcon
            icon={BookMarked}
            label="My Content"
            onClick={onToggleMyContent}
            active={myContentOpen}
          />
        )}
        <RailIcon
          icon={Layers}
          label="Sources"
          onClick={onToggleSources}
          active={sourcesOpen}
        />
      </nav>

      {/* Footer — bottom padding mirrors the header's top padding so the rail looks symmetric, with extra room for the host app's reload button */}
      <div className="relative z-10 flex flex-col items-center gap-1 border-t border-sidebar-border pt-3 pb-12 w-full">
        {isAdmin && (
          <RailIcon
            icon={Network}
            label="Ontology"
            onClick={() => router.push("/ontology")}
          />
        )}
        {isAdmin && (
          <RailIcon
            icon={Settings}
            label="Settings"
            onClick={() => openModal("settings")}
          />
        )}
      </div>
    </aside>
  )
}
