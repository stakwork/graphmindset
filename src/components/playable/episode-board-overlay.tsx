"use client"

import { useBoardStore } from "@/stores/board-store"
import { PlayableExplorer } from "./playable-explorer"

/** Fullscreen overlay hosting the episode board on top of the 3D graph.
 *  Mounted globally in AppLayout; opened via useBoardStore.openBoard. */
export function EpisodeBoardOverlay() {
  const episodeRefId = useBoardStore((s) => s.episodeRefId)
  const closeBoard = useBoardStore((s) => s.closeBoard)
  if (!episodeRefId) return null
  return (
    <div className="fixed inset-0 z-50 bg-background">
      <PlayableExplorer episodeRefId={episodeRefId} onClose={closeBoard} />
    </div>
  )
}
