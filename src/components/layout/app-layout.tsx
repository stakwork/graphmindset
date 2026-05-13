"use client"

import { useEffect, useState } from "react"
import { AppRail } from "./app-rail"
import { MainArea } from "./main-area"
import { GraphFloater } from "@/components/universe/graph-floater"
import { SettingsModal } from "@/components/modals/settings-modal"
import { AddContentModal } from "@/components/modals/add-content-modal"
import { BudgetModal } from "@/components/modals/budget-modal"
import { AddNodeModal } from "@/components/modals/add-node-modal"
import { MediaPlayer } from "@/components/player/media-player"
import { useAppStore } from "@/stores/app-store"
import { useSchemaStore } from "@/stores/schema-store"
import { useSidebarNeighborFetch } from "@/hooks/use-sidebar-neighbor-fetch"
import { isMocksEnabled } from "@/lib/mock-data"
import { SMALL_SCHEMAS } from "@/app/ontology/mock-small"

export function AppLayout() {
  useSidebarNeighborFetch()
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const myContentOpen = useAppStore((s) => s.myContentOpen)
  const setMyContentOpen = useAppStore((s) => s.setMyContentOpen)
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
            setMyContentOpen(!myContentOpen)
            setSourcesOpen(false)
          }}
        />

        <main className="h-full flex-1 min-w-0">
          <MainArea
            sourcesOpen={sourcesOpen}
            onCloseSources={() => setSourcesOpen(false)}
            myContentOpen={myContentOpen}
            onCloseMyContent={() => setMyContentOpen(false)}
          />
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
