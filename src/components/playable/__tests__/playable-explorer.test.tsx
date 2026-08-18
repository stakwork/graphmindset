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
import { computeBoardLayout, type CardPlacement } from "../board-layout"
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

describe("entity band on a short episode", () => {
  /** One chapter, ten entities — the shape that collapsed the band into a
   *  single overlapping column when chip x was clamped to the chapter strip. */
  function loadShortEpisode(entityCount: number) {
    const nodes = [
      { ref_id: "ep-1", node_type: "Episode", properties: { episode_title: "Short" } },
      { ref_id: "ch-1", node_type: "Chapter", properties: { name: "Only chapter" } },
      ...Array.from({ length: entityCount }, (_, i) => ({
        ref_id: `t-${i}`,
        node_type: "Topic",
        properties: { name: `Topic ${i}` },
      })),
    ]
    const edges = [
      { ref_id: "e-ch", edge_type: "HAS", source: "ep-1", target: "ch-1", properties: { index: 0 } },
      ...Array.from({ length: entityCount }, (_, i) => ({
        ref_id: `e-m-${i}`,
        edge_type: "MENTIONS",
        source: "ch-1",
        target: `t-${i}`,
        properties: {},
      })),
    ]
    setBoardData(nodes, edges, "ep-1")
  }

  function overlaps(a: CardPlacement, b: CardPlacement) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  }

  it("spreads chips across columns instead of one per row", () => {
    try {
      loadShortEpisode(10)
      const layout = computeBoardLayout()
      expect(layout.entities).toHaveLength(10)

      // a real grid: several chips share a row, so the band stays short
      const perRow = new Map<number, number>()
      for (const e of layout.entities) {
        perRow.set(e.card.y, (perRow.get(e.card.y) ?? 0) + 1)
      }
      expect(Math.max(...perRow.values())).toBeGreaterThanOrEqual(3)
      expect(perRow.size).toBeLessThanOrEqual(4)

      // and the band still clears the chapter bus below it
      for (const e of layout.entities) {
        expect(e.card.y + e.card.h).toBeLessThanOrEqual(layout.chapterBusY)
      }
    } finally {
      loadFixture()
    }
  })

  it("never draws one chip on top of another", () => {
    try {
      for (const n of [1, 3, 6, 10, 25]) {
        loadShortEpisode(n)
        const cards = computeBoardLayout().entities.map((e) => e.card)
        expect(cards).toHaveLength(n)
        for (let i = 0; i < cards.length; i++) {
          for (let j = i + 1; j < cards.length; j++) {
            expect(overlaps(cards[i], cards[j])).toBe(false)
          }
        }
      }
    } finally {
      loadFixture()
    }
  })
})
