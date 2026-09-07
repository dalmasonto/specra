import { describe, expect, test } from "vitest"
import { normalizeChangelogJson, assignAnchorIds } from "./changelog-json.js"

describe("normalizeChangelogJson", () => {
  test("accepts an { entries: [...] } wrapper", () => {
    const result = normalizeChangelogJson({
      entries: [{ label: "2026-07-10" }],
    })
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe("2026-07-10")
  })

  test("accepts a bare top-level array", () => {
    const result = normalizeChangelogJson([{ label: "2026-07-10" }])
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe("2026-07-10")
  })

  test("maps every field of a full entry through", () => {
    const [entry] = normalizeChangelogJson([
      {
        label: "2026-07-10",
        description: "Sidebar badges",
        version: "v0.2.68",
        tags: ["SDK", "Sidebar"],
        body: "Mark a page in frontmatter.",
        rss: { title: "Badges", description: "New sidebar badges" },
      },
    ])
    expect(entry).toEqual({
      label: "2026-07-10",
      description: "Sidebar badges",
      version: "v0.2.68",
      tags: ["SDK", "Sidebar"],
      body: "Mark a page in frontmatter.",
      rss: { title: "Badges", description: "New sidebar badges" },
    })
  })

  test("drops an entry with no usable label (fail-soft)", () => {
    const result = normalizeChangelogJson([
      { label: "  " },
      { description: "no label at all" },
      { label: "2026-07-10" },
    ])
    expect(result.map((e) => e.label)).toEqual(["2026-07-10"])
  })

  test("defaults tags to [] and body to '' when absent", () => {
    const [entry] = normalizeChangelogJson([{ label: "2026-07-10" }])
    expect(entry.tags).toEqual([])
    expect(entry.body).toBe("")
  })

  test("keeps only string tags, discarding junk", () => {
    const [entry] = normalizeChangelogJson([
      { label: "x", tags: ["SDK", 3, null, "", "Fix"] as unknown as string[] },
    ])
    expect(entry.tags).toEqual(["SDK", "Fix"])
  })

  test.each([null, undefined, 42, "nope", true])(
    "returns [] for non-collection input: %s",
    (raw) => {
      expect(normalizeChangelogJson(raw as unknown)).toEqual([])
    }
  )
})

describe("assignAnchorIds", () => {
  test("slugs each entry's label into an id", () => {
    const [entry] = assignAnchorIds([
      { label: "Big Release", tags: [], body: "" },
    ])
    expect(entry.id).toBe("big-release")
  })

  test("disambiguates entries that share a label", () => {
    const ids = assignAnchorIds([
      { label: "v1", tags: [], body: "" },
      { label: "v1", tags: [], body: "" },
    ]).map((e) => e.id)
    expect(ids).toEqual(["v1", "v1-1"])
  })

  test("preserves the original entry fields alongside the id", () => {
    const [entry] = assignAnchorIds([
      { label: "2026-07-10", version: "v0.2.68", tags: ["SDK"], body: "hi" },
    ])
    expect(entry.version).toBe("v0.2.68")
    expect(entry.tags).toEqual(["SDK"])
  })
})
