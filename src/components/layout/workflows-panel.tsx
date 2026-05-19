"use client"

import { useEffect, useState } from "react"
import { Cpu, Loader2, X } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getWorkflowMarketplace, type WorkflowMarketplaceItem, type CronKind } from "@/lib/graph-api"
import { isMocksEnabled, MOCK_WORKFLOW_MARKETPLACE } from "@/lib/mock-data"
import { cn } from "@/lib/utils"

type FilterKind = "all" | CronKind

const FILTER_OPTIONS: { label: string; value: FilterKind }[] = [
  { label: "All", value: "all" },
  { label: "Ingestion", value: "source" },
  { label: "Janitor", value: "janitor" },
]

function kindBadgeLabel(kind: CronKind): string {
  return kind === "source" ? "Ingestion" : "Janitor"
}

function kindBadgeClass(kind: CronKind): string {
  return kind === "source"
    ? "bg-sky-500/15 text-sky-400 border border-sky-500/25"
    : "bg-violet-500/15 text-violet-400 border border-violet-500/25"
}

function WorkflowCard({ item }: { item: WorkflowMarketplaceItem }) {
  const label = item.label || item.source_type
  return (
    <div className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/20 px-3 py-2.5 hover:bg-muted/30 transition-colors">
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          item.enabled
            ? "bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]"
            : "bg-muted-foreground/30"
        )}
        aria-label={item.enabled ? "Enabled" : "Disabled"}
        data-testid={item.enabled ? "dot-enabled" : "dot-disabled"}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{label}</p>
        <p className="text-[10px] font-mono text-muted-foreground/70 mt-0.5 truncate">
          {item.source_type}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-mono font-medium",
          kindBadgeClass(item.kind)
        )}
      >
        {kindBadgeLabel(item.kind)}
      </span>
    </div>
  )
}

export function WorkflowsPanel({ onClose }: { onClose: () => void }) {
  const [workflows, setWorkflows] = useState<WorkflowMarketplaceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKind>("all")

  useEffect(() => {
    let cancelled = false

    async function fetchWorkflows() {
      setLoading(true)
      try {
        if (isMocksEnabled()) {
          if (!cancelled) setWorkflows(MOCK_WORKFLOW_MARKETPLACE)
        } else {
          const items = await getWorkflowMarketplace()
          if (!cancelled) setWorkflows(items)
        }
      } catch (err) {
        if (!cancelled) console.error("[workflows-panel] fetch failed:", err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchWorkflows()
    return () => { cancelled = true }
  }, [])

  const filtered = filter === "all"
    ? workflows
    : workflows.filter((w) => w.kind === filter)

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-4 py-3 border-b border-sidebar-border">
        <div>
          <h3 className="text-sm font-heading font-semibold tracking-wide text-sidebar-foreground">
            Workflow Marketplace
          </h3>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
            {loading ? "Loading…" : `${workflows.length} workflow${workflows.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Filter chips */}
      <div className="relative z-10 flex gap-1.5 px-4 py-2 border-b border-sidebar-border/50">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-mono transition-colors",
              filter === opt.value
                ? "bg-primary/15 text-primary border border-primary/30"
                : "bg-muted/30 text-muted-foreground border border-border/40 hover:bg-muted/50"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <ScrollArea className="relative z-10 flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-3">
            <Cpu className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {workflows.length === 0
                ? "No workflows configured yet"
                : "No workflows match this filter"}
            </p>
          </div>
        ) : (
          <div className="py-2 px-3 flex flex-col gap-1.5">
            {filtered.map((item) => (
              <WorkflowCard key={item.ref_id} item={item} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
