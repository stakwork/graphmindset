"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Layers,
  Plus,
  Settings,
  Zap,
  Network,
  BookMarked,
  Tag,
  ClipboardList,
  Heart,
  Menu,
  X,
  MessageSquare,
  Cpu,
  GitMerge,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useUserStore } from "@/stores/user-store"
import { useModalStore } from "@/stores/modal-store"
import { useReviewStore } from "@/stores/review-store"
import { isSphinx } from "@/lib/sphinx/detect"
import { hasWebLN } from "@/lib/sphinx/bridge"
import { cn } from "@/lib/utils"
import { listReviews } from "@/lib/graph-api"

function formatSatsCompact(n: number): string {
  if (n < 1000) return n.toString()
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
}

function ToolkitButton({
  icon: Icon,
  ariaLabel,
  onClick,
  active = false,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>
  ariaLabel: string
  onClick?: () => void
  active?: boolean
  badge?: number
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={ariaLabel}
            aria-pressed={active}
            onClick={onClick}
            className={cn(
              "group relative flex h-10 w-10 items-center justify-center rounded-md transition-colors",
              "text-muted-foreground hover:text-foreground hover:bg-muted/40",
              active && "text-primary hover:text-primary bg-primary/10"
            )}
          >
            <Icon className="h-4 w-4 transition-transform group-hover:scale-110" />
            <span
              className={cn(
                "absolute top-2 bottom-2 -right-px w-px transition-all",
                active
                  ? "bg-primary shadow-[0_0_8px_oklch(0.72_0.14_200/0.8)] opacity-100"
                  : "bg-primary/0 opacity-0"
              )}
            />
            {badge !== undefined && badge > 0 && (
              <span className="absolute top-1 right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[8px] font-bold text-primary-foreground pointer-events-none">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </button>
        }
      />
      <TooltipContent side="left">{ariaLabel}</TooltipContent>
    </Tooltip>
  )
}

function Divider() {
  return <span className="my-1 mx-2 h-px w-6 bg-border/60 self-center" aria-hidden />
}

export function Toolkit({
  sourcesOpen,
  onToggleSources,
  myContentOpen,
  onToggleMyContent,
  followingOpen,
  onToggleFollowing,
  agentOpen,
  onToggleAgent,
  workflowsOpen,
  onToggleWorkflows,
}: {
  sourcesOpen: boolean
  onToggleSources: () => void
  myContentOpen: boolean
  onToggleMyContent: () => void
  followingOpen: boolean
  onToggleFollowing: () => void
  agentOpen?: boolean
  onToggleAgent?: () => void
  workflowsOpen?: boolean
  onToggleWorkflows?: () => void
}) {
  const router = useRouter()
  const { isAdmin, budget } = useUserStore()
  const openModal = useModalStore((s) => s.open)
  const openAddEdge = useModalStore((s) => s.openAddEdge)
  const { pendingCount, setPendingCount } = useReviewStore()

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    listReviews({ status: "pending", limit: 1 })
      .then((res) => { if (!cancelled) setPendingCount(res.total) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isAdmin, setPendingCount])

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
    <div className="hidden sm:flex flex-col items-stretch gap-0.5 rounded-md border border-border/50 bg-background/70 backdrop-blur-sm px-0.5 py-1 shadow-[0_8px_30px_oklch(0_0_0/0.45)]">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Manage budget"
              onClick={() => openModal("budget")}
              className="group flex flex-col items-center justify-center gap-0.5 px-1.5 py-1.5 rounded-md text-muted-foreground hover:bg-muted/40 transition-colors"
            >
              <Zap className="h-3.5 w-3.5 text-amber glow-text-amber transition-transform group-hover:scale-110" />
              <span className="font-mono text-[8px] tracking-[0.1em] leading-none text-amber/80 group-hover:text-amber">
                {formattedBudget}
              </span>
            </button>
          }
        />
        <TooltipContent side="left">{fullBudget}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <div
              aria-label={connectionLabel}
              className="flex items-center justify-center py-1.5"
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  connectionActive
                    ? "bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]"
                    : "bg-muted-foreground/40"
                )}
              />
            </div>
          }
        />
        <TooltipContent side="left">{connectionLabel}</TooltipContent>
      </Tooltip>

      <Divider />

      <ToolkitButton icon={Plus} ariaLabel="Add Content" onClick={() => openModal("addContent")} />
      <ToolkitButton icon={Tag} ariaLabel="Add Node" onClick={() => openModal("addNode")} />
      <ToolkitButton
        icon={MessageSquare}
        ariaLabel="Ask the Graph"
        onClick={onToggleAgent}
        active={agentOpen}
      />
      <ToolkitButton
        icon={BookMarked}
        ariaLabel="My Content"
        onClick={onToggleMyContent}
        active={myContentOpen}
      />
      <ToolkitButton
        icon={Heart}
        ariaLabel="Following"
        onClick={onToggleFollowing}
        active={followingOpen}
      />
      <ToolkitButton
        icon={Layers}
        ariaLabel="Sources"
        onClick={onToggleSources}
        active={sourcesOpen}
      />
      <ToolkitButton
        icon={Cpu}
        ariaLabel="Workflows"
        onClick={onToggleWorkflows}
        active={workflowsOpen}
      />

      {isAdmin && (
        <>
          <Divider />
          <ToolkitButton
            icon={GitMerge}
            ariaLabel="Add Edge"
            onClick={() => openAddEdge()}
          />
          <ToolkitButton
            icon={Network}
            ariaLabel="Ontology"
            onClick={() => router.push("/ontology")}
          />
          <ToolkitButton
            icon={ClipboardList}
            ariaLabel="Reviews"
            onClick={() => router.push("/admin/reviews")}
            badge={pendingCount}
          />
          <ToolkitButton
            icon={Settings}
            ariaLabel="Settings"
            onClick={() => openModal("settings")}
          />
        </>
      )}
    </div>
  )
}

