import { describe, it, expect, vi } from "vitest"
import { detectSourceType, SOURCE_TYPES } from "../source-detection"

// Mock fetch for RSS probe (checkIfRSS) - default to non-RSS
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
  headers: { get: () => "text/html" },
}))

describe("detectSourceType", () => {
  describe("YouTube Video URLs", () => {
    it("detects youtube.com/watch?v=… as YOUTUBE_VIDEO", async () => {
      expect(await detectSourceType("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(SOURCE_TYPES.YOUTUBE_VIDEO)
    })

    it("detects youtu.be/… as YOUTUBE_VIDEO", async () => {
      expect(await detectSourceType("https://youtu.be/dQw4w9WgXcQ")).toBe(SOURCE_TYPES.YOUTUBE_VIDEO)
    })
  })

  describe("YouTube Live URLs", () => {
    it("detects youtube.com/live/… as YOUTUBE_LIVE", async () => {
      expect(await detectSourceType("https://www.youtube.com/live/abc123XYZ")).toBe(SOURCE_TYPES.YOUTUBE_LIVE)
    })
  })

  describe("YouTube Shorts URLs", () => {
    it("detects youtube.com/shorts/… as YOUTUBE_SHORT", async () => {
      expect(await detectSourceType("https://www.youtube.com/shorts/abc123XYZ")).toBe(SOURCE_TYPES.YOUTUBE_SHORT)
    })
  })

  describe("YouTube Channel URLs (unchanged)", () => {
    it("detects youtube.com/@channel as YOUTUBE_CHANNEL", async () => {
      expect(await detectSourceType("https://www.youtube.com/@MrBeast")).toBe(SOURCE_TYPES.YOUTUBE_CHANNEL)
    })
  })

  describe("Link fallback (unchanged)", () => {
    it("detects twitter.com/i/spaces/… as LINK", async () => {
      expect(await detectSourceType("https://twitter.com/i/spaces/1eaKbrBxkEoxX")).toBe(SOURCE_TYPES.LINK)
    })

    it("detects MP3 URL as LINK", async () => {
      expect(await detectSourceType("https://example.com/podcast.mp3")).toBe(SOURCE_TYPES.LINK)
    })
  })
})
