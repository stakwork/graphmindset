export function buildSphinxDeepLink(refId: string): string {
  const webUrl = `${window.location.origin}/?id=${refId}`
  return `sphinx.chat://?action=webapp&url=${encodeURIComponent(webUrl)}`
}
