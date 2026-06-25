"use client"

import { useEffect } from "react"
import { AddModal } from "@/components/modals/add-modal"
import { BudgetModal } from "@/components/modals/budget-modal"
import { EditNodeModal } from "@/components/modals/edit-node-modal"
import { MediaPlayer } from "@/components/player/media-player"
import { useDefaultLayout } from "react-resizable-panels"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { useSchemaStore } from "@/stores/schema-store"
import { useAppStore } from "@/stores/app-store"
import { useNeighborFetch } from "@/hooks/use-neighbor-fetch"
import { useDeepLink } from "@/hooks/use-deep-link"
import { usePanelGraphSync } from "@/hooks/use-panel-graph-sync"
import { isMocksEnabled } from "@/lib/mock-data"
import { SMALL_SCHEMAS } from "@/app/ontology/mock-small"
import { SKINS } from "@/skins/index"
import { cn } from "@/lib/utils"

export function AppLayout() {
  useDeepLink()
  useNeighborFetch()
  usePanelGraphSync()
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: "graphmindset-main-layout" })
  const schemas = useSchemaStore((s) => s.schemas)
  const fetchSchemas = useSchemaStore((s) => s.fetchAll)
  const activeSkin = useAppStore((s) => s.activeSkin)
  const skin = SKINS[activeSkin] ?? SKINS.default

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
      <div className={cn("h-screen w-screen overflow-hidden", skin.themeClass)}>
        <ResizablePanelGroup
          id="main-layout"
          orientation="horizontal"
          defaultLayout={defaultLayout ?? { "left-pane": 33, "right-pane": 67 }}
          onLayoutChanged={onLayoutChanged}
          className="h-full w-full"
        >
          <ResizablePanel id="left-pane" defaultSize="33%" minSize="20%" maxSize="60%">
            <skin.LeftPane />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel id="right-pane" defaultSize="67%" minSize="40%">
            <skin.GraphPane />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <AddModal />
      <EditNodeModal />
      <BudgetModal />
      <MediaPlayer />
    </>
  )
}
