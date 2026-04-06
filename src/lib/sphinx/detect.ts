export function isSphinx(): boolean {
  if (typeof window === "undefined") return false
  return sessionStorage.getItem("isSphinx") === "true"
}

export function isAndroid(): boolean {
  if (typeof window === "undefined") return false
  return window.navigator.userAgent.includes("Android")
}
