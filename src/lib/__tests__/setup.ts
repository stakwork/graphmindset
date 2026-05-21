import "@testing-library/jest-dom"

// jsdom does not implement Element.prototype.scrollTo — stub it so components
// that call element.scrollTo({ top: 0 }) don't throw in tests.
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => undefined
}
