import { describe, it, expect, beforeEach } from "vitest"
import { useAppStore } from "@/stores/app-store"

function resetStore() {
  useAppStore.setState({
    sourcesOpen: false,
    myContentOpen: false,
    clipsOpen: false,
    followingOpen: false,
  })
}

describe("app-store — followingOpen", () => {
  beforeEach(resetStore)

  it("followingOpen defaults to false", () => {
    expect(useAppStore.getState().followingOpen).toBe(false)
  })

  it("setFollowingOpen(true) opens following and closes other panels", () => {
    useAppStore.setState({ sourcesOpen: true, myContentOpen: true, clipsOpen: true })
    useAppStore.getState().setFollowingOpen(true)
    const s = useAppStore.getState()
    expect(s.followingOpen).toBe(true)
    expect(s.sourcesOpen).toBe(false)
    expect(s.myContentOpen).toBe(false)
    expect(s.clipsOpen).toBe(false)
  })

  it("setFollowingOpen(false) closes following", () => {
    useAppStore.setState({ followingOpen: true })
    useAppStore.getState().setFollowingOpen(false)
    expect(useAppStore.getState().followingOpen).toBe(false)
  })

  it("toggleFollowing opens following and closes other panels", () => {
    useAppStore.setState({ sourcesOpen: true, myContentOpen: true, clipsOpen: true, followingOpen: false })
    useAppStore.getState().toggleFollowing()
    const s = useAppStore.getState()
    expect(s.followingOpen).toBe(true)
    expect(s.sourcesOpen).toBe(false)
    expect(s.myContentOpen).toBe(false)
    expect(s.clipsOpen).toBe(false)
  })

  it("toggleFollowing closes following when already open", () => {
    useAppStore.setState({ followingOpen: true })
    useAppStore.getState().toggleFollowing()
    expect(useAppStore.getState().followingOpen).toBe(false)
  })

  it("closeAllPanels also closes followingOpen", () => {
    useAppStore.setState({ followingOpen: true, sourcesOpen: true, myContentOpen: true, clipsOpen: true })
    useAppStore.getState().closeAllPanels()
    const s = useAppStore.getState()
    expect(s.followingOpen).toBe(false)
    expect(s.sourcesOpen).toBe(false)
    expect(s.myContentOpen).toBe(false)
    expect(s.clipsOpen).toBe(false)
  })

  it("toggleMyContent closes followingOpen", () => {
    useAppStore.setState({ followingOpen: true })
    useAppStore.getState().toggleMyContent()
    expect(useAppStore.getState().followingOpen).toBe(false)
    expect(useAppStore.getState().myContentOpen).toBe(true)
  })

  it("toggleSources closes followingOpen", () => {
    useAppStore.setState({ followingOpen: true })
    useAppStore.getState().toggleSources()
    expect(useAppStore.getState().followingOpen).toBe(false)
    expect(useAppStore.getState().sourcesOpen).toBe(true)
  })

  it("setClipsOpen(true) closes followingOpen", () => {
    useAppStore.setState({ followingOpen: true })
    useAppStore.getState().setClipsOpen(true)
    expect(useAppStore.getState().followingOpen).toBe(false)
    expect(useAppStore.getState().clipsOpen).toBe(true)
  })
})

describe("app-store — bumpMyContentRefresh", () => {
  beforeEach(() => {
    useAppStore.setState({ myContentRefreshKey: 0 })
  })

  it("myContentRefreshKey defaults to 0", () => {
    expect(useAppStore.getState().myContentRefreshKey).toBe(0)
  })

  it("bumpMyContentRefresh increments myContentRefreshKey by 1", () => {
    useAppStore.getState().bumpMyContentRefresh()
    expect(useAppStore.getState().myContentRefreshKey).toBe(1)
  })

  it("bumpMyContentRefresh increments cumulatively on multiple calls", () => {
    useAppStore.getState().bumpMyContentRefresh()
    useAppStore.getState().bumpMyContentRefresh()
    useAppStore.getState().bumpMyContentRefresh()
    expect(useAppStore.getState().myContentRefreshKey).toBe(3)
  })
})
