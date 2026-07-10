/**
 * Changelog entry extraction and RSS feed generation.
 *
 * A changelog page is an ordinary MDX page holding `<Update>` blocks:
 *
 *   <Changelog>
 *     <Update label="2026-07-10" description="v1.2.0" tags={["SDK"]}>
 *       Added sidebar badges.
 *     </Update>
 *   </Changelog>
 *
 * This module is framework-agnostic and server-safe (no fs, no Svelte). It
 * turns the `MdxNode` tree into feed entries and renders RSS 2.0.
 */

// Type-only: erased at build, so `mdx.ts` can import this module's functions
// back without creating a runtime cycle.
import type { MdxNode } from "./mdx.js"

/** The component names, as they appear on `MdxNode.name` after tag mapping. */
const UPDATE_NODE = "Update"
const CHANGELOG_NODE = "Changelog"

/** Author-supplied override for how an update appears in the feed. */
export interface UpdateRssOverride {
  title?: string
  description?: string
}

export interface ChangelogEntry {
  /** Anchor id, injected server-side so it matches the rendered element. */
  id: string
  label: string
  description?: string
  tags: string[]
  /** Feed entry title: `rss.title`, else the label. */
  title: string
  /** Feed entry body: `rss.description`, else the entry's plain text. */
  summary: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
}

/**
 * Tags that separate words. Everything else is inline and disappears without a
 * trace: turning `<code>new</code>,` into a space would emit `new ,`, while
 * deleting `</li><li>` outright would collapse `<li>a</li><li>b</li>` into `ab`.
 */
const BLOCK_TAG =
  /<\/?(?:p|div|br|hr|h[1-6]|ul|ol|li|pre|blockquote|table|thead|tbody|tr|td|th|section|article|header|footer|figure|figcaption)\b[^>]*>/gi

/**
 * Strip an `html` node's markup down to readable text.
 *
 * Feed readers render a tiny, unpredictable subset of HTML, so entry bodies are
 * plain text.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(BLOCK_TAG, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // `&amp;` last: decoding it earlier would let `&amp;lt;` become `<`.
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Collect plain text from a node's subtree.
 *
 * Component nodes are skipped, matching Mintlify: a `<Card>` or `<Tabs>` inside
 * an update carries layout, not prose, and flattening it produces noise. Authors
 * who need those words in the feed supply `rss={{ description: "..." }}`.
 */
function nodesToText(nodes: MdxNode[] | undefined): string {
  if (!nodes?.length) return ""

  const parts: string[] = []
  for (const node of nodes) {
    if (node.type === "html" && node.content) parts.push(htmlToText(node.content))
  }

  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
}

/** Depth-first walk yielding every node in document order. */
function* walk(nodes: MdxNode[] | undefined): Generator<MdxNode> {
  if (!nodes?.length) return
  for (const node of nodes) {
    yield node
    yield* walk(node.children)
  }
}

function toEntry(node: MdxNode): ChangelogEntry | null {
  const props = node.props ?? {}

  const label = typeof props.label === "string" ? props.label.trim() : ""
  // An update with no label has no anchor and no stable identity, so it cannot
  // appear in a feed. It still renders on the page; it is just not syndicated.
  if (!label) return null

  const id = typeof props.id === "string" ? props.id : ""
  const description = typeof props.description === "string" ? props.description.trim() : undefined
  const tags = asStringArray(props.tags)

  const rss: UpdateRssOverride = isRecord(props.rss) ? (props.rss as UpdateRssOverride) : {}
  const title = typeof rss.title === "string" && rss.title.trim() ? rss.title.trim() : label
  const summary =
    typeof rss.description === "string" && rss.description.trim()
      ? rss.description.trim()
      : nodesToText(node.children)

  return { id, label, description, tags, title, summary }
}

/**
 * Pull every `<Update>` out of a processed document, in document order.
 * Works whether or not the updates sit inside a `<Changelog>` wrapper.
 */
export function extractChangelogEntries(nodes: MdxNode[] | undefined): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []

  for (const node of walk(nodes)) {
    if (node.type !== "component" || node.name !== UPDATE_NODE) continue
    const entry = toEntry(node)
    if (entry) entries.push(entry)
  }

  return entries
}

/**
 * Inject `allTags` onto every `<Changelog>` node: the union of its updates' tags,
 * in first-seen order.
 *
 * Computed here, on the server, rather than by having each `<Update>` register
 * itself with a parent context at render time. Children render after their parent
 * during SSR, so a self-registering filter bar would serialize with an empty tag
 * list and then repopulate on hydration — a mismatch and a visible flash.
 *
 * Mutates in place and returns the same array, matching the pipeline's style.
 */
export function annotateChangelogNodes(nodes: MdxNode[] | undefined): MdxNode[] {
  if (!nodes?.length) return nodes ?? []

  for (const node of walk(nodes)) {
    if (node.type !== "component" || node.name !== CHANGELOG_NODE) continue

    const seen = new Set<string>()
    const allTags: string[] = []

    for (const child of walk(node.children)) {
      if (child.type !== "component" || child.name !== UPDATE_NODE) continue
      for (const tag of asStringArray(child.props?.tags)) {
        if (seen.has(tag)) continue
        seen.add(tag)
        allTags.push(tag)
      }
    }

    node.props = { ...node.props, allTags }
  }

  return nodes
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char])
}

/**
 * Interpret an update label as a date for `<pubDate>`.
 *
 * Labels are free text — "March 2025" and "v2 launch" are both valid — so a
 * label that isn't a date simply yields no pubDate rather than an Invalid Date.
 */
function toPubDate(label: string): string | null {
  const parsed = new Date(label)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toUTCString()
}

/** Join a site origin and a page path into one absolute URL, without doubling slashes. */
function absoluteUrl(siteUrl: string, pageUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/${pageUrl.replace(/^\/+/, "")}`
}

export interface RssFeedOptions {
  entries: ChangelogEntry[]
  /** Site origin, e.g. `https://docs.example.com` (from `config.site.url`). */
  siteUrl: string
  /** Path of the changelog page, e.g. `/docs/v1.0.0/changelog`. */
  pageUrl: string
  title: string
  description?: string
}

/** Render entries as an RSS 2.0 document. */
export function renderRssFeed({
  entries,
  siteUrl,
  pageUrl,
  title,
  description = "",
}: RssFeedOptions): string {
  const link = absoluteUrl(siteUrl, pageUrl)
  const feedUrl = `${link}/rss.xml`

  const items = entries.map((entry) => {
    const guid = entry.id ? `${link}#${entry.id}` : link
    const pubDate = toPubDate(entry.label)

    // `description` is the version line; fold it into the body so subscribers
    // see which release an entry belongs to.
    const body = [entry.description, entry.summary].filter(Boolean).join(" — ")

    return [
      "    <item>",
      `      <title>${escapeXml(entry.title)}</title>`,
      `      <link>${escapeXml(guid)}</link>`,
      `      <guid isPermaLink="false">${escapeXml(guid)}</guid>`,
      pubDate ? `      <pubDate>${escapeXml(pubDate)}</pubDate>` : null,
      ...entry.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`),
      `      <description>${escapeXml(body)}</description>`,
      "    </item>",
    ]
      .filter(Boolean)
      .join("\n")
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(link)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n")
}
