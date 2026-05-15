"use client"

import { useEffect } from "react"
import { LeftPane } from "./left-pane"
import { GraphPane } from "@/components/universe/graph-pane"
import { SettingsModal } from "@/components/modals/settings-modal"
import { AddContentModal } from "@/components/modals/add-content-modal"
import { BudgetModal } from "@/components/modals/budget-modal"
import { AddNodeModal } from "@/components/modals/add-node-modal"
import { MediaPlayer } from "@/components/player/media-player"
import { useSchemaStore } from "@/stores/schema-store"
import { useSidebarNeighborFetch } from "@/hooks/use-sidebar-neighbor-fetch"
import { useDeepLink } from "@/hooks/use-deep-link"
import { usePanelGraphSync } from "@/hooks/use-panel-graph-sync"
import { isMocksEnabled } from "@/lib/mock-data"
import { SMALL_SCHEMAS } from "@/app/ontology/mock-small"

export function AppLayout() {
  useDeepLink()
  useSidebarNeighborFetch()
  usePanelGraphSync()
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
      <div className="grid h-screen w-screen overflow-hidden grid-cols-[480px_minmax(0,1fr)]">
        <LeftPane />
        <GraphPane />
      </div>

      <SettingsModal />
      <AddContentModal />
      <AddNodeModal />
      <BudgetModal />
      <MediaPlayer />
    </>
  )
}
