import type React from "react"
import { LeftPane } from "@/components/layout/left-pane"
import { GraphPane } from "@/components/universe/graph-pane"
import { LegalLeftPane } from "./legal/legal-left-pane"
import { LegalGraphPane } from "./legal/legal-graph-pane"

export type SkinId = "default" | "legal"

export interface Skin {
  id: SkinId
  label: string
  description: string
  LeftPane: React.ComponentType
  GraphPane: React.ComponentType
  themeClass?: string
}

export const SKINS: Record<SkinId, Skin> = {
  default: {
    id: "default",
    label: "Default",
    description: "The standard GraphMindset experience.",
    LeftPane,
    GraphPane,
  },
  legal: {
    id: "legal",
    label: "Legal",
    description:
      "Purpose-built for legal knowledge networks — navy/gold palette with document-card layout.",
    LeftPane: LegalLeftPane,
    GraphPane: LegalGraphPane,
    themeClass: "skin-legal",
  },
}
