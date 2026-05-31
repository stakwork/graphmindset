/**
 * SSR-safe cookie utility replacing localStorage for sensitive auth data
 * (l402 LSAT token, Sphinx/WebLN signature).
 *
 * Cookies are written with Secure; SameSite=Strict; Path=/ to reduce XSS
 * exposure. All methods are no-ops during SSR (typeof window === "undefined").
 */
export const cookieStorage = {
  getItem(key: string): string | null {
    if (typeof window === "undefined") return null
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${encodeURIComponent(key)}=`))
    if (!match) return null
    return decodeURIComponent(match.split("=").slice(1).join("="))
  },

  setItem(key: string, value: string, days?: number): void {
    if (typeof window === "undefined") return
    let cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; Secure; SameSite=Strict; Path=/`
    if (days !== undefined) {
      const maxAge = days * 24 * 60 * 60
      cookie += `; Max-Age=${maxAge}`
    }
    document.cookie = cookie
  },

  removeItem(key: string): void {
    if (typeof window === "undefined") return
    document.cookie = `${encodeURIComponent(key)}=; Max-Age=0; Secure; SameSite=Strict; Path=/`
  },
}
