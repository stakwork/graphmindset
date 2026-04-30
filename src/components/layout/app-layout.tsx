"use client"

import { useEffect, useState } from "react"
import { AppRail } from "./app-rail"
import { UnifiedPanel } from "./unified-panel"
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
  const hasResults = useGraphStore((s) => s.nodes.length > 0)
  const schemas = useSchemaStore((s) => s.schemas)
  const fetchSchemas = useSchemaStore((s) => s.fetchAll)

  const searchPanelOpen = hasResults

  useEffect(() => {
    if (schemas.length > 0) return
    if (isMocksEnabled()) {
      useSchemaStore.getState().setSchemas(SMALL_SCHEMAS)
    } else {
      fetchSchemas()
    }
  }, [schemas.length, fetchSchemas])

  // Auto-close other panels when search results appear.
  useEffect(() => {
    if (!searchPanelOpen) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cross-panel sync; refactor target is to move searchPanelOpen into the store and clear panels inside setSearchTerm
    if (sourcesOpen) setSourcesOpen(false)
    if (myContentOpen) setMyContentOpen(false)
  }, [searchPanelOpen, sourcesOpen, myContentOpen, setMyContentOpen])

  function closeSearchResults(): void {
    useAppStore.getState().setSearchTerm("")
    useGraphStore.getState().setGraphData([], [])
    useGraphStore.getState().setHoveredNode(null)
    useGraphStore.getState().setSidebarSelectedNode(null)
  }

  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden">
        <AppRail
          sourcesOpen={sourcesOpen}
          onToggleSources={() => {
            setSourcesOpen((o) => !o)
            setMyContentOpen(false)
          }}
          myContentOpen={myContentOpen}
          onToggleMyContent={() => {
            if (!myContentOpen) closeSearchResults()
            setMyContentOpen(!myContentOpen)
            setSourcesOpen(false)
          }}
        />

        <UnifiedPanel
          sourcesOpen={sourcesOpen}
          onCloseSources={() => setSourcesOpen(false)}
          myContentOpen={myContentOpen}
          onCloseMyContent={() => setMyContentOpen(false)}
          searchPanelOpen={searchPanelOpen}
          onCloseSearchResults={closeSearchResults}
        />

        <main className="h-full flex-1 min-w-0">
          <Universe />
        </main>
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