export function ToolkitFAB({
  sourcesOpen,
  onToggleSources,
  myContentOpen,
  onToggleMyContent,
  followingOpen,
  onToggleFollowing,
  agentOpen,
  onToggleAgent,
  workflowsOpen,
  onToggleWorkflows,
}: {
  sourcesOpen: boolean
  onToggleSources: () => void
  myContentOpen: boolean
  onToggleMyContent: () => void
  followingOpen: boolean
  onToggleFollowing: () => void
  agentOpen?: boolean
  onToggleAgent?: () => void
  workflowsOpen?: boolean
  onToggleWorkflows?: () => void
}) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { isAdmin, budget } = useUserStore()
  const openModal = useModalStore((s) => s.open)
  const openAddEdge = useModalStore((s) => s.openAddEdge)
  const { pendingCount } = useReviewStore()

  const formattedBudget =
    budget !== null && budget !== undefined ? formatSatsCompact(budget) : "--"

  const sphinxConnected = typeof window !== "undefined" && isSphinx()
  const weblnAvailable = typeof window !== "undefined" && hasWebLN()
  const connectionLabel = sphinxConnected
    ? "Sphinx Connected"
    : weblnAvailable
      ? "WebLN Available"
      : "Browser Mode"
  const connectionActive = sphinxConnected || weblnAvailable

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 sm:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* FAB + popup wrapper */}
      <div className="fixed bottom-20 right-4 z-50 sm:hidden flex flex-col items-end gap-2">
        {/* Popup — opens upward */}
        {open && (
          <div className="flex flex-col gap-0.5 rounded-md border border-border/50 bg-background/90 backdrop-blur-sm px-1 py-1 shadow-xl mb-2">
            {/* Budget row */}
            <button
              onClick={() => { openModal("budget"); setOpen(false) }}
              className="flex items-center gap-2 px-3 py-2 rounded-md text-muted-foreground hover:bg-muted/40"
            >
              <Zap className="h-4 w-4 text-amber-400" />
              <span className="text-xs">{formattedBudget} sats</span>
            </button>
            {/* Connection indicator */}
            <div className="flex items-center gap-2 px-3 py-2">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  connectionActive ? "bg-emerald-400" : "bg-muted-foreground/40"
                )}
              />
              <span className="text-xs text-muted-foreground">{connectionLabel}</span>
            </div>
            <div className="my-1 mx-2 h-px bg-border/60" />
            {/* Action buttons — icon + label */}
            {[
              { icon: Plus, label: "Add Content", action: () => openModal("addContent"), active: false },
              { icon: Tag, label: "Add Node", action: () => openModal("addNode"), active: false },
              { icon: MessageSquare, label: "Ask the Graph", action: onToggleAgent ?? (() => {}), active: agentOpen ?? false },
              { icon: BookMarked, label: "My Content", action: onToggleMyContent, active: myContentOpen },
              { icon: Heart, label: "Following", action: onToggleFollowing, active: followingOpen },
              { icon: Layers, label: "Sources", action: onToggleSources, active: sourcesOpen },
              { icon: Cpu, label: "Workflows", action: onToggleWorkflows ?? (() => {}), active: workflowsOpen ?? false },
            ].map(({ icon: Icon, label, action, active }) => (
              <button
                key={label}
                onClick={() => { action(); setOpen(false) }}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md transition-colors",
                  "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                  active && "text-primary bg-primary/10"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="text-xs">{label}</span>
              </button>
            ))}
            {isAdmin && (
              <>
                <div className="my-1 mx-2 h-px bg-border/60" />
                {[
                  { icon: GitMerge, label: "Add Edge", action: () => openAddEdge() },
                  { icon: Network, label: "Ontology", action: () => router.push("/ontology") },
                  {
                    icon: ClipboardList,
                    label: `Reviews${pendingCount > 0 ? ` (${pendingCount})` : ""}`,
                    action: () => router.push("/admin/reviews"),
                  },
                  { icon: Settings, label: "Settings", action: () => openModal("settings") },
                ].map(({ icon: Icon, label, action }) => (
                  <button
                    key={label}
                    onClick={() => { action(); setOpen(false) }}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-xs">{label}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* FAB button */}
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
          className="h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center transition-transform active:scale-95"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
    </>
  )
}
