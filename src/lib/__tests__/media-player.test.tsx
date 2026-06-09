import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, act } from "@testing-library/react"
import React from "react"

// --- mock schema-store ---
vi.mock("@/stores/schema-store", () => ({
  useSchemaStore: vi.fn((selector: (s: { schemas: unknown[] }) => unknown) =>
    selector({ schemas: [] })
  ),
}))

// --- player store state ---
let playerState: {
  playingNode: Record<string, unknown> | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  host: null
  isExpanded: boolean
  pendingSeekTime: number | null
  setPlayingNode: ReturnType<typeof vi.fn>
  setIsPlaying: ReturnType<typeof vi.fn>
  setCurrentTime: ReturnType<typeof vi.fn>
  setDuration: ReturnType<typeof vi.fn>
  setVolume: ReturnType<typeof vi.fn>
  setHost: ReturnType<typeof vi.fn>
  setIsExpanded: ReturnType<typeof vi.fn>
  seekTo: ReturnType<typeof vi.fn>
  clearPendingSeek: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

const mockSetCurrentTime = vi.fn((val: number) => {
  playerState.currentTime = val
})
const mockSetDuration = vi.fn()
const mockSetIsPlaying = vi.fn()
const mockStop = vi.fn()

function makeNode(id: string, mediaUrl = "https://example.com/video.mp4") {
  return {
    ref_id: id,
    node_type: "Clip",
    properties: { media_url: mediaUrl },
  }
}

const mockClearPendingSeek = vi.fn()

function resetPlayerState(node: Record<string, unknown> | null = null) {
  playerState = {
    playingNode: node,
    isPlaying: !!node,
    currentTime: 0,
    duration: 120,
    volume: 0.8,
    host: null,
    isExpanded: false,
    pendingSeekTime: null,
    setPlayingNode: vi.fn(),
    setIsPlaying: mockSetIsPlaying,
    setCurrentTime: mockSetCurrentTime,
    setDuration: mockSetDuration,
    setVolume: vi.fn(),
    setHost: vi.fn(),
    setIsExpanded: vi.fn(),
    seekTo: vi.fn(),
    clearPendingSeek: mockClearPendingSeek,
    stop: mockStop,
  }
}

vi.mock("@/stores/player-store", () => ({
  usePlayerStore: vi.fn((selector?: (s: typeof playerState) => unknown) => {
    if (selector) return selector(playerState)
    return playerState
  }),
}))

// --- mock ResizeObserver ---
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

// --- mock HTMLMediaElement play/pause (jsdom stubs return undefined) ---
window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
window.HTMLMediaElement.prototype.pause = vi.fn()

// --- helpers ---
let videoCurrentTime = 0
let videoPlayCalled = false
let videoPauseCalled = false

function mockVideoElement() {
  return {
    get currentTime() {
      return videoCurrentTime
    },
    set currentTime(val: number) {
      videoCurrentTime = val
    },
    play: vi.fn(() => {
      videoPlayCalled = true
      return Promise.resolve()
    }),
    pause: vi.fn(() => {
      videoPauseCalled = true
    }),
    volume: 0.8,
    duration: 120,
  }
}

// We need to inject the mock into refs after render — we use a module-level ref holder
import { MediaPlayer } from "@/components/player/media-player"

describe("MediaPlayer", () => {
  beforeEach(() => {
    videoCurrentTime = 0
    videoPlayCalled = false
    videoPauseCalled = false
    mockSetCurrentTime.mockClear()
    mockSetDuration.mockClear()
    mockSetIsPlaying.mockClear()
  })

  it("seeks to 0 on mount when a playingNode is set", async () => {
    resetPlayerState(makeNode("clip-1"))

    const { usePlayerStore } = await import("@/stores/player-store")
    const mockStore = vi.mocked(usePlayerStore)
    mockStore.mockImplementation((selector?: (s: typeof playerState) => unknown) => {
      if (selector) return selector(playerState)
      return playerState
    })

    const { container } = render(<MediaPlayer />)
    const video = container.querySelector("video") as HTMLVideoElement & { currentTime: number }
    expect(video).not.toBeNull()

    // Simulate the browser leaving the video at a non-zero position
    Object.defineProperty(video, "currentTime", {
      get: () => videoCurrentTime,
      set: (val: number) => { videoCurrentTime = val },
      configurable: true,
    })
    video.dispatchEvent(new Event("loadedmetadata"))

    // The effect sets currentTime = 0
    expect(videoCurrentTime).toBe(0)
  })

  it("resets currentTime to 0 when switching to a new playingNode with same media_url", async () => {
    resetPlayerState(makeNode("clip-1", "https://example.com/shared.mp4"))

    const { usePlayerStore } = await import("@/stores/player-store")
    const mockStore = vi.mocked(usePlayerStore)
    mockStore.mockImplementation((selector?: (s: typeof playerState) => unknown) => {
      if (selector) return selector(playerState)
      return playerState
    })

    const { container, rerender } = render(<MediaPlayer />)
    const video = container.querySelector("video") as HTMLVideoElement

    Object.defineProperty(video, "currentTime", {
      get: () => videoCurrentTime,
      set: (val: number) => { videoCurrentTime = val },
      configurable: true,
    })

    // Simulate user watched some of clip-1
    videoCurrentTime = 30

    // Switch to clip-2 with same media_url
    act(() => {
      resetPlayerState(makeNode("clip-2", "https://example.com/shared.mp4"))
      mockStore.mockImplementation((selector?: (s: typeof playerState) => unknown) => {
        if (selector) return selector(playerState)
        return playerState
      })
    })

    rerender(<MediaPlayer />)

    expect(videoCurrentTime).toBe(0)
    expect(mockSetCurrentTime).toHaveBeenCalledWith(0)
  })

  it("corrects non-zero currentTime in handleLoadedMetadata (moov-atom-at-end case)", async () => {
    resetPlayerState(makeNode("clip-3"))

    const { usePlayerStore } = await import("@/stores/player-store")
    const mockStore = vi.mocked(usePlayerStore)
    mockStore.mockImplementation((selector?: (s: typeof playerState) => unknown) => {
      if (selector) return selector(playerState)
      return playerState
    })

    const { container } = render(<MediaPlayer />)
    const video = container.querySelector("video") as HTMLVideoElement

    // Simulate browser setting currentTime to 6 before metadata fires
    Object.defineProperty(video, "currentTime", {
      get: () => videoCurrentTime,
      set: (val: number) => { videoCurrentTime = val },
      configurable: true,
    })
    videoCurrentTime = 6
    Object.defineProperty(video, "duration", { get: () => 120, configurable: true })

    act(() => {
      video.dispatchEvent(new Event("loadedmetadata"))
    })

    expect(videoCurrentTime).toBe(0)
    expect(mockSetCurrentTime).toHaveBeenCalledWith(0)
  })

  it("seekTo sets media.currentTime and triggers play", async () => {
    // Start with no pending seek so the effect is a no-op on initial render
    resetPlayerState(makeNode("clip-seek"))
    playerState.pendingSeekTime = null

    const { usePlayerStore } = await import("@/stores/player-store")
    const mockStore = vi.mocked(usePlayerStore)
    mockStore.mockImplementation((selector?: (s: typeof playerState) => unknown) => {
      if (selector) return selector(playerState)
      return playerState
    })

    mockClearPendingSeek.mockClear()
    mockSetIsPlaying.mockClear()

    const { container, rerender } = render(<MediaPlayer />)
    const video = container.querySelector("video") as HTMLVideoElement

    // Intercept currentTime before triggering the seek effect
    Object.defineProperty(video, "currentTime", {
      get: () => videoCurrentTime,
      set: (val: number) => { videoCurrentTime = val },
      configurable: true,
    })

    // Now simulate seekTo(90) by updating pendingSeekTime and re-rendering
    act(() => {
      playerState.pendingSeekTime = 90
      mockStore.mockImplementation((selector?: (s: typeof playerState) => unknown) => {
        if (selector) return selector(playerState)
        return playerState
      })
    })
    rerender(<MediaPlayer />)

    expect(videoCurrentTime).toBe(90)
    expect(mockSetIsPlaying).toHaveBeenCalledWith(true)
    expect(mockClearPendingSeek).toHaveBeenCalled()
  })

  it("handleSeek sets media.currentTime to the correct ratio-derived value (regression guard)", async () => {
    resetPlayerState(makeNode("clip-4"))
    playerState.duration = 100

    const { usePlayerStore } = await import("@/stores/player-store")
    const mockStore = vi.mocked(usePlayerStore)
    mockStore.mockImplementation((selector?: (s: typeof playerState) => unknown) => {
      if (selector) return selector(playerState)
      return playerState
    })

    const { container } = render(<MediaPlayer />)
    const video = container.querySelector("video") as HTMLVideoElement

    Object.defineProperty(video, "currentTime", {
      get: () => videoCurrentTime,
      set: (val: number) => { videoCurrentTime = val },
      configurable: true,
    })

    // Find the progress bar div (has h-1 class)
    const progressBar = container.querySelector(".h-1.w-full.cursor-pointer") as HTMLDivElement
    expect(progressBar).not.toBeNull()

    // Mock getBoundingClientRect so ratio = 0.5 → currentTime = 50
    vi.spyOn(progressBar, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 200, width: 200, top: 0, bottom: 10, height: 10, x: 0, y: 0,
      toJSON: () => ({}),
    })

    act(() => {
      progressBar.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 100 })
      )
    })

    expect(videoCurrentTime).toBe(50)
    expect(mockSetCurrentTime).toHaveBeenCalledWith(50)
  })
})
