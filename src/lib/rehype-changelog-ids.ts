/**
 * Rehype plugin that gives every `<Update>` a stable anchor id.
 *
 * The id is slugged from the update's `label`, using a slugger that has ALSO
 * consumed every heading on the page. rehype-slug builds one GithubSlugger per
 * document and feeds it every h1–h6 in order; by replaying that same sequence
 * here we land in the same namespace. Two consequences:
 *
 *   - An `<Update label="Changelog">` on a page that also has `## Changelog`
 *     becomes `changelog-1` instead of silently duplicating the heading's id.
 *   - Two updates sharing a label get `v1` and `v1-1`, never a collision.
 *
 * `extractTableOfContents` performs the same walk over the raw markdown, so the
 * anchors it links to are byte-identical to the ones rendered here.
 *
 * Manually walks the tree to avoid ESM/CJS issues with unist-util-visit, matching
 * rehype-base-path.ts.
 */
import type { Root, Element, RootContent } from 'hast'
import GithubSlugger from 'github-slugger'

const HEADING_TAG = /^h[1-6]$/

/** Concatenate the text nodes beneath a node, as hast-util-to-string would. */
function textContent(node: any): string {
  if (node.type === 'text') return String(node.value ?? '')
  if (Array.isArray(node.children)) return node.children.map(textContent).join('')
  return ''
}

/** Preorder walk over element nodes, i.e. document order. */
function walkElements(nodes: RootContent[], fn: (node: Element) => void) {
  for (const node of nodes) {
    if (node.type !== 'element') continue
    fn(node)
    if (node.children) {
      walkElements(node.children as RootContent[], fn)
    }
  }
}

export function rehypeChangelogIds() {
  return (tree: Root) => {
    const slugger = new GithubSlugger()

    walkElements(tree.children as RootContent[], (node: Element) => {
      // Consume the name rehype-slug already consumed for this heading, keeping
      // the two occurrence counters aligned. The return value is discarded —
      // rehype-slug owns the heading's actual id.
      if (HEADING_TAG.test(node.tagName)) {
        slugger.slug(textContent(node))
        return
      }

      if (node.tagName !== 'update') return

      const label = node.properties?.label
      // A label-less update has no identity to anchor. It still renders; it just
      // gets no anchor, no ToC entry and no feed item.
      if (typeof label !== 'string' || !label.trim()) return

      node.properties = { ...node.properties, id: slugger.slug(label.trim()) }
    })
  }
}
