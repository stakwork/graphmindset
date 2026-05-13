"use client"

import { useEffect } from "react"
import { AppRail } from "./app-rail"
import { MainArea } from "./main-area"
import { GraphFloater } from "@/components/universe/graph-floater"
import { SettingsModal } from "@/components/modals/settings-modal"
import { AddContentModal } from "@/components/modals/add-content-modal"
import { BudgetModal } from "@/components/modals/budget-modal"
import { AddNodeModal } from "@/components/modals/add-node-modal"
import { MediaPlayer } from "@/components/player/media-player"
import { useAppStore } from "@/stores/app-store"
import { useGraphStore } from "@/stores/graph-store"
import { useSchemaStore } from "@/stores/schema-store"
import { useSidebarNeighborFetch } from "@/hooks/use-sidebar-neighbor-fetch"
import { useDeepLink } from "@/hooks/use-deep-link"
import { isMocksEnabled } from "@/lib/mock-data"
import { SMALL_SCHEMAS } from "@/app/ontology/mock-small"

export function AppLayout() {
  useDeepLink()
  useSidebarNeighborFetch()
  const sourcesOpen = useAppStore((s) => s.sourcesOpen)
  const myContentOpen = useAppStore((s) => s.myContentOpen)
  const toggleSources = useAppStore((s) => s.toggleSources)
  const toggleMyContent = useAppStore((s) => s.toggleMyContent)
  const schemas = useSchemaStore((s) => s.schemas)
  const fetchSchemas = useSchemaStore((s) => s.fetchAll)

  useEffect(() => {
    if (schemas.length > 0) return
    if (isMocksEnabled()) {
      useSchemaStore.getState().setSchemas(SMALL_SCHEMAS)
    } else {
      fetchSchemas()
    }
  }, [schemas.length, fetchSchemas])

  // Opening a panel via the rail dismisses any open node preview — overlays
  // are mutually exclusive, even with the preview that lives in the graph store.
  function openPanel(toggle: () => void) {
    useGraphStore.getState().clearSelection()
    toggle()
  }

  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden">
        <AppRail
          sourcesOpen={sourcesOpen}
          onToggleSources={() => openPanel(toggleSources)}
          myContentOpen={myContentOpen}
          onToggleMyContent={() => openPanel(toggleMyContent)}
        />

        <main className="h-full flex-1 min-w-0">
          <MainArea />
        </main>
      </div>

      <GraphFloater />

      {/* Modals — outside flex layout so they overlay properly */}
      <SettingsModal />
      <AddContentModal />
      <AddNodeModal />
      <BudgetModal />
      <MediaPlayer />
    </>
  )
}
