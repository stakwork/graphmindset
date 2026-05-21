import type { RadarSourceType, JanitorSourceType } from "@/lib/graph-api"
import type { LucideIcon } from "lucide-react"
import { AtSign, Video, Rss, Hash, Sparkles, Layers, ShieldCheck } from "lucide-react"

export interface WorkflowTypeMeta {
  icon: LucideIcon
  label: string
  tone: string // Tailwind color group, e.g. "sky", "red", "violet"
}

export const WORKFLOW_TYPE_META: Record<RadarSourceType | JanitorSourceType, WorkflowTypeMeta> = {
  twitter_handle:  { icon: AtSign,      label: "Twitter Handle",  tone: "sky"     },
  youtube_channel: { icon: Video,       label: "YouTube Channel", tone: "red"     },
  rss:             { icon: Rss,         label: "RSS Feed",        tone: "orange"  },
  topic:           { icon: Hash,        label: "Topic",           tone: "amber"   },
  deduplication:   { icon: Layers,      label: "Deduplication",   tone: "violet"  },
  content_review:  { icon: ShieldCheck, label: "Content Review",  tone: "emerald" },
  topic_review:    { icon: Sparkles,    label: "Topic Review",    tone: "fuchsia" },
  orphan_node:     { icon: Layers,      label: "Orphan Node",     tone: "slate"   },
}

// Static tone → Tailwind class mapping to avoid Tailwind purge issues
export const TONE_CLASSES: Record<string, string> = {
  sky:     "bg-sky-500/10 text-sky-400 border-sky-500/20",
  red:     "bg-red-500/10 text-red-400 border-red-500/20",
  orange:  "bg-orange-500/10 text-orange-400 border-orange-500/20",
  amber:   "bg-amber-500/10 text-amber-400 border-amber-500/20",
  violet:  "bg-violet-500/10 text-violet-400 border-violet-500/20",
  emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  fuchsia: "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20",
  slate:   "bg-slate-500/10 text-slate-400 border-slate-500/20",
}

// Returns item.label if set, otherwise the human-friendly label from meta
export function getWorkflowDisplayName(item: {
  label?: string
  source_type: RadarSourceType | JanitorSourceType
}): string {
  return item.label ?? WORKFLOW_TYPE_META[item.source_type]?.label ?? item.source_type
}
