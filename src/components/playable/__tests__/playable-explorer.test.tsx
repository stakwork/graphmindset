import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PlayableExplorer } from "../playable-explorer"
import {
  getChapters,
  getEntitiesByType,
  getClaimRelations,
  getChapterMentions,
  getTypeCounts,
  setBoardData,
} from "@/lib/board-dataset"
import { computeBoardLayout } from "../board-layout"
import { loadFixture } from "./fixture"

beforeEach(() => {
  loadFixture()
})

describe("PlayableExplorer (board view)", () => {
  it("lays out the full board: episode, chapters, clips and proximity entities", () => {
    const layout = computeBoardLayout()
    expect(layout.episode).not.toBeNull()
    expect(layout.chapters).toHaveLength(getChapters().length)
    expect(layout.clips.length).toBeGreaterThan(0)

    // every entity got a chip anchored inside the chapter strip's x-span
    const entityCount = [...getEntitiesByType().values()].flat().length
    expect(layout.entities).toHaveLength(entityCount)
    const first = layout.chapters[0].card
    const last = layout.chapters[layout.chapters.length - 1].card
    for (const e of layout.entities) {
      expect(e.card.x).toBeGreaterThanOrEqual(first.x - 1)
      expect(e.card.x + e.card.w).toBeLessThanOrEqual(last.x + last.w + 1)
      // chips sit in the band above the chapter strip
      expect(e.card.y + e.card.h).toBeLessThanOrEqual(layout.chapterBusY)
    }

    // claims stack under a valid chapter card
    expect(layout.claims.length).toBe(21)
    const chapterIds = new Set(layout.chapters.map((c) => c.card.id))
    for (const c of layout.claims) expect(chapterIds.has(c.chapterId)).toBe(true)

    // claim relations pulled from the DB stay within the pulled claim set
    const rel = getClaimRelations()
    expect(rel.supports.length).toBe(10)
    expect(rel.contradicts.length).toBe(2)
    expect(rel.madeBy.length).toBe(21)

    // chapter→entity mention edges link chapters to nodes already on the board
    const mentions = getChapterMentions()
    expect(mentions.length).toBe(40)
    for (const e of mentions) {
      expect(chapterIds.has(e.source)).toBe(true)
    }
  })

  it("renders the type legend and chapter cards", () => {
    render(<PlayableExplorer />)
    expect(screen.getByText("Topic")).toBeInTheDocument()
    expect(screen.getByText("Person")).toBeInTheDocument()
    expect(screen.getByText(/chapters/)).toBeInTheDocument()
  })

  it("opens the detail panel on node click and closes on Escape", () => {
    render(<PlayableExplorer />)
    // click a chapter card (index badge "00" belongs to first chapter)
    const chapterBadge = screen.getByText("00")
    fireEvent.click(chapterBadge.closest("button")!)
    // detail panel exposes the chapter's source link
    expect(screen.getByText("Source")).toBeInTheDocument()
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByText("Source")).not.toBeInTheDocument()
  })

  it("swaps the active dataset and can restore the fixture", () => {
    const fixtureChapterCount = getChapters().length
    try {
      setBoardData(
        [{ ref_id: "ep-x", node_type: "Episode", properties: { episode_title: "X" } }],
        [],
        "ep-x"
      )
      expect(getChapters()).toHaveLength(0)
      expect(getTypeCounts()).toEqual([["Episode", 1]])
    } finally {
      loadFixture()
    }
    expect(getChapters()).toHaveLength(fixtureChapterCount)
  })
})
