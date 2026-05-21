"use client"

import { useEffect } from "react"
import { LeftPane } from "./left-pane"
import { GraphPane } from "@/components/universe/graph-pane"
import { SettingsModal } from "@/components/modals/settings-modal"
import { AddContentModal } from "@/components/modals/add-content-modal"
import { BudgetModal } from "@/components/modals/budget-modal"
import { AddNodeModal } from "@/components/modals/add-node-modal"
import { EditNodeModal } from "@/components/modals/edit-node-modal"
import { AddEdgeModal } from "@/components/modals/add-edge-modal"
import { MediaPlayer } from "@/components/player/media-player"
import { useDefaultLayout } from "react-resizable-panels"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
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
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: "graphmindset-main-layout" })
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
      <ResizablePanelGroup
        id="main-layout"
        orientation="horizontal"
        defaultLayout={defaultLayout ?? { "left-pane": 33, "right-pane": 67 }}
        onLayoutChanged={onLayoutChanged}
        className="h-screen w-screen overflow-hidden"
      >
        <ResizablePanel id="left-pane" defaultSize="33%" minSize="20%" maxSize="60%">
          <LeftPane />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="right-pane" defaultSize="67%" minSize="40%">
          <GraphPane />
        </ResizablePanel>
      </ResizablePanelGroup>

      <SettingsModal />
      <AddContentModal />
      <AddNodeModal />
      <EditNodeModal />
      <AddEdgeModal />
      <BudgetModal />
      <MediaPlayer />
    </>
  )
}
