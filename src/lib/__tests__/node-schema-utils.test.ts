import { describe, it, expect } from "vitest"
import {
  humanizeFieldKey,
  fieldTypeHint,
  categorizeField,
  fieldsForSchema,
  OPTIONAL_GROUP_ORDER,
} from "@/lib/node-schema-utils"
import type { SchemaNode } from "@/lib/schema-types"

describe("humanizeFieldKey", () => {
  it("title-cases snake_case keys", () => {
    expect(humanizeFieldKey("source_link")).toBe("Source link")
    expect(humanizeFieldKey("english_translation")).toBe("English translation")
  })
  it("splits camelCase", () => {
    expect(humanizeFieldKey("dateAddedToGraph")).toBe("Date added to graph")
  })
  it("handles single words and empties", () => {
    expect(humanizeFieldKey("name")).toBe("Name")
    expect(humanizeFieldKey("")).toBe("")
  })
})

describe("fieldTypeHint", () => {
  it("normalizes backend types to short hints", () => {
    expect(fieldTypeHint("integer")).toBe("int")
    expect(fieldTypeHint("number")).toBe("float")
    expect(fieldTypeHint("date")).toBe("datetime")
    expect(fieldTypeHint("boolean")).toBe("bool")
    expect(fieldTypeHint("string")).toBe("string")
    expect(fieldTypeHint("")).toBe("string")
  })
})

describe("categorizeField", () => {
  // Mirrors the design's groupings for the example Clip / Claim schemas.
  it("buckets scoring attributes into signal", () => {
    expect(categorizeField("sentiment_score", "float")).toBe("signal")
    expect(categorizeField("boost", "int")).toBe("signal")
    expect(categorizeField("num_boost", "int")).toBe("signal")
    expect(categorizeField("confidence", "float")).toBe("signal")
    expect(categorizeField("reliability", "float")).toBe("signal")
    expect(categorizeField("influence", "float")).toBe("signal")
  })
  it("buckets provenance/bookkeeping attributes into meta", () => {
    expect(categorizeField("language", "string")).toBe("meta")
    expect(categorizeField("date", "datetime")).toBe("meta")
    expect(categorizeField("pub_key", "string")).toBe("meta")
    expect(categorizeField("duration", "string")).toBe("meta")
    expect(categorizeField("followers", "int")).toBe("meta")
    expect(categorizeField("keywords", "string")).toBe("meta")
  })
  it("buckets remaining string attributes into content", () => {
    expect(categorizeField("english_translation", "string")).toBe("content")
    expect(categorizeField("link", "string")).toBe("content")
    expect(categorizeField("thumbnail", "string")).toBe("content")
    expect(categorizeField("description", "string")).toBe("content")
    expect(categorizeField("stance", "string")).toBe("content")
  })
  it("only ever returns a known group", () => {
    for (const key of ["x", "weird_attr", "foo123"]) {
      expect(OPTIONAL_GROUP_ORDER).toContain(categorizeField(key))
    }
  })
})

describe("fieldsForSchema — hidden attributes", () => {
  const schema = {
    type: "Clip",
    attributes: [
      { key: "text", type: "string", required: true },
      { key: "language", type: "string", required: false },
      { key: "project_id", type: "string", required: false },
      { key: "pub_key", type: "string", required: false },
      { key: "pubkey", type: "string", required: false },
      { key: "boost", type: "int", required: false },
      { key: "num_boost", type: "int", required: false },
      { key: "sentiment_score", type: "float", required: false },
      { key: "weight", type: "float", required: false },
    ],
  } as unknown as SchemaNode

  const keys = fieldsForSchema(schema).map((f) => f.key)

  it("keeps user-facing content/metadata fields", () => {
    expect(keys).toContain("text")
    expect(keys).toContain("language")
  })

  it("hides project_id and pub_key/pubkey provenance fields", () => {
    expect(keys).not.toContain("project_id")
    expect(keys).not.toContain("pub_key")
    expect(keys).not.toContain("pubkey")
  })

  it("hides the entire Signals & scoring group", () => {
    expect(keys).not.toContain("boost")
    expect(keys).not.toContain("num_boost")
    expect(keys).not.toContain("sentiment_score")
  })

  it("still hides pre-existing system attributes", () => {
    expect(keys).not.toContain("weight")
  })
})
