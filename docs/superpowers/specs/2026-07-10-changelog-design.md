# Changelog / Update component — design

**Date:** 2026-07-10
**Status:** Approved, ready to implement
**Repos touched:** `specra-sdk` (components, pipeline, feed generator), `specra-docs` (RSS routes, demo page)

## Goal

Give docs authors a changelog page: a timeline of releases, each with a date label, a version, optional tags, and freeform content. Entries render in the order they are written — the author puts the newest first. Modelled on Mintlify's `<Update>` component.

## Authoring model

Changelog entries are `<Update>` blocks inside one ordinary MDX page. No new routing, no doc-discovery changes, no file-per-entry convention.

```mdx
---
title: Changelog
rss: true
---

<Changelog>
  <Update label="2026-07-10" description="v1.2.0" tags={["SDK", "Sidebar"]}>
    Added sidebar badges.
  </Update>

  <Update label="2026-06-02" description="v1.1.0" tags={["CLI"]}>
    Meilisearch support.
  </Update>
</Changelog>
```

`<Changelog>` is an explicit wrapper. It exists because sibling components cannot share state in Svelte 5 without a common parent, and the tag filter bar needs the union of every child's tags plus a shared selected-tag set. Mintlify allows flat `<Update>` blocks because its renderer is page-aware; Specra's `MdxContent` merely walks a node tree. The alternative — auto-wrapping contiguous runs of `<Update>` server-side — was rejected: prose between two updates silently splits the run into two independent filter bars.

An `<Update>` outside a `<Changelog>` still renders. It simply has no filter context.

## Props

`<Update>`:

| Prop | Type | Notes |
|---|---|---|
| `label` | `string` (required) | Date or release name. Becomes the anchor and the ToC entry. |
| `description` | `string` | Secondary line, typically a version. |
| `tags` | `string[]` | Rendered as chips; drives filtering. |
| `rss` | `{ title?, description? }` | Overrides the auto-derived feed entry. |

`<Changelog>` takes no authored props. `allTags` is injected server-side (see below).

## Architecture

### Components (`specra-sdk`)

- `Update.svelte` — one timeline row. Sticky left rail holding label, description and tag chips; content on the right against a vertical rule with a node dot. Reads the optional changelog context to decide whether it is filtered out.
- `Changelog.svelte` — owns the rail, the filter bar and a Svelte context carrying the selected-tag set and a `matches(tags)` predicate.

Both are registered in `COMPONENT_TAG_MAP` (`mdx.ts`) and `mdx-components.ts`. `tags={["SDK"]}` needs no new prop plumbing: `preprocessJsxExpressions` already encodes JSX attribute expressions and `parseJsxExpression` decodes them into real arrays.

### Server-side injection

Two computed props are injected during processing rather than derived in the browser.

1. **`id` on each `update` node.** A rehype plugin runs immediately after `rehypeSlug`, walks the hast tree in document order, feeds every `h1`–`h6` through a fresh `GithubSlugger`, and slugs each `<Update>` label through that *same* slugger. Because `rehypeSlug` uses an identical per-document slugger over the identical heading sequence, the two agree exactly — and update anchors can never collide with heading anchors. An `<Update label="Changelog">` on a page with `## Changelog` becomes `changelog-1`.

2. **`allTags` on each `changelog` node.** After `hastChildrenToMdxNodes` produces `MdxNode`s (where `tags` is a decoded array), a pure pass unions the tags of each `Changelog`'s `Update` children, preserving first-seen order.

Both exist to make SSR correct by construction. Had `Changelog` instead collected tags by letting children register themselves during render, the filter bar would render before its children on the server and ship empty HTML — a hydration mismatch and a visible flash on load. Injecting `id` server-side likewise guarantees the anchor the ToC links to is byte-identical to the one `Update` renders.

No new dependencies: the plugin hand-rolls its tree walk and text extraction, matching the existing hand-rolled traversal in `hastChildrenToMdxNodes`.

### Table of contents

`extractTableOfContents` regexes raw markdown. It is extended to match `<Update label="...">` alongside headings, emitting both in document order from one shared `GithubSlugger` — the same namespace discipline the rehype plugin uses, so ids agree. Attribute matching tolerates newlines inside the tag, since authors wrap long `<Update>` tags.

Because `+page.server.ts` already calls `extractTableOfContents`, **the ToC requires no route changes.**

Prerequisite, fixed separately in commit `51d0560`: `extractTableOfContents` used github-slugger's stateless `slug()` while `rehype-slug` uses a stateful per-document slugger, so duplicate headings produced ToC links that scrolled to the wrong heading.

### RSS

New `specra-sdk/src/lib/changelog.ts`, framework-agnostic and server-safe:

- `extractChangelogEntries(nodes: MdxNode[]): ChangelogEntry[]` — walks `contentNodes` for `Update` nodes.
- `renderRssFeed({ entries, siteUrl, pageUrl, title, description }): string` — escaped RSS 2.0 XML.

`specra-docs` adds a thin endpoint at `/docs/[version]/[...slug]/rss.xml` (and the `[product]` twin) that 404s unless `doc.meta.rss === true`. SvelteKit 2 was verified to register a static segment following a rest parameter. Absolute links come from `SiteConfig.url`.

Keeping the generator in the SDK means downstream consumers enable RSS by adding one route file, not by reimplementing feed generation.

Per Mintlify, components and raw HTML are stripped from feed entries; authors override the entry via the `rss` prop.

`DocMeta` gains `rss?: boolean`.

## Error handling

- An `<Update>` with no `label` renders its content but is omitted from the ToC and the feed. It never fails the build.
- Unparseable or absent `tags` degrade to no chips and no filtering.
- Filtering is AND logic: an update is visible when every selected tag is present on it. Selecting nothing shows everything.
- The RSS endpoint returns 404 for pages without `rss: true`, and for slugs that resolve to no doc.

## Testing

The SDK has no test runner, so suites run under `node --experimental-strip-types` (via `tsx`, since the source uses extensionless imports):

- `extractChangelogEntries` over nested/absent/malformed nodes.
- `renderRssFeed` XML escaping (`&`, `<`, `>`, quotes) and date handling for non-date labels.
- `annotateChangelogNodes` tag union and ordering.
- Merged ToC ordering: headings and update labels interleaved, sharing one slug namespace.
- Duplicate-label and label/heading-collision slug dedupe.

Plus a `svelte-check` baseline diff (established baseline: 40 errors / 20 warnings, all pre-existing) and a clean `npm run build`.

## Accepted limitations

- Entries render in source order. There is no date parsing or automatic sort; authors order their own file. Labels need not be dates.
- Tag filtering is client-side only; the feed and the ToC always contain every entry.
- RSS entry bodies are plain text. Rich HTML in feeds is deliberately out of scope.
