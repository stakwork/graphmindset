import { describe, it, expect } from "vitest"
import { fuzzyScore, computeMappings } from "@/lib/node-remap"
import type { SchemaAttribute } from "@/app/ontology/page"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function attr(key: string, required = false): SchemaAttribute {
  return { key, type: "string", required }
}

// ---------------------------------------------------------------------------
// fuzzyScore
// ---------------------------------------------------------------------------
describe("fuzzyScore", () => {
  it("returns 1.0 for identical strings", () => {
    expect(fuzzyScore("name", "name")).toBe(1.0)
  })

  it("returns 0.0 for empty first string", () => {
    expect(fuzzyScore("", "name")).toBe(0.0)
  })

  it("returns 0.0 for empty second string", () => {
    expect(fuzzyScore("name", "")).toBe(0.0)
  })

  it("returns 0.0 for both empty strings", () => {
    expect(fuzzyScore("", "")).toBe(0.0)
  })

  it("returns 1.0 for both single identical chars", () => {
    expect(fuzzyScore("a", "a")).toBe(1.0)
  })

  it("returns < 1.0 for clearly different short strings", () => {
    expect(fuzzyScore("abc", "xyz")).toBeLessThan(0.5)
  })

  it("scores 'title' vs 'episode_title' >= 0.6 (fuzzy threshold)", () => {
    expect(fuzzyScore("title", "episode_title")).toBeGreaterThanOrEqual(0.6)
  })

  it("scores 'name' vs 'full_name' >= 0.6", () => {
    expect(fuzzyScore("name", "full_name")).toBeGreaterThanOrEqual(0.6)
  })

  it("scores 'description' vs 'desc' — nearby but not exact", () => {
    // Just assert it returns a finite number in [0,1]
    const s = fuzzyScore("description", "desc")
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThanOrEqual(1)
  })

  it("scores completely unrelated strings below 0.6", () => {
    expect(fuzzyScore("weight", "episode_title")).toBeLessThan(0.6)
    expect(fuzzyScore("foo", "xyz")).toBeLessThan(0.6)
  })

  it("is symmetric", () => {
    const s1 = fuzzyScore("title", "episode_title")
    const s2 = fuzzyScore("episode_title", "title")
    expect(Math.abs(s1 - s2)).toBeLessThan(0.001)
  })
})

