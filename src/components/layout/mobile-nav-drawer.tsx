"use client"

import { useEffect } from "react"
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
  ClipboardList,
} from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { useUserStore } from "@/stores/user-store"
import { useAppStore } from "@/stores/app-store"
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

interface DrawerItemProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  active?: boolean
  badge?: number
}

function DrawerItem({ icon: Icon, label, onClick, active = false, badge }: DrawerItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
        "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-muted/40",
        active && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  )
}

interface MobileNavDrawerProps {
  open: boolean
  onClose: () => void
  sourcesOpen: boolean
  onToggleSources: () => void
  myContentOpen: boolean
  onToggleMyContent: () => void
}

export function MobileNavDrawer({
  open,
  onClose,
  sourcesOpen,
  onToggleSources,
  myContentOpen,
  onToggleMyContent,
}: MobileNavDrawerProps) {
  const router = useRouter()
  const { isAdmin, budget } = useUserStore()
  const { graphName } = useAppStore()
  const openModal = useModalStore((s) => s.open)
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

  function handle(action: () => void) {
    action()
    onClose()
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent side="left" className="w-72 p-0 flex flex-col bg-sidebar noise-bg">
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 shrink-0">
              <CircleDot className="h-4 w-4 text-primary" />
            </div>
            <div className="flex flex-col min-w-0">
              <SheetTitle className="text-sm font-semibold truncate leading-tight">
                {graphName || "Knowledge Graph"}
              </SheetTitle>
              <div className="flex items-center gap-2 mt-0.5">
                {/* Budget */}
                <button
                  type="button"
                  aria-label={fullBudget}
                  onClick={() => handle(() => openModal("budget"))}
                  className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted/40 transition-colors group"
                >
                  <Zap className="h-3 w-3 text-amber glow-text-amber group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-mono text-amber/80 group-hover:text-amber">
                    {formattedBudget}
                  </span>
                </button>
                {/* Connection dot */}
                <div
                  aria-label={connectionLabel}
                  title={connectionLabel}
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    connectionActive
                      ? "bg-emerald-400 shadow-[0_0_4px_theme(colors.emerald.400)]"
                      : "bg-muted-foreground/40"
                  )}
                />
                <span className="text-[10px] text-muted-foreground truncate">
                  {connectionLabel}
                </span>
              </div>
            </div>
          </div>
        </SheetHeader>

        <nav className="flex flex-col gap-1 px-2 py-3 flex-1">
          <DrawerItem
            icon={Plus}
            label="Add Content"
            onClick={() => handle(() => openModal("addContent"))}
          />
          <DrawerItem
            icon={Tag}
            label="Add Topic"
            onClick={() => handle(() => openModal("addNode"))}
          />
          <DrawerItem
            icon={BookMarked}
            label="My Content"
            active={myContentOpen}
            onClick={() => handle(onToggleMyContent)}
          />
          <DrawerItem
            icon={Layers}
            label="Sources"
            active={sourcesOpen}
            onClick={() => handle(onToggleSources)}
          />
        </nav>

        {isAdmin && (
          <>
            <Separator className="bg-sidebar-border" />
            <div className="flex flex-col gap-1 px-2 py-3">
              <DrawerItem
                icon={Network}
                label="Ontology"
                onClick={() => handle(() => router.push("/ontology"))}
              />
              <DrawerItem
                icon={ClipboardList}
                label="Reviews"
                badge={pendingCount}
                onClick={() => handle(() => router.push("/admin/reviews"))}
              />
              <DrawerItem
                icon={Settings}
                label="Settings"
                onClick={() => handle(() => openModal("settings"))}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
