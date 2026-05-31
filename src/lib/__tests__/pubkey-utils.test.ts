import { describe, it, expect } from "vitest"
import { parsePubkeyWithHint } from "../pubkey-utils"

const PLAIN_PUBKEY = "03" + "a".repeat(64) // 66 chars
const ROUTE_HINT_PUBKEY = "02" + "b".repeat(64) // 66 chars
const SHORT_CHANNEL_ID = "529771110x12x0"
const COMPOUND = `${PLAIN_PUBKEY}_${ROUTE_HINT_PUBKEY}_${SHORT_CHANNEL_ID}`

describe("parsePubkeyWithHint", () => {
  it("returns plain pubkey unchanged with no route_hint", () => {
    const result = parsePubkeyWithHint(PLAIN_PUBKEY)
    expect(result).toEqual({ pubkey: PLAIN_PUBKEY })
    expect(result.route_hint).toBeUndefined()
  })

  it("splits compound pubkey into pubkey and route_hint", () => {
    const result = parsePubkeyWithHint(COMPOUND)
    expect(result.pubkey).toBe(PLAIN_PUBKEY)
    expect(result.route_hint).toBe(`${ROUTE_HINT_PUBKEY}_${SHORT_CHANNEL_ID}`)
  })

  it("returns malformed string as-is with no route_hint", () => {
    const malformed = "notapubkey_foo"
    const result = parsePubkeyWithHint(malformed)
    expect(result).toEqual({ pubkey: malformed })
    expect(result.route_hint).toBeUndefined()
  })

  it("returns raw string with no route_hint when only two parts but first is not 66 chars", () => {
    const twoPartShort = "shortkey_034bcc"
    const result = parsePubkeyWithHint(twoPartShort)
    expect(result).toEqual({ pubkey: twoPartShort })
    expect(result.route_hint).toBeUndefined()
  })

  it("returns raw string when four or more parts are present", () => {
    const fourParts = `${PLAIN_PUBKEY}_a_b_c`
    const result = parsePubkeyWithHint(fourParts)
    expect(result).toEqual({ pubkey: fourParts })
    expect(result.route_hint).toBeUndefined()
  })
})