// ---------------------------------------------------------------------------
// computeMappings
// ---------------------------------------------------------------------------
describe("computeMappings", () => {
  it("places oldKey === newKey in exact bucket", () => {
    const old = [attr("name"), attr("description")]
    const next = [attr("name"), attr("summary")]
    const values = { name: "Bitcoin", description: "A currency" }

    const { exact, fuzzy, unmapped } = computeMappings(old, next, values)

    expect(exact).toHaveLength(1)
    expect(exact[0]).toMatchObject({ oldKey: "name", newKey: "name", value: "Bitcoin" })
    // description has no exact or fuzzy match with summary — goes to unmapped or fuzzy
    const allKeys = [...fuzzy.map(f => f.oldKey), ...unmapped.map(u => u.oldKey)]
    expect(allKeys).toContain("description")
  })

  it("places fuzzy-matched fields (score >= 0.6) in fuzzy bucket with correct score", () => {
    const old = [attr("title")]
    const next = [attr("episode_title")]
    const values = { title: "My Episode" }

    const { exact, fuzzy, unmapped } = computeMappings(old, next, values)

    expect(exact).toHaveLength(0)
    expect(fuzzy).toHaveLength(1)
    expect(fuzzy[0].oldKey).toBe("title")
    expect(fuzzy[0].newKey).toBe("episode_title")
    expect(fuzzy[0].score).toBeGreaterThanOrEqual(0.6)
    expect(fuzzy[0].value).toBe("My Episode")
    expect(unmapped).toHaveLength(0)
  })

  it("places unrelated fields (score < 0.6 for all new fields) in unmapped", () => {
    // "color" vs "publish_date" — no character or token overlap, scores 0.0
    const old = [attr("color")]
    const next = [attr("publish_date")]
    const values = { color: "some value" }

    const { exact, fuzzy, unmapped } = computeMappings(old, next, values)

    expect(exact).toHaveLength(0)
    expect(fuzzy).toHaveLength(0)
    expect(unmapped).toHaveLength(1)
    expect(unmapped[0]).toMatchObject({ oldKey: "color", value: "some value" })
  })

  it("deduplicates: a new-type field only appears in one bucket", () => {
    // Both 'title' and 'name' might fuzzily match 'episode_title',
    // but only the highest scorer should win
    const old = [attr("title"), attr("name")]
    const next = [attr("episode_title")]
    const values = { title: "Ep 1", name: "Show Name" }

    const { exact, fuzzy, unmapped } = computeMappings(old, next, values)

    // episode_title can only be claimed by one old field
    const claimedNew = [
      ...exact.map(e => e.newKey),
      ...fuzzy.map(f => f.newKey),
    ]
    const uniqueClaimedNew = new Set(claimedNew)
    expect(uniqueClaimedNew.size).toBe(claimedNew.length)

    // Total fields accounted for
    const totalOld = old.length
    const totalMapped = exact.length + fuzzy.length + unmapped.length
    expect(totalMapped).toBe(totalOld)
  })

  it("handles multiple exact matches simultaneously", () => {
    const old = [attr("name"), attr("description"), attr("url")]
    const next = [attr("name"), attr("description"), attr("url")]
    const values = { name: "A", description: "B", url: "https://x.com" }

    const { exact, fuzzy, unmapped } = computeMappings(old, next, values)

    expect(exact).toHaveLength(3)
    expect(fuzzy).toHaveLength(0)
    expect(unmapped).toHaveLength(0)
  })

  it("handles empty old fields", () => {
    const { exact, fuzzy, unmapped } = computeMappings([], [attr("name")], {})
    expect(exact).toHaveLength(0)
    expect(fuzzy).toHaveLength(0)
    expect(unmapped).toHaveLength(0)
  })

  it("handles empty new fields", () => {
    const old = [attr("name")]
    const { exact, fuzzy, unmapped } = computeMappings(old, [], { name: "Test" })
    expect(exact).toHaveLength(0)
    expect(fuzzy).toHaveLength(0)
    expect(unmapped).toHaveLength(1)
    expect(unmapped[0].oldKey).toBe("name")
  })

  it("preserves values from currentValues correctly", () => {
    const old = [attr("name")]
    const next = [attr("name")]
    const values = { name: "Bitcoin" }

    const { exact } = computeMappings(old, next, values)
    expect(exact[0].value).toBe("Bitcoin")
  })

  it("uses undefined value for fields missing from currentValues", () => {
    // "color" vs "publish_date" — no character or token overlap, scores 0.0
    const old = [attr("color")]
    const next = [attr("publish_date")]
    const values = {} // no entry for "color"

    const { unmapped } = computeMappings(old, next, values)
    expect(unmapped).toHaveLength(1)
    expect(unmapped[0].value).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// fieldsForSchema (imported from new location)
// ---------------------------------------------------------------------------
describe("fieldsForSchema (from node-schema-utils)", () => {
  // Import inline to verify the re-export works
  it("filters SYSTEM_ATTRIBUTES from own attributes", async () => {
    const { fieldsForSchema, SYSTEM_ATTRIBUTES } = await import("@/lib/node-schema-utils")

    const schema = {
      type: "Episode",
      parent: "Thing",
      node_key: "episode-name",
      attributes: [
        { key: "name", type: "string", required: true },
        { key: "weight", type: "float", required: false },
        { key: "owner_reference_id", type: "string", required: false },
      ],
      inherited_attributes: [],
    }

    const fields = fieldsForSchema(schema)
    const keys = fields.map(f => f.key)

    expect(keys).toContain("name")
    expect(keys).not.toContain("weight")
    expect(keys).not.toContain("owner_reference_id")

    // Verify SYSTEM_ATTRIBUTES contains expected entries
    expect(SYSTEM_ATTRIBUTES.has("weight")).toBe(true)
    expect(SYSTEM_ATTRIBUTES.has("is_muted")).toBe(true)
    expect(SYSTEM_ATTRIBUTES.has("unique_source_id")).toBe(true)
    expect(SYSTEM_ATTRIBUTES.has("owner_reference_id")).toBe(true)
    expect(SYSTEM_ATTRIBUTES.has("date_added_to_graph")).toBe(true)
  })

  it("merges own + inherited attributes with own taking precedence on duplicates", async () => {
    const { fieldsForSchema } = await import("@/lib/node-schema-utils")

    const schema = {
      type: "Episode",
      parent: "Thing",
      node_key: "episode-name",
      attributes: [
        { key: "name", type: "string", required: true },
        { key: "episode_title", type: "string", required: false },
      ],
      inherited_attributes: [
        { key: "name", type: "string", required: false }, // duplicate — should be deduplicated
        { key: "description", type: "string", required: false },
      ],
    }

    const fields = fieldsForSchema(schema)
    const keys = fields.map(f => f.key)

    // name appears only once
    expect(keys.filter(k => k === "name")).toHaveLength(1)
    // both own and unique inherited present
    expect(keys).toContain("episode_title")
    expect(keys).toContain("description")
    // own attributes come first
    expect(keys.indexOf("name")).toBeLessThan(keys.indexOf("description"))
  })

  it("handles schema with no inherited_attributes", async () => {
    const { fieldsForSchema } = await import("@/lib/node-schema-utils")

    const schema = {
      type: "Tag",
      parent: "Thing",
      node_key: "tag-name",
      attributes: [{ key: "name", type: "string", required: true }],
    }

    const fields = fieldsForSchema(schema)
    expect(fields).toHaveLength(1)
    expect(fields[0].key).toBe("name")
  })
})
