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

  describe("RSS Feed URLs", () => {
    describe("Static regex matches (no network call)", () => {
      it("detects feed.xml URLs as RSS", async () => {
        expect(await detectSourceType("https://huggingface.co/blog/feed.xml")).toBe(SOURCE_TYPES.RSS)
      })

      it("detects atom.xml URLs as RSS", async () => {
        expect(await detectSourceType("https://example.com/atom.xml")).toBe(SOURCE_TYPES.RSS)
      })

      it("detects index.xml URLs as RSS", async () => {
        expect(await detectSourceType("https://example.com/index.xml")).toBe(SOURCE_TYPES.RSS)
      })

      it("detects /feed/ path as RSS", async () => {
        expect(await detectSourceType("https://example.com/blog/feed/")).toBe(SOURCE_TYPES.RSS)
      })

      it("detects /rss/ path as RSS", async () => {
        expect(await detectSourceType("https://example.com/rss/")).toBe(SOURCE_TYPES.RSS)
      })
    })

    describe("Dynamic content-type detection", () => {
      it("detects application/atom+xml response as RSS", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
          headers: { get: () => "application/atom+xml" },
        }))
        expect(await detectSourceType("https://example.com/somefeed")).toBe(SOURCE_TYPES.RSS)
      })

      it("detects text/xml response as RSS", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
          headers: { get: () => "text/xml" },
        }))
        expect(await detectSourceType("https://example.com/somefeed")).toBe(SOURCE_TYPES.RSS)
      })

      it("detects application/xml response as RSS", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
          headers: { get: () => "application/xml" },
        }))
        expect(await detectSourceType("https://example.com/somefeed")).toBe(SOURCE_TYPES.RSS)
      })

      it("detects application/rdf+xml response as RSS", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
          headers: { get: () => "application/rdf+xml" },
        }))
        expect(await detectSourceType("https://example.com/somefeed")).toBe(SOURCE_TYPES.RSS)
      })

      it("falls back to WEB_PAGE for text/html response (regression guard)", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
          headers: { get: () => "text/html" },
        }))
        expect(await detectSourceType("https://example.com/somepage")).toBe(SOURCE_TYPES.WEB_PAGE)
      })
    })
  })
})
