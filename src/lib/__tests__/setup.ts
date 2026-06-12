import "@testing-library/jest-dom"

// Global IntersectionObserver stub — jsdom doesn't provide one.
// @base-ui ScrollArea uses new IntersectionObserver() internally, so we need
// a class that can be instantiated, not just a plain function mock.
class IntersectionObserverStub {
  private cb: (entries: IntersectionObserverEntry[]) => void
  constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
    this.cb = cb
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(globalThis, "IntersectionObserver", {
  writable: true,
  configurable: true,
  value: IntersectionObserverStub,
})
