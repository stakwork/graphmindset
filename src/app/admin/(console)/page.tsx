"use client"

import Link from "next/link"
import {
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

interface Card {
  label: string
  href: string
  icon: LucideIcon
  description: string
}

const CARDS: Card[] = [
  { label: "General", href: "/admin/general", icon: SlidersHorizontal, description: "Graph name and description" },
  { label: "Appearance", href: "/admin/appearance", icon: Palette, description: "UI skin / theme" },
  { label: "Ontology", href: "/admin/ontology", icon: Network, description: "Edit schema types and edges" },
  { label: "Domains", href: "/admin/domains", icon: Boxes, description: "Organize and hide domains and types" },
  { label: "Audit", href: "/admin/audit", icon: Stethoscope, description: "Schema health diagnostics" },
  { label: "Schedule", href: "/admin/schedule", icon: CalendarClock, description: "Source polling cadence" },
  { label: "Janitors", href: "/admin/janitors", icon: Wrench, description: "Automated graph maintenance" },
  { label: "Activity", href: "/admin/activity", icon: Activity, description: "Recent runs and source activity" },
  { label: "Reviews", href: "/admin/reviews", icon: ClipboardList, description: "Moderation queue" },
]

export default function AdminOverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-heading font-semibold">Admin Console</h2>
        <p className="text-sm text-muted-foreground">
          Manage the graph, its schema, automation, and moderation.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CARDS.map((card) => {
          const Icon = card.icon
          return (
            <Link
              key={card.href}
              href={card.href}
              className="group flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{card.label}</p>
                <p className="text-xs text-muted-foreground">{card.description}</p>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
