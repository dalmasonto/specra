import assert from 'node:assert/strict'
import {
  extractChangelogEntries,
  annotateChangelogNodes,
  renderRssFeed,
} from './src/lib/changelog.ts'

let failed = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    
check('inline tags vanish without inserting a space', () => {
  const [e] = extractChangelogEntries([update({ label: 'x' }, [html('<p>Presets: <code>new</code>, <code>beta</code>.</p>')])])
  assert.equal(e.summary, 'Presets: new, beta.')
})

check('links and emphasis do not gain spaces', () => {
  const [e] = extractChangelogEntries([update({ label: 'x' }, [html('<p>See <a href="/x">docs</a>, or <em>read</em>!</p>')])])
  assert.equal(e.summary, 'See docs, or read!')
})

check('block tags still separate words', () => {
  const [e] = extractChangelogEntries([update({ label: 'x' }, [html('<p>one</p><p>two</p>')])])
  assert.equal(e.summary, 'one two')
})

check('script and style contents are removed', () => {
  const [e] = extractChangelogEntries([update({ label: 'x' }, [html('<p>a</p><script>evil()</script><style>.c{}</style><p>b</p>')])])
  assert.equal(e.summary, 'a b')
})

console.log(`  ok   ${name}`)
  } catch (err) {
    failed++
    console.log(`  FAIL ${name}\n       ${(err as Error).message.split('\n')[0]}`)
  }
}

const update = (props: any, children: any[] = []) => ({
  type: 'component' as const,
  name: 'Update',
  props,
  children,
})
const html = (content: string) => ({ type: 'html' as const, content })

// ---------- extractChangelogEntries ----------
check('extracts label, description, tags, id', () => {
  const [e] = extractChangelogEntries([
    update({ id: '2026-07-10', label: '2026-07-10', description: 'v1.2.0', tags: ['SDK', 'Sidebar'] }, [
      html('<p>Added sidebar badges.</p>'),
    ]),
  ])
  assert.equal(e.id, '2026-07-10')
  assert.equal(e.label, '2026-07-10')
  assert.equal(e.description, 'v1.2.0')
  assert.deepEqual(e.tags, ['SDK', 'Sidebar'])
  assert.equal(e.title, '2026-07-10')
  assert.equal(e.summary, 'Added sidebar badges.')
})

check('finds updates nested inside a Changelog wrapper', () => {
  const nodes = [
    { type: 'component' as const, name: 'Changelog', props: {}, children: [update({ label: 'a' }), update({ label: 'b' })] },
  ]
  assert.deepEqual(extractChangelogEntries(nodes).map((e) => e.label), ['a', 'b'])
})

check('update without a label is skipped', () => {
  assert.deepEqual(extractChangelogEntries([update({ description: 'v1' })]), [])
})

check('rss prop overrides title and description', () => {
  const [e] = extractChangelogEntries([
    update({ label: 'x', rss: { title: 'Custom', description: 'Body' } }, [html('<p>ignored</p>')]),
  ])
  assert.equal(e.title, 'Custom')
  assert.equal(e.summary, 'Body')
})

check('component children are stripped from the summary', () => {
  const [e] = extractChangelogEntries([
    update({ label: 'x' }, [
      html('<p>Before.</p>'),
      { type: 'component' as const, name: 'Card', props: {}, children: [html('<p>inside card</p>')] },
      html('<p>After.</p>'),
    ]),
  ])
  assert.equal(e.summary, 'Before. After.')
})

check('block tags become spaces, not nothing', () => {
  const [e] = extractChangelogEntries([update({ label: 'x' }, [html('<ul><li>a</li><li>b</li></ul>')])])
  assert.equal(e.summary, 'a b')
})

check('entities decode without double-decoding', () => {
  const [e] = extractChangelogEntries([update({ label: 'x' }, [html('<p>a &amp;lt; b &amp; c</p>')])])
  assert.equal(e.summary, 'a &lt; b & c')
})

