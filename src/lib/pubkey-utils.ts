/**
 * Parse a compound pubkey string of the form
 * "pubkey_routeHintPubkey_shortChannelId" into separate fields.
 *
 * If the input is a plain 66-char hex pubkey (no route hint),
 * only `pubkey` is returned.
 */
export function parsePubkeyWithHint(raw: string): { pubkey: string; route_hint?: string } {
  const parts = raw.split("_")
  if (parts.length === 3 && parts[0].length === 66) {
    return { pubkey: parts[0], route_hint: `${parts[1]}_${parts[2]}` }
  }
  return { pubkey: raw }
}
