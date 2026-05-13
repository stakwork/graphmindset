"use client"

import { useGraphStore } from "@/stores/graph-store"
import { useAppStore } from "@/stores/app-store"
import { useSchemaStore } from "@/stores/schema-store"
import { SearchBar } from "@/components/search/search-bar"
import { FeedView } from "@/components/feed/feed-view"
import { SourcesPanel } from "./sources-panel"
import { MyContentPanel } from "./my-content-panel"
import { NodePreviewPanel } from "./node-preview-panel"
import { cn } from "@/lib/utils"

type Mode = "preview" | "sources" | "mycontent" | "feed"

export function MainArea({
  sourcesOpen,
  onCloseSources,
  myContentOpen,
  onCloseMyContent,
}: {
  sourcesOpen: boolean
  onCloseSources: () => void
  myContentOpen: boolean
  onCloseMyContent: () => void
}) {
  const selectedNode = useGraphStore((s) => s.selectedNode)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)
  const setSidebarSelectedNode = useGraphStore((s) => s.setSidebarSelectedNode)
  const setHoveredNode = useGraphStore((s) => s.setHoveredNode)
  const schemas = useSchemaStore((s) => s.schemas)
  const searchTerm = useAppStore((s) => s.searchTerm)

  function closePreview() {
    setSelectedNode(null)
    setSidebarSelectedNode(null)
    setHoveredNode(null)
  }

  // Selected node wins over panel toggles — clicking a node is the strongest focus signal.
  function pickMode(): Mode {
    if (selectedNode) return "preview"
    if (sourcesOpen) return "sources"
    if (myContentOpen) return "mycontent"
    return "feed"
  }

  const mode = pickMode()
  const contextLabel = labelFor(mode, selectedNode?.node_type, searchTerm)

  return (
    <div className="relative h-full w-full flex flex-col bg-background noise-bg overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />

      <header className="relative z-20 border-b border-border/40 bg-background/85 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center gap-4">
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
            <NodePreviewPanel node={selectedNode} onBack={closePreview} schemas={schemas} />
          </CenteredPanel>
        )}
        {mode === "sources" && (
          <CenteredPanel>
            <SourcesPanel onClose={onCloseSources} />
          </CenteredPanel>
        )}
        {mode === "mycontent" && (
          <CenteredPanel>
            <MyContentPanel onClose={onCloseMyContent} />
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
  if (mode === "preview") return nodeType ?? "Node"
  return searchTerm ? `Search · ${searchTerm}` : "Latest"
}

function CenteredPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full w-full flex justify-center">
      <div className="w-full max-w-[680px] h-full border-x border-border/40 flex flex-col">
        {children}
      </div>
    </div>
  )
}
