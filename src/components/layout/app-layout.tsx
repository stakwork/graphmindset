"use client"

import { useEffect, useState } from "react"
import { AppSidebar } from "./app-sidebar"
import { SourcesPanel } from "./sources-panel"
import { SearchResultsPanel } from "./search-results-panel"
import { MyContentPanel } from "./my-content-panel"
import { SearchBar } from "@/components/search/search-bar"
import { Universe } from "@/components/universe"
import { SettingsModal } from "@/components/modals/settings-modal"
import { AddContentModal } from "@/components/modals/add-content-modal"
import { BudgetModal } from "@/components/modals/budget-modal"
import { AddTopicModal } from "@/components/modals/add-topic-modal"
import { MediaPlayer } from "@/components/player/media-player"
import { useAppStore } from "@/stores/app-store"
import { useGraphStore } from "@/stores/graph-store"
import { useSchemaStore } from "@/stores/schema-store"
import { useSidebarNeighborFetch } from "@/hooks/use-sidebar-neighbor-fetch"
import { isMocksEnabled } from "@/lib/mock-data"
import { SMALL_SCHEMAS } from "@/app/ontology/mock-small"

export function AppLayout() {
  useSidebarNeighborFetch()
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const myContentOpen = useAppStore((s) => s.myContentOpen)
  const setMyContentOpen = useAppStore((s) => s.setMyContentOpen)
  const searchTerm = useAppStore((s) => s.searchTerm)
  const hasResults = useGraphStore((s) => s.nodes.length > 0)
  const schemas = useSchemaStore((s) => s.schemas)
  const fetchSchemas = useSchemaStore((s) => s.fetchAll)

  const searchPanelOpen = !!searchTerm && hasResults

  // Schemas power display-name resolution (title_key / index) for search
  // results and any other node chrome — load once on mount if not already
  // populated (e.g. by the ontology page).
  useEffect(() => {
    if (schemas.length > 0) return
    if (isMocksEnabled()) {
      useSchemaStore.getState().setSchemas(SMALL_SCHEMAS)
    } else {
      fetchSchemas()
    }
  }, [schemas.length, fetchSchemas])

  // Auto-close other panels when search results appear. The app-store setter
  // takes a plain boolean (not a functional updater), so we can't identity-
  // guard this the React-compiler-friendly way — a cleanup PR could move
  // searchPanelOpen into the store and clear panels inside setSearchTerm.
  useEffect(() => {
    if (!searchPanelOpen) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cross-panel sync; refactor target is to move searchPanelOpen into the store and clear panels inside setSearchTerm
    if (sourcesOpen) setSourcesOpen(false)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cross-store sync; app-store setter is plain boolean so no identity guard
    if (myContentOpen) setMyContentOpen(false)
  }, [searchPanelOpen, sourcesOpen, myContentOpen, setMyContentOpen])

  function closeSearchResults(): void {
    useAppStore.getState().setSearchTerm("")
    useGraphStore.getState().setGraphData([], [])
    useGraphStore.getState().setHoveredNode(null)
    useGraphStore.getState().setSidebarSelectedNode(null)
  }

  const panelOverlay = "absolute left-0 top-0 z-10 h-full"

  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden">
        <AppSidebar
          sourcesOpen={sourcesOpen}
          onToggleSources={() => { setSourcesOpen((o) => !o); setMyContentOpen(false) }}
          myContentOpen={myContentOpen}
          onToggleMyContent={() => {
            if (!myContentOpen) closeSearchResults()
            setMyContentOpen(!myContentOpen)
            setSourcesOpen(false)
          }}
        />

        <div className="relative flex flex-1 flex-col min-w-0">
          {/* Top bar */}
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/50 bg-background/80 backdrop-blur-sm px-5">
            <SearchBar />
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[9px] font-mono text-muted-foreground/40 uppercase tracking-widest">
                GraphMindset
              </span>
            </div>
          </header>

          {/* Content area — panels sit beside the graph, not over it */}
          <div className="relative flex flex-1 overflow-hidden">
            {sourcesOpen && (
              <div className="shrink-0 h-full">
                <SourcesPanel onClose={() => setSourcesOpen(false)} />
              </div>
            )}

            {myContentOpen && (
              <div className="shrink-0 h-full">
                <MyContentPanel onClose={() => setMyContentOpen(false)} />
              </div>
            )}

            {searchPanelOpen && (
              <div className="shrink-0 h-full">
                <SearchResultsPanel onClose={closeSearchResults} />
              </div>
            )}

            <main className="h-full flex-1 min-w-0">
              <Universe />
            </main>
          </div>
        </div>
      </div>

      {/* Modals — outside flex layout so they overlay properly */}
      <SettingsModal />
      <AddContentModal />
      <AddTopicModal />
      <BudgetModal />
      <MediaPlayer />
    </>
  )
}
