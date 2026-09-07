/**
 * Parse and normalize changelog entries supplied as JSON, instead of authored
 * inline as `<Update>` blocks.
 *
 * A `<Changelog src="…">` points at a JSON document — a local static file or a
 * remote URL — shaped like:
 *
 *   { "entries": [
 *       { "label": "2026-07-10", "version": "v0.2.68",
 *         "description": "Sidebar badges", "tags": ["SDK"],
 *         "body": "Markdown explanation…" }
 *   ] }
 *
 * A bare top-level array is also accepted. This module is pure and server-safe:
 * no fs, no fetch, no Svelte. The server resolver renders each `body` markdown to
 * HTML and the component renders the result; here we only validate and shape.
 */
import GithubSlugger from "github-slugger"

/** One entry exactly as it may appear in the JSON, before validation. */
export interface ChangelogJsonEntry {
  /** Date or release name. Required — anchors the entry and names it in the ToC. */
  label: string
  /** Lead line shown at the top of the entry body (the right column). */
  description?: string
  /** Version string, shown under the label (the left column). */
  version?: string
  tags?: string[]
  /** Markdown, rendered to HTML at resolve time. */
  body?: string
  /** Overrides for the RSS feed item. */
  rss?: { title?: string; description?: string }
}

/** A validated entry: `tags` and `body` are always present, `label` non-empty. */
export interface NormalizedChangelogEntry {
  label: string
  description?: string
  version?: string
  tags: string[]
  body: string
  rss?: { title?: string; description?: string }
}

/** A normalized entry with its anchor id assigned. */
export type AnchoredChangelogEntry = NormalizedChangelogEntry & { id: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

/** Keep only non-empty strings; everything else in the array is discarded. */
function coerceTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
}

/**
 * Validate arbitrary JSON into changelog entries.
 *
 * Fail-soft: unusable input yields `[]` and a malformed entry is dropped rather
 * than throwing, so one bad record can't blank an entire changelog. Accepts both
 * a bare array and an `{ entries: [...] }` wrapper.
 */
export function normalizeChangelogJson(raw: unknown): NormalizedChangelogEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.entries)
      ? raw.entries
      : []

  const entries: NormalizedChangelogEntry[] = []
  for (const item of list) {
    if (!isRecord(item)) continue

    // A label-less entry has no anchor and no stable identity, so it is dropped.
    const label = typeof item.label === "string" ? item.label.trim() : ""
    if (!label) continue

    const entry: NormalizedChangelogEntry = {
      label,
      tags: coerceTags(item.tags),
      body: typeof item.body === "string" ? item.body : "",
    }

    if (typeof item.description === "string") entry.description = item.description
    if (typeof item.version === "string") entry.version = item.version

    if (isRecord(item.rss)) {
      const rss: { title?: string; description?: string } = {}
      if (typeof item.rss.title === "string") rss.title = item.rss.title
      if (typeof item.rss.description === "string") rss.description = item.rss.description
      entry.rss = rss
    }

    entries.push(entry)
  }

  return entries
}

/**
 * Assign a stable anchor id to each entry, slugged from its label.
 *
 * Uses one slugger for the batch so entries sharing a label disambiguate
 * (`v1`, `v1-1`), matching how `rehypeChangelogIds` anchors inline updates.
 */
export function assignAnchorIds(
  entries: NormalizedChangelogEntry[]
): AnchoredChangelogEntry[] {
  const slugger = new GithubSlugger()
  return entries.map((entry) => ({ ...entry, id: slugger.slug(entry.label) }))
}
