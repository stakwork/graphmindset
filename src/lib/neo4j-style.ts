// Visual vocabulary of the Neo4j Browser graph view: the default label palette
// (fill / border / caption color), relationship styling, and caption wrapping
// inside a fixed-radius circle.

export interface LabelColor {
  fill: string
  border: string
  text: string
}

// Neo4j Browser's default label colors, in assignment order.
export const NEO4J_PALETTE: LabelColor[] = [
  { fill: "#FFE081", border: "#9AA1AC", text: "#2A2C34" },
  { fill: "#C990C0", border: "#b261a5", text: "#FFFFFF" },
  { fill: "#F79767", border: "#f36924", text: "#FFFFFF" },
  { fill: "#57C7E3", border: "#23b3d7", text: "#2A2C34" },
  { fill: "#F16667", border: "#eb2728", text: "#FFFFFF" },
  { fill: "#D9C8AE", border: "#c0a378", text: "#2A2C34" },
  { fill: "#8DCC93", border: "#5db665", text: "#2A2C34" },
  { fill: "#ECB5C9", border: "#da7298", text: "#2A2C34" },
  { fill: "#4C8EDA", border: "#2870c2", text: "#FFFFFF" },
  { fill: "#FFC454", border: "#d7a013", text: "#2A2C34" },
  { fill: "#DA7194", border: "#cc3c6c", text: "#FFFFFF" },
  { fill: "#569480", border: "#447666", text: "#FFFFFF" },
]

export const NEO4J_NODE_RADIUS = 25
export const NEO4J_CAPTION_FONT_SIZE = 10
export const NEO4J_CAPTION_LINE_HEIGHT = 11
export const NEO4J_CAPTION_MAX_LINES = 3
export const NEO4J_RELATIONSHIP_COLOR = "#A5ABB6"
export const NEO4J_RELATIONSHIP_FONT_SIZE = 8
// Neo4j Browser's grey, for nodes outside any colored label group.
export const NEO4J_NEUTRAL_COLOR: LabelColor = { fill: "#A5ABB6", border: "#9AA1AC", text: "#2A2C34" }

// Labels get a palette slot in first-seen order and keep it for the session,
// exactly like Neo4j Browser (colors stay stable across queries).
const labelSlots = new Map<string, number>()

export function colorForLabel(label: string): LabelColor {
  const key = label || "Unknown"
  let slot = labelSlots.get(key)
  if (slot === undefined) {
    slot = labelSlots.size % NEO4J_PALETTE.length
    labelSlots.set(key, slot)
  }
  return NEO4J_PALETTE[slot]
}

/** Test hook: forget every label → slot assignment. */
export function resetLabelColors() {
  labelSlots.clear()
}

// Approximate glyph width for the caption font (system sans at 10px).
const CHAR_WIDTH_RATIO = 0.56

function chordWidth(radius: number, lineIndex: number, lineCount: number): number {
  const y = (lineIndex - (lineCount - 1) / 2) * NEO4J_CAPTION_LINE_HEIGHT
  // Glyphs sit around the baseline; cap height is ~0.7em, so half of that.
  const halfText = NEO4J_CAPTION_FONT_SIZE * 0.36
  const edge = Math.abs(y) + halfText
  if (edge >= radius) return 0
  return 2 * Math.sqrt(radius * radius - edge * edge)
}

function fitChars(width: number, fontSize: number): number {
  return Math.max(1, Math.floor(width / (fontSize * CHAR_WIDTH_RATIO)))
}

/**
 * Split a caption into lines that fit inside a circle of `radius`, the way
 * Neo4j Browser does: greedy word wrap, hard-breaking overlong words, at most
 * `maxLines` lines, an ellipsis on the last line when text is cut.
 */
export function wrapCaption(
  text: string,
  radius = NEO4J_NODE_RADIUS,
  maxLines = NEO4J_CAPTION_MAX_LINES,
  fontSize = NEO4J_CAPTION_FONT_SIZE
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [""]

  for (let lineCount = 1; lineCount <= maxLines; lineCount++) {
    const limits = Array.from({ length: lineCount }, (_, i) =>
      fitChars(chordWidth(radius, i, lineCount), fontSize)
    )
    const lines = layout(words, limits)
    if (lines) return lines
  }

  // Doesn't fit even at maxLines: lay out with maxLines and truncate the tail.
  const limits = Array.from({ length: maxLines }, (_, i) =>
    fitChars(chordWidth(radius, i, maxLines), fontSize)
  )
  const lines = layout(words, limits, true)!
  const last = maxLines - 1
  const cap = Math.max(1, limits[last] - 1)
  lines[last] = lines[last].slice(0, cap).replace(/\s+$/, "") + "…"
  return lines
}

// Greedy fill; returns null when the words overflow the given lines (unless
// `truncate`, in which case surplus words are dropped).
function layout(words: string[], limits: number[], truncate = false): string[] | null {
  const lines: string[] = []
  let current = ""
  let li = 0
  const queue = [...words]
  while (queue.length > 0) {
    if (li >= limits.length) {
      if (truncate) break
      return null
    }
    const limit = limits[li]
    const word = queue[0]
    if (current.length === 0) {
      if (word.length <= limit) {
        current = word
        queue.shift()
      } else {
        // Hard-break a word that can't fit on any line.
        current = word.slice(0, limit)
        queue[0] = word.slice(limit)
      }
      continue
    }
    if (current.length + 1 + word.length <= limit) {
      current += " " + word
      queue.shift()
      continue
    }
    lines.push(current)
    current = ""
    li++
  }
  if (current.length > 0) {
    if (li >= limits.length) {
      if (!truncate) return null
      lines[lines.length - 1] = lines[lines.length - 1] ?? current
    } else {
      lines.push(current)
    }
  }
  return lines
}
