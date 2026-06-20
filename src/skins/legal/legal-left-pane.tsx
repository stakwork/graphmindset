"use client"

import { useGraphStore } from "@/stores/graph-store"
import { useAppStore } from "@/stores/app-store"
import { useSchemaStore } from "@/stores/schema-store"
import { LegalCaseFilesFeed } from "./legal-case-files-feed"
import { SourcesPanel } from "@/components/layout/sources-panel"
import { MyContentPanel } from "@/components/layout/my-content-panel"
import { ClipsPanel } from "@/components/layout/clips-panel"
import { FollowingPanel } from "@/components/layout/following-panel"
import { NodePreviewPanel } from "@/components/layout/node-preview-panel"
import { AgentPanel } from "@/components/agent/agent-panel"
import { WorkflowsPanel } from "@/components/layout/workflows-panel"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"

type Mode = "preview" | "sources" | "mycontent" | "clips" | "following" | "agent" | "workflows" | "feed"

export function LegalLeftPane() {
  const router = useRouter()
  const selectedNode = useGraphStore((s) => s.selectedNode)
  const clearSelection = useGraphStore((s) => s.clearSelection)
  const returnTo = useGraphStore((s) => s.returnTo)
  const setReturnTo = useGraphStore((s) => s.setReturnTo)
  const sourcesOpen = useAppStore((s) => s.sourcesOpen)
  const myContentOpen = useAppStore((s) => s.myContentOpen)
  const clipsOpen = useAppStore((s) => s.clipsOpen)
  const followingOpen = useAppStore((s) => s.followingOpen)
  const agentOpen = useAppStore((s) => s.agentOpen)
  const workflowsOpen = useAppStore((s) => s.workflowsOpen)
  const setSourcesOpen = useAppStore((s) => s.setSourcesOpen)
  const setMyContentOpen = useAppStore((s) => s.setMyContentOpen)
  const setClipsOpen = useAppStore((s) => s.setClipsOpen)
  const setFollowingOpen = useAppStore((s) => s.setFollowingOpen)
  const setAgentOpen = useAppStore((s) => s.setAgentOpen)
  const setWorkflowsOpen = useAppStore((s) => s.setWorkflowsOpen)
  const schemas = useSchemaStore((s) => s.schemas)

  function handleBack() {
    const dest = returnTo
    setReturnTo(null)
    clearSelection()
    if (dest) router.push(dest)
  }

  function pickMode(): Mode {
    if (workflowsOpen) return "workflows"
    if (agentOpen) return "agent"
    if (sourcesOpen) return "sources"
    if (myContentOpen) return "mycontent"
    if (followingOpen) return "following"
    if (selectedNode) return "preview"
    if (clipsOpen) return "clips"
    return "feed"
  }

  const mode = pickMode()

  return (
    <aside className="relative h-full w-full flex flex-col border-r border-border/60 bg-background noise-bg overflow-hidden">
      {/* Gold gradient border accent (renders as gold from .skin-legal token override) */}
      <div className="absolute inset-y-0 -right-px w-px bg-gradient-to-b from-transparent via-primary/25 to-transparent pointer-events-none" />

      <div className="relative z-10 flex-1 min-h-0 overflow-hidden flex flex-col">
        {mode === "preview" && selectedNode && (
          <NodePreviewPanel node={selectedNode} onBack={handleBack} schemas={schemas} />
        )}
        {mode === "sources" && <SourcesPanel onClose={() => setSourcesOpen(false)} />}
        {mode === "mycontent" && <MyContentPanel onClose={() => setMyContentOpen(false)} />}
        {mode === "clips" && <ClipsPanel onClose={() => setClipsOpen(false)} />}
        {mode === "following" && <FollowingPanel onClose={() => setFollowingOpen(false)} />}
        {mode === "agent" && <AgentPanel onClose={() => setAgentOpen(false)} />}
        {mode === "workflows" && <WorkflowsPanel onClose={() => setWorkflowsOpen(false)} />}
        <div className={cn("h-full w-full", mode !== "feed" && "hidden")}>
          <LegalCaseFilesFeed />
        </div>
      </div>
    </aside>
  )
}
