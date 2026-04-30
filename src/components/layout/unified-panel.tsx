"use client"

import { Search } from "lucide-react"
import { SearchBar } from "@/components/search/search-bar"
import { SearchResultsPanel } from "./search-results-panel"
import { SourcesPanel } from "./sources-panel"
import { MyContentPanel } from "./my-content-panel"

export function UnifiedPanel({
  sourcesOpen,
  onCloseSources,
  myContentOpen,
  onCloseMyContent,
  searchPanelOpen,
  onCloseSearchResults,
}: {
  sourcesOpen: boolean
  onCloseSources: () => void
  myContentOpen: boolean
  onCloseMyContent: () => void
  searchPanelOpen: boolean
  onCloseSearchResults: () => void
}) {
  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col overflow-hidden bg-sidebar border-r border-sidebar-border noise-bg">
      <div className="relative z-10 px-3 py-3 border-b border-sidebar-border">
        <SearchBar />
      </div>

      {sourcesOpen ? (
        <SourcesPanel onClose={onCloseSources} />
      ) : myContentOpen ? (
        <MyContentPanel onClose={onCloseMyContent} />
      ) : searchPanelOpen ? (
        <SearchResultsPanel onClose={onCloseSearchResults} />
      ) : (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <Search className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">Search the graph</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Or browse sources and content from the rail
          </p>
        </div>
      )}
    </aside>
  )
}
