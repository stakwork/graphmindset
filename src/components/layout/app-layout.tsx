"use client"

import { useState } from "react"
import { AppSidebar } from "./app-sidebar"
import { SourcesPanel } from "./sources-panel"
import { SearchResultsPanel } from "./search-results-panel"
import { SearchBar } from "@/components/search/search-bar"
import { Universe } from "@/components/universe"
import { SettingsModal } from "@/components/modals/settings-modal"
import { AddContentModal } from "@/components/modals/add-content-modal"
import { BudgetModal } from "@/components/modals/budget-modal"
import { useAppStore } from "@/stores/app-store"
import { useGraphStore } from "@/stores/graph-store"

export function AppLayout() {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const searchTerm = useAppStore((s) => s.searchTerm)
  const hasResults = useGraphStore((s) => s.nodes.length > 0)

  const searchPanelOpen = !!searchTerm && hasResults

  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden">
        <AppSidebar
          sourcesOpen={sourcesOpen}
          onToggleSources={() => setSourcesOpen((o) => !o)}
        />

        {/* Sources slide-out panel */}
        {sourcesOpen && (
          <SourcesPanel onClose={() => setSourcesOpen(false)} />
        )}

        {/* Search results slide-out panel */}
        {searchPanelOpen && !sourcesOpen && (
          <SearchResultsPanel
            onClose={() => {
              useAppStore.getState().setSearchTerm("")
              useGraphStore.getState().setGraphData([], [])
            }}
          />
        )}

        <div className="flex flex-1 flex-col min-w-0">
          {/* Top bar */}
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/50 bg-background/80 backdrop-blur-sm px-5">
            <SearchBar />
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[9px] font-mono text-muted-foreground/40 uppercase tracking-widest">
                GraphMindset
              </span>
            </div>
          </header>

          {/* Main viewport */}
          <main className="flex-1 overflow-hidden">
            <Universe />
          </main>
        </div>
      </div>

      {/* Modals — outside flex layout so they overlay properly */}
      <SettingsModal />
      <AddContentModal />
      <BudgetModal />
    </>
  )
}
