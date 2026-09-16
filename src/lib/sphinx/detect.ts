export function isSphinx(): boolean {
  if (typeof window === "undefined") return false
  return sessionStorage.getItem("isSphinx") === "true"
}

export function isAndroid(): boolean {
  if (typeof window === "undefined") return false
  return window.navigator.userAgent.includes("Android")
}

/**
 * Safari and every WKWebView (the macOS app shell) report Apple as the
 * vendor; Chromium and Firefox do not. More reliable than sniffing the user
 * agent, which a macOS WKWebView often ships without "Safari"/"Version".
 */
export function isWebKit(): boolean {
  if (typeof window === "undefined") return false
  return window.navigator.vendor === "Apple Computer, Inc."
}
