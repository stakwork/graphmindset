"use client"

import { useGraphStore } from "@/stores/graph-store"
import { useAppStore } from "@/stores/app-store"
import { useSchemaStore } from "@/stores/schema-store"
import { FeedView } from "@/components/feed/feed-view"
import { SourcesPanel } from "./sources-panel"
import { MyContentPanel } from "./my-content-panel"
import { ClipsPanel } from "./clips-panel"
import { FollowingPanel } from "./following-panel"
import { NodePreviewPanel } from "./node-preview-panel"
import { AgentPanel } from "@/components/agent/agent-panel"

type Mode = "preview" | "sources" | "mycontent" | "clips" | "following" | "agent" | "feed"

export function LeftPane() {
  const selectedNode = useGraphStore((s) => s.selectedNode)
  const clearSelection = useGraphStore((s) => s.clearSelection)
  const sourcesOpen = useAppStore((s) => s.sourcesOpen)
  const myContentOpen = useAppStore((s) => s.myContentOpen)
  const clipsOpen = useAppStore((s) => s.clipsOpen)
  const followingOpen = useAppStore((s) => s.followingOpen)
  const agentOpen = useAppStore((s) => s.agentOpen)
  const setSourcesOpen = useAppStore((s) => s.setSourcesOpen)
  const setMyContentOpen = useAppStore((s) => s.setMyContentOpen)
  const setClipsOpen = useAppStore((s) => s.setClipsOpen)
  const setFollowingOpen = useAppStore((s) => s.setFollowingOpen)
  const setAgentOpen = useAppStore((s) => s.setAgentOpen)
  const schemas = useSchemaStore((s) => s.schemas)

  function pickMode(): Mode {
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
    <aside className="relative h-full w-full flex flex-col border-r border-border/60 bg-background/60 noise-bg overflow-hidden">
      <div className="absolute inset-y-0 -right-px w-px bg-gradient-to-b from-transparent via-primary/25 to-transparent pointer-events-none" />

      <div className="relative z-10 flex-1 min-h-0 overflow-hidden flex flex-col">
        {mode === "preview" && selectedNode && (
          <NodePreviewPanel node={selectedNode} onBack={clearSelection} schemas={schemas} />
        )}
        {mode === "sources" && <SourcesPanel onClose={() => setSourcesOpen(false)} />}
        {mode === "mycontent" && <MyContentPanel onClose={() => setMyContentOpen(false)} />}
        {mode === "clips" && <ClipsPanel onClose={() => setClipsOpen(false)} />}
        {mode === "following" && <FollowingPanel onClose={() => setFollowingOpen(false)} />}
        {mode === "agent" && <AgentPanel onClose={() => setAgentOpen(false)} />}
        {mode === "feed" && <FeedView />}
      </div>
    </aside>
  )
}
