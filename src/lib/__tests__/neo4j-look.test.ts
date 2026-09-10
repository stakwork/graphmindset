/**
 * Neo4j-look building blocks:
 * - wrapCaption fits text inside the node circle, ellipsizes overflow
 * - colorForLabel hands out stable palette slots in first-seen order
 * - ForceSimulation separates overlapping nodes, respects pins, and cools
 */
import { describe, it, expect, beforeEach } from "vitest"
import {
  wrapCaption,
  colorForLabel,
  resetLabelColors,
  NEO4J_PALETTE,
  NEO4J_CAPTION_MAX_LINES,
} from "@/lib/neo4j-style"
import { ForceSimulation, precomputeTicksFor, type SimNode } from "@/lib/force-layout"

function node(x: number, y: number, r = 25): SimNode {
  return { x, y, vx: 0, vy: 0, fx: null, fy: null, r }
}

describe("wrapCaption", () => {
  it("keeps a short caption on one line", () => {
    expect(wrapCaption("Alice")).toEqual(["Alice"])
  })

  it("wraps on word boundaries within the line budget", () => {
    const lines = wrapCaption("Bitcoin Core Meetup")
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.length).toBeLessThanOrEqual(NEO4J_CAPTION_MAX_LINES)
    expect(lines.join(" ")).toBe("Bitcoin Core Meetup")
  })

  it("never exceeds the max line count and ellipsizes the overflow", () => {
    const lines = wrapCaption("A very long episode title that cannot possibly fit inside a small circle")
    expect(lines.length).toBe(NEO4J_CAPTION_MAX_LINES)
    expect(lines[lines.length - 1].endsWith("…")).toBe(true)
  })

  it("hard-breaks a single overlong word", () => {
    const lines = wrapCaption("abcdefghijklmnopqrstuvwxyz")
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(12)
  })
})

describe("colorForLabel", () => {
  beforeEach(() => resetLabelColors())

  it("assigns palette slots in first-seen order and keeps them stable", () => {
    expect(colorForLabel("Person")).toBe(NEO4J_PALETTE[0])
    expect(colorForLabel("Episode")).toBe(NEO4J_PALETTE[1])
    expect(colorForLabel("Person")).toBe(NEO4J_PALETTE[0])
  })

  it("wraps around when there are more labels than colors", () => {
    for (let i = 0; i < NEO4J_PALETTE.length; i++) colorForLabel(`L${i}`)
    expect(colorForLabel("Overflow")).toBe(NEO4J_PALETTE[0])
  })
})

describe("ForceSimulation", () => {
  it("pushes coincident nodes apart and cools down", () => {
    const nodes = [node(0, 0), node(0, 0), node(0, 0)]
    const sim = new ForceSimulation(nodes, [])
    expect(sim.active).toBe(true)
    sim.precompute(300)
    expect(sim.active).toBe(false)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)
        expect(d).toBeGreaterThan(50)
      }
    }
  })

  it("pulls linked nodes toward the link distance", () => {
    const nodes = [node(-400, 0), node(400, 0)]
    const sim = new ForceSimulation(nodes, [{ source: 0, target: 1 }])
    sim.precompute(300)
    const d = Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y)
    expect(d).toBeLessThan(400)
    expect(d).toBeGreaterThan(50)
  })

  it("keeps a pinned node exactly where it is", () => {
    const pinned = node(10, 20)
    pinned.fx = 10
    pinned.fy = 20
    const nodes = [pinned, node(12, 22), node(30, 5)]
    const sim = new ForceSimulation(nodes, [{ source: 0, target: 1 }])
    sim.precompute(200)
    expect(pinned.x).toBe(10)
    expect(pinned.y).toBe(20)
  })

  it("anchored nodes stay put while a neighbor is dragged away", () => {
    const anchored = node(0, 0)
    anchored.anchorX = 0
    anchored.anchorY = 0
    const dragged = node(60, 0)
    const sim = new ForceSimulation([anchored, dragged], [{ source: 0, target: 1 }])
    sim.alphaTarget = 0.1
    sim.alpha = 0.1
    for (let i = 0; i < 60; i++) {
      dragged.fx = 60 + i * 5
      dragged.fy = 0
      sim.tick()
    }
    // Nudges toward the dragged neighbor (Neo4j feel) but stays near its anchor
    // instead of following a 300px drag.
    const drift = Math.hypot(anchored.x, anchored.y)
    expect(drift).toBeGreaterThan(0)
    expect(drift).toBeLessThan(40)
  })

  it("reheat makes a cooled simulation active again", () => {
    const sim = new ForceSimulation([node(0, 0)], [])
    sim.precompute(300)
    expect(sim.active).toBe(false)
    sim.reheat(0.5)
    expect(sim.active).toBe(true)
  })

  it("scales the precompute budget down for large graphs", () => {
    expect(precomputeTicksFor(50)).toBeGreaterThan(precomputeTicksFor(500))
    expect(precomputeTicksFor(2000)).toBeGreaterThan(0)
  })
})
