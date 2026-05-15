"use client"

import { Menu } from "lucide-react"
import { useGraphStore } from "@/stores/graph-store"
import { useAppStore } from "@/stores/app-store"
import { useSchemaStore } from "@/stores/schema-store"
import { SearchBar } from "@/components/search/search-bar"
import { FeedView } from "@/components/feed/feed-view"
import { SourcesPanel } from "./sources-panel"
import { MyContentPanel } from "./my-content-panel"
import { ClipsPanel } from "./clips-panel"
import { FollowingPanel } from "./following-panel"
import { NodePreviewPanel } from "./node-preview-panel"
import { cn } from "@/lib/utils"

type Mode = "preview" | "sources" | "mycontent" | "clips" | "following" | "feed"

export function MainArea({ onOpenMobileNav }: { onOpenMobileNav?: () => void }) {
  const selectedNode = useGraphStore((s) => s.selectedNode)
  const clearSelection = useGraphStore((s) => s.clearSelection)
  const sourcesOpen = useAppStore((s) => s.sourcesOpen)
  const myContentOpen = useAppStore((s) => s.myContentOpen)
  const clipsOpen = useAppStore((s) => s.clipsOpen)
  const followingOpen = useAppStore((s) => s.followingOpen)
  const setSourcesOpen = useAppStore((s) => s.setSourcesOpen)
  const setMyContentOpen = useAppStore((s) => s.setMyContentOpen)
  const setClipsOpen = useAppStore((s) => s.setClipsOpen)
  const setFollowingOpen = useAppStore((s) => s.setFollowingOpen)
  const schemas = useSchemaStore((s) => s.schemas)
  const searchTerm = useAppStore((s) => s.searchTerm)

  function pickMode(): Mode {
    if (sourcesOpen) return "sources"
    if (myContentOpen) return "mycontent"
    if (clipsOpen) return "clips"
    if (followingOpen) return "following"
    if (selectedNode) return "preview"
    return "feed"
  }

  const mode = pickMode()
  const contextLabel = labelFor(mode, selectedNode?.node_type, searchTerm)

  return (
    <div className="relative h-full w-full flex flex-col bg-background noise-bg overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />

      <header className="relative z-20 border-b border-border/40 bg-background/85 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-3 sm:px-6 py-3 flex items-center gap-4">
          {onOpenMobileNav && (
            <button
              type="button"
              aria-label="Open navigation"
              onClick={onOpenMobileNav}
              className="md:hidden flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <SearchBar />
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground shrink-0">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                mode === "preview" ? "bg-primary shadow-[0_0_8px_oklch(0.72_0.14_200/0.8)]" : "bg-muted-foreground/40"
              )}
            />
            <span className="hidden sm:inline">{contextLabel}</span>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex-1 min-h-0 overflow-hidden">
        {mode === "preview" && selectedNode && (
          <CenteredPanel>
            <NodePreviewPanel node={selectedNode} onBack={clearSelection} schemas={schemas} />
          </CenteredPanel>
        )}
        {mode === "sources" && (
          <CenteredPanel>
            <SourcesPanel onClose={() => setSourcesOpen(false)} />
          </CenteredPanel>
        )}
        {mode === "mycontent" && (
          <CenteredPanel>
            <MyContentPanel onClose={() => setMyContentOpen(false)} />
          </CenteredPanel>
        )}
        {mode === "clips" && (
          <CenteredPanel>
            <ClipsPanel onClose={() => setClipsOpen(false)} />
          </CenteredPanel>
        )}
        {mode === "following" && (
          <CenteredPanel>
            <FollowingPanel onClose={() => setFollowingOpen(false)} />
          </CenteredPanel>
        )}
        {mode === "feed" && <FeedView />}
      </div>
    </div>
  )
}

function labelFor(mode: Mode, nodeType: string | undefined, searchTerm: string): string {
  if (mode === "sources") return "Sources"
  if (mode === "mycontent") return "My Content"
  if (mode === "clips") return "Latest Clips"
  if (mode === "following") return "following"
  if (mode === "preview") return nodeType ?? "Node"
  return searchTerm ? `Search · ${searchTerm}` : "Latest"
}

function CenteredPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full w-full flex justify-center">
      <div className="w-full max-w-[680px] h-full sm:border-x border-border/40 flex flex-col">
        {children}
      </div>
    </div>
  )
}
