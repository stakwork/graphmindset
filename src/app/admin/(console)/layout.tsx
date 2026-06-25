"use client"

import { useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ArrowLeft,
  SlidersHorizontal,
  Palette,
  Network,
  Boxes,
  Stethoscope,
  CalendarClock,
  Wrench,
  Activity,
  ClipboardList,
  type LucideIcon,
} from "lucide-react"
import { useReviewStore } from "@/stores/review-store"
import { useUserStore } from "@/stores/user-store"
import { listReviews } from "@/lib/graph-api"
import { cn } from "@/lib/utils"

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  /** Full-screen tools live outside the console shell. */
  external?: boolean
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Graph",
    items: [
      { label: "General", href: "/admin/general", icon: SlidersHorizontal },
      { label: "Appearance", href: "/admin/appearance", icon: Palette },
    ],
  },
  {
    title: "Schema",
    items: [
      { label: "Ontology", href: "/admin/ontology", icon: Network, external: true },
      { label: "Domains", href: "/admin/domains", icon: Boxes, external: true },
      { label: "Audit", href: "/admin/audit", icon: Stethoscope },
    ],
  },
  {
    title: "Automation",
    items: [
      { label: "Schedule", href: "/admin/schedule", icon: CalendarClock },
      { label: "Janitors", href: "/admin/janitors", icon: Wrench },
      { label: "Activity", href: "/admin/activity", icon: Activity },
    ],
  },
  {
    title: "Moderation",
    items: [
      { label: "Reviews", href: "/admin/reviews", icon: ClipboardList, external: true },
    ],
  },
]

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const isAdmin = useUserStore((s) => s.isAdmin)
  const { pendingCount, setPendingCount } = useReviewStore()

  // Keep the Reviews badge fresh (same pattern as the toolkit).
  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    listReviews({ status: "pending", limit: 1 })
      .then((res) => { if (!cancelled) setPendingCount(res.total) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isAdmin, setPendingCount])

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-background/60">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <button
            type="button"
            aria-label="Back to graph"
            onClick={() => router.push("/")}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-sm font-heading font-semibold tracking-wide uppercase">
            Admin
          </h1>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="mb-4">
              <p className="px-2 pb-1 text-[10px] font-heading uppercase tracking-wider text-muted-foreground/70">
                {group.title}
              </p>
              {group.items.map((item) => {
                const active = pathname === item.href
                const Icon = item.icon
                const badge = item.href === "/admin/reviews" ? pendingCount : 0
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {badge > 0 && (
                      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-6 py-8">{children}</div>
      </main>
    </div>
  )
}
