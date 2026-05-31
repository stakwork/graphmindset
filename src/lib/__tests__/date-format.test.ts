import { describe, it, expect, vi, afterEach } from "vitest"
import { parseTimestamp, formatDateAbsolute, formatDateRelative } from "@/lib/date-format"

// A known Unix-seconds timestamp: 2026-04-30T00:00:00.000Z
const EPOCH_SECONDS_INT = 1777507200
const EPOCH_SECONDS_FLOAT = 1777507200.123
const EPOCH_MS = 1777507200000
const ISO_STRING = "2026-04-30T00:00:00.000Z"

// Expected absolute output for the above timestamp
const EXPECTED_ABSOLUTE = "APR 30, 2026"

afterEach(() => {
  vi.useRealTimers()
})

describe("parseTimestamp", () => {
  it("returns correct date for epoch seconds int", () => {
    const d = parseTimestamp(EPOCH_SECONDS_INT)
    expect(d).toBeInstanceOf(Date)
    expect(d!.getTime()).toBe(EPOCH_MS)
  })

  it("returns correct date for epoch seconds float", () => {
    const d = parseTimestamp(EPOCH_SECONDS_FLOAT)
    expect(d).toBeInstanceOf(Date)
    // Float seconds → ms, may have sub-ms drift; within 1 second of expected
    expect(Math.abs(d!.getTime() - EPOCH_MS)).toBeLessThan(1000)
  })

  it("returns correct date for epoch milliseconds", () => {
    const d = parseTimestamp(EPOCH_MS)
    expect(d).toBeInstanceOf(Date)
    expect(d!.getTime()).toBe(EPOCH_MS)
  })

  it("returns correct date for numeric string of seconds", () => {
    const d = parseTimestamp("1777507200")
    expect(d).toBeInstanceOf(Date)
    expect(d!.getTime()).toBe(EPOCH_MS)
  })

  it("returns correct date for ISO string", () => {
    const d = parseTimestamp(ISO_STRING)
    expect(d).toBeInstanceOf(Date)
    expect(d!.getTime()).toBe(EPOCH_MS)
  })

  it("returns the same date for a Date object", () => {
    const input = new Date(EPOCH_MS)
    const d = parseTimestamp(input)
    expect(d).toBeInstanceOf(Date)
    expect(d!.getTime()).toBe(EPOCH_MS)
  })

  it("returns null for null", () => {
    expect(parseTimestamp(null)).toBeNull()
  })

  it("returns null for undefined", () => {
    expect(parseTimestamp(undefined)).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(parseTimestamp("")).toBeNull()
  })

  it("returns null for NaN", () => {
    expect(parseTimestamp(NaN)).toBeNull()
  })

  it("returns null for invalid date string", () => {
    expect(parseTimestamp("not-a-date")).toBeNull()
  })

  it("returns null for Infinity", () => {
    expect(parseTimestamp(Infinity)).toBeNull()
  })
})

describe("formatDateAbsolute", () => {
  it("formats epoch seconds int to uppercase date string", () => {
    expect(formatDateAbsolute(EPOCH_SECONDS_INT)).toBe(EXPECTED_ABSOLUTE)
  })

  it("formats epoch seconds float", () => {
    expect(formatDateAbsolute(EPOCH_SECONDS_FLOAT)).toBe(EXPECTED_ABSOLUTE)
  })

  it("formats epoch milliseconds", () => {
    expect(formatDateAbsolute(EPOCH_MS)).toBe(EXPECTED_ABSOLUTE)
  })

  it("formats numeric string of seconds", () => {
    expect(formatDateAbsolute("1777507200")).toBe(EXPECTED_ABSOLUTE)
  })

  it("formats ISO string", () => {
    expect(formatDateAbsolute(ISO_STRING)).toBe(EXPECTED_ABSOLUTE)
  })

  it("formats Date object", () => {
    expect(formatDateAbsolute(new Date(EPOCH_MS))).toBe(EXPECTED_ABSOLUTE)
  })

  it("returns null for null", () => {
    expect(formatDateAbsolute(null)).toBeNull()
  })

  it("returns null for undefined", () => {
    expect(formatDateAbsolute(undefined)).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(formatDateAbsolute("")).toBeNull()
  })

  it("returns null for NaN", () => {
    expect(formatDateAbsolute(NaN)).toBeNull()
  })
})

describe("formatDateRelative", () => {
  it("returns correct relative time for a timestamp 2 days ago", () => {
    // Fix 'now' to 2026-05-02T00:00:00.000Z (2 days after EPOCH_SECONDS_INT)
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-02T00:00:00.000Z"))
    const result = formatDateRelative(EPOCH_SECONDS_INT)
    expect(result).toContain("2 days ago")
  })

  it("returns fallback string for null input", () => {
    expect(formatDateRelative(null, "Never run")).toBe("Never run")
  })

  it("returns fallback string for undefined input", () => {
    expect(formatDateRelative(undefined, "Never run")).toBe("Never run")
  })

  it("returns fallback string for empty string", () => {
    expect(formatDateRelative("", "Never run")).toBe("Never run")
  })

  it("returns fallback string for NaN", () => {
    expect(formatDateRelative(NaN, "Never run")).toBe("Never run")
  })

  it("returns default empty fallback when no fallback specified and input invalid", () => {
    expect(formatDateRelative(null)).toBe("")
  })

  it("returns relative string for epoch ms", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-02T00:00:00.000Z"))
    const result = formatDateRelative(EPOCH_MS)
    expect(result).toContain("2 days ago")
  })

  it("returns relative string for ISO string", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-02T00:00:00.000Z"))
    const result = formatDateRelative(ISO_STRING)
    expect(result).toContain("2 days ago")
  })
})