check('non-string tags are dropped', () => {
  const [e] = extractChangelogEntries([update({ label: 'x', tags: ['ok', 42, null, ''] as any })])
  assert.deepEqual(e.tags, ['ok'])
})

check('malformed nodes do not throw', () => {
  assert.deepEqual(extractChangelogEntries(undefined), [])
  assert.deepEqual(extractChangelogEntries([]), [])
  assert.deepEqual(extractChangelogEntries([html('<p>hi</p>')]), [])
})

// ---------- annotateChangelogNodes ----------
check('allTags is the union in first-seen order', () => {
  const nodes = [
    {
      type: 'component' as const,
      name: 'Changelog',
      props: {},
      children: [update({ label: 'a', tags: ['SDK', 'CLI'] }), update({ label: 'b', tags: ['CLI', 'App'] })],
    },
  ]
  annotateChangelogNodes(nodes)
  assert.deepEqual((nodes[0].props as any).allTags, ['SDK', 'CLI', 'App'])
})

check('changelog with no tagged updates gets an empty allTags', () => {
  const nodes = [{ type: 'component' as const, name: 'Changelog', props: {}, children: [update({ label: 'a' })] }]
  annotateChangelogNodes(nodes)
  assert.deepEqual((nodes[0].props as any).allTags, [])
})

check('bare updates outside a Changelog are left alone', () => {
  const nodes = [update({ label: 'a', tags: ['SDK'] })]
  annotateChangelogNodes(nodes)
  assert.equal((nodes[0].props as any).allTags, undefined)
})

// ---------- renderRssFeed ----------
const feed = renderRssFeed({
  entries: extractChangelogEntries([
    update({ id: 'r1', label: '2026-07-10', description: 'v1.2.0', tags: ['SDK & CLI'] }, [
      html('<p>Fixed &lt;Update&gt; parsing.</p>'),
    ]),
    update({ id: 'r2', label: 'March 2025' }, [html('<p>Older.</p>')]),
    update({ id: 'r3', label: 'v2 launch' }, [html('<p>No date.</p>')]),
  ]),
  siteUrl: 'https://docs.example.com/',
  pageUrl: '/docs/v1.0.0/changelog',
  title: 'Changelog & Releases',
  description: 'What changed',
})

check('feed escapes ampersands in title and category', () => {
  assert.ok(feed.includes('<title>Changelog &amp; Releases</title>'))
  assert.ok(feed.includes('<category>SDK &amp; CLI</category>'))
  assert.ok(!/<title>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/.test(feed))
})

check('feed escapes markup that leaked into body text', () => {
  assert.ok(feed.includes('Fixed &lt;Update&gt; parsing.'))
})

check('absolute links do not double slashes', () => {
  assert.ok(feed.includes('<link>https://docs.example.com/docs/v1.0.0/changelog</link>'))
  assert.ok(feed.includes('href="https://docs.example.com/docs/v1.0.0/changelog/rss.xml"'))
  assert.ok(!feed.includes('.com//'))
})

check('guid anchors each entry', () => {
  assert.ok(feed.includes('https://docs.example.com/docs/v1.0.0/changelog#r1'))
})

check('date-like labels get a pubDate', () => {
  assert.ok(feed.includes('<pubDate>'))
  assert.equal((feed.match(/<pubDate>/g) || []).length, 2, 'two of three labels parse as dates')
})

check('non-date label emits no Invalid Date', () => {
  assert.ok(!feed.includes('Invalid Date'))
})

check('version line is folded into the body', () => {
  assert.ok(feed.includes('v1.2.0 — Fixed'))
})

check('empty feed is still valid xml', () => {
  const empty = renderRssFeed({ entries: [], siteUrl: 'https://x.dev', pageUrl: '/c', title: 'T' })
  assert.ok(empty.startsWith('<?xml version="1.0" encoding="UTF-8"?>'))
  assert.ok(empty.trimEnd().endsWith('</rss>'))
  assert.ok(!empty.includes('<item>'))
})

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
