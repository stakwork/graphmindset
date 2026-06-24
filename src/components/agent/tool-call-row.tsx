"use client"

import { Search, FileText, GitFork, CheckCircle2, Loader2, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ToolCallEvent } from "@/lib/agent-api"

const TOOL_META: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; label: string; color: string }
> = {
  graph_search: {
    icon: Search,
    label: "Search",
    color: "text-sky-400",
  },
  graph_node: {
    icon: FileText,
    label: "Fetch Node",
    color: "text-violet-400",
  },
  graph_neighbors: {
    icon: GitFork,
    label: "Explore",
    color: "text-emerald-400",
  },
}

function summariseParams(tool: string, params: Record<string, unknown>): string {
  if (tool === "graph_search") {
    const q = params.q ?? params.query ?? ""
    const type = params.type ? ` [${params.type}]` : ""
    return `"${q}"${type}`
  }
  if (tool === "graph_node") {
    return String(params.ref_id ?? params.id ?? "")
  }
  if (tool === "graph_neighbors") {
    return String(params.ref_id ?? params.id ?? "")
  }
  return JSON.stringify(params).slice(0, 60)
}

interface ToolCallRowProps {
  event: ToolCallEvent
}

export function ToolCallRow({ event }: ToolCallRowProps) {
  const meta = TOOL_META[event.tool] ?? {
    icon: Search,
    label: event.tool,
    color: "text-muted-foreground",
  }
  const Icon = meta.icon
  const summary = summariseParams(event.tool, event.params)
  const inFlight = event.status === "in-flight"
  const hasError = event.status === "error"

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs",
        "bg-muted/30 border border-border/40 my-1"
      )}
    >
      {/* Tool icon */}
      <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.color)} />

      {/* Label */}
      <span className="font-medium text-foreground/70 shrink-0">{meta.label}</span>

      {/* Params summary */}
      {summary && (
        <span className="text-muted-foreground truncate min-w-0">{summary}</span>
      )}

      {/* Result count */}
      {event.resultCount !== undefined && event.status === "done" && (
        <span className="ml-auto shrink-0 text-muted-foreground/60">
          {event.resultCount} result{event.resultCount !== 1 ? "s" : ""}
        </span>
      )}

      {/* Status indicator */}
      <span className="ml-auto shrink-0">
        {inFlight && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/60" />
        )}
        {!inFlight && !hasError && (
          <CheckCircle2 className="h-3 w-3 text-emerald-400/80" />
        )}
        {hasError && (
          <AlertCircle className="h-3 w-3 text-destructive/80" />
        )}
      </span>
    </div>
  )
}
