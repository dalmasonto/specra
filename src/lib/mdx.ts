import fs from "fs"
import path from "path"
import matter from "gray-matter"
import yaml from "js-yaml"
import { rehypeBasePath } from "./rehype-base-path.js"
import { rehypeChangelogIds } from "./rehype-changelog-ids.js"
import { annotateChangelogNodes } from "./changelog.js"
import { remarkCodeMeta } from "./remark-code-meta.js"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import remarkRehype from "remark-rehype"
import rehypeSlug from "rehype-slug"
import GithubSlugger from "github-slugger"
import rehypeRaw from "rehype-raw"
import rehypeKatex from "rehype-katex"
import rehypeStringify from "rehype-stringify"
import { toHtml } from "hast-util-to-html"
import { getAllCategoryConfigs } from "./category"
import type { BadgeInput } from "./badges"
import { sortSidebarItems, sortSidebarGroups, buildSidebarStructure, type SidebarGroup } from "./sidebar-utils"
import { sanitizePath, validatePathWithinDirectory, validateMDXSecurity } from "./mdx-security"
import { getConfig } from "./config"
import type { I18nConfig } from "./config.types"

const DOCS_DIR = typeof process !== 'undefined' ? path.join(process.cwd(), "docs") : "docs"

/**
 * Resolve the docs directory for a given version and optional product.
 * - Default product or omitted: docs/{version}/
 * - Named product: docs/{product}/{version}/
 */
function resolveDocsPath(version: string, product?: string): string {
  if (product && product !== "_default_") {
    return path.join(DOCS_DIR, product, version)
  }
  return path.join(DOCS_DIR, version)
}

/**
 * Structured node type for MDX content rendering.
 * Used to pass a JSON-serializable tree from server to client,
 * allowing the client-side recursive renderer to instantiate
 * real Svelte components for custom tags.
 */
export interface MdxNode {
  type: 'html' | 'component'
  content?: string
  name?: string
  props?: Record<string, any>
  children?: MdxNode[]
}

/**
 * Map of lowercased HTML tag names to PascalCase component names.
 * When rehype processes MDX, it lowercases all custom tags.
 * This map restores the correct component name for rendering.
 */
const COMPONENT_TAG_MAP: Record<string, string> = {
  accordion: 'Accordion',
  accordionitem: 'AccordionItem',
  tabs: 'Tabs',
  tab: 'Tab',
  callout: 'Callout',
  card: 'Card',
  cardgrid: 'CardGrid',
  imagecard: 'ImageCard',
  imagecardgrid: 'ImageCardGrid',
  steps: 'Steps',
  step: 'Step',
  icon: 'Icon',
  mermaid: 'Mermaid',
  math: 'Math',
  columns: 'Columns',
  column: 'Column',
  docbadge: 'DocBadge',
  badge: 'Badge',
  tooltip: 'Tooltip',
  frame: 'Frame',
  codeblock: 'CodeBlock',
  image: 'Image',
  'specra-image': 'Image',
  'specra-math': 'Math',
  video: 'Video',
  apiendpoint: 'ApiEndpoint',
  apiparams: 'ApiParams',
  apiresponse: 'ApiResponse',
  apiplayground: 'ApiPlayground',
  apireference: 'ApiReference',
  changelog: 'Changelog',
  update: 'Update',
}

/**
 * Map of lowercased attribute names to their correct camelCase form.
 * HTML lowercases all attribute names, so we need to restore them.
 */
const PROP_NAME_MAP: Record<string, string> = {
  defaultopen: 'defaultOpen',
  defaultvalue: 'defaultValue',
  classname: 'className',
  tabgroup: 'tabGroup',
  defaultchecked: 'defaultChecked',
  defaultselected: 'defaultSelected',
  apikey: 'apiKey',
  baseurl: 'baseURL',
}

/**
 * Pre-process markdown to convert JSX expression attributes into
 * HTML-safe string attributes before the remark/rehype pipeline.
 *
 * JSX expressions like `cols={{ sm: 1, md: 2 }}` and `span={2}` are
 * not valid HTML and get mangled by the HTML parser. This converts them
 * to quoted string attributes that survive parsing, using a special
 * `__jsx:` prefix so `convertProps` can parse them back.
 *
 * Examples:
 *   cols={{ sm: 1, md: 2 }}  →  cols="__jsx:{ sm: 1, md: 2 }"
 *   span={2}                  →  span="__jsx:2"
 *   variant="success"         →  (unchanged, already a string)
 */
/**
 * Split markdown into fenced code blocks and non-code segments.
 * Code blocks are preserved as-is; only non-code segments should be
 * processed by JSX/component preprocessing functions.
 * Matches 3+ backticks or tildes as fence markers.
 */
/**
 * Private Use Area character used to mask `|` inside inline code spans
 * so that remark-gfm's table tokenizer doesn't treat them as cell dividers.
 *
 * Why: GFM splits table cells on `|` BEFORE inline parsing recognizes
 * backtick-delimited code spans. So a row like
 *   | `{{ name | upper }}` |
 * gets split on the inner pipe, breaking the row. Escaping with `\|` is
 * the GFM-spec workaround, but inside an inline code span the `\` renders
 * literally — useless for users. We swap `|` for U+E000 before parsing
 * and swap it back in the output; PUA chars pass through remark/rehype
 * unchanged and are never HTML-escaped.
 */
const PIPE_MARKER = ''

/**
 * Mask `|` characters inside single-line markdown inline code spans by
 * replacing them with `PIPE_MARKER`. Operates only on non-fenced segments.
 * Idempotent: if no inline code contains `|`, output equals input.
 */
function maskInlineCodePipes(markdown: string): string {
  return splitByCodeFences(markdown).map(({ text, isCode }) => {
    if (isCode) return text
    let result = ''
    let i = 0
    while (i < text.length) {
      if (text[i] !== '`') {
        result += text[i]
        i++
        continue
      }
      // Count opening backtick run
      let openLen = 0
      while (i + openLen < text.length && text[i + openLen] === '`') openLen++
      // Find matching closing run of the same length on the same line.
      // (Inline code spans inside table cells are always single-line.)
      let j = i + openLen
      let closeIdx = -1
      while (j < text.length && text[j] !== '\n') {
        if (text[j] === '`') {
          let closeLen = 0
          while (j + closeLen < text.length && text[j + closeLen] === '`') closeLen++
          if (closeLen === openLen) { closeIdx = j; break }
          j += closeLen
        } else {
          j++
        }
      }
      if (closeIdx === -1) {
        // Unmatched run — emit verbatim
        result += text.slice(i, i + openLen)
        i += openLen
      } else {
        const content = text.slice(i + openLen, closeIdx).replace(/\|/g, PIPE_MARKER)
        result += text.slice(i, i + openLen) + content + text.slice(closeIdx, closeIdx + openLen)
        i = closeIdx + openLen
      }
    }
    return result
  }).join('')
}

/**
 * Private Use Area characters used to mask `<` and `>` written inside code
 * (inline spans or fenced blocks) that sits within a component block.
 *
 * Why: `ensureComponentBlockIntegrity` deliberately collapses blank lines so
 * that an entire `<Callout>…</Callout>` stays one CommonMark HTML block. But
 * inside an HTML block, markdown no longer applies — code spans and fences stop
 * being code — so a documented tag such as
 *   An inline `<script src="/x.js">` tag.
 * is handed to rehype-raw as *real HTML*. parse5 opens a raw-text `<script>`
 * element that is never closed and swallows every following sibling, so the
 * next heading silently disappears from the page and its ToC link 404s.
 *
 * Masking the angle brackets before remark sees them keeps the block inert for
 * parse5, and `restoreCodeMarkers` puts them back after the component's
 * children have been re-parsed as markdown. PUA chars pass through
 * remark/rehype unchanged and are never HTML-escaped — same trick as
 * `PIPE_MARKER` above.
 */
const LT_MARKER = ''
const GT_MARKER = ''

/**
 * Mask `<` and `>` inside fenced code blocks and single-line inline code spans.
 * Applied only to the interior of component blocks, where markdown code markers
 * lose their meaning. Component tags themselves live outside code and are left
 * alone, so `<Callout>` still parses as a component.
 */
function maskCodeAngleBrackets(markdown: string): string {
  const maskAngles = (s: string) => s.replace(/</g, LT_MARKER).replace(/>/g, GT_MARKER)

  return splitByCodeFences(markdown).map(({ text, isCode }) => {
    if (isCode) return maskAngles(text)
    let result = ''
    let i = 0
    while (i < text.length) {
      if (text[i] !== '`') {
        result += text[i]
        i++
        continue
      }
      let openLen = 0
      while (i + openLen < text.length && text[i + openLen] === '`') openLen++
      let j = i + openLen
      let closeIdx = -1
      while (j < text.length && text[j] !== '\n') {
        if (text[j] === '`') {
          let closeLen = 0
          while (j + closeLen < text.length && text[j + closeLen] === '`') closeLen++
          if (closeLen === openLen) { closeIdx = j; break }
          j += closeLen
        } else {
          j++
        }
      }
      if (closeIdx === -1) {
        result += text.slice(i, i + openLen)
        i += openLen
      } else {
        const content = maskAngles(text.slice(i + openLen, closeIdx))
        result += text.slice(i, i + openLen) + content + text.slice(closeIdx, closeIdx + openLen)
        i = closeIdx + openLen
      }
    }
    return result
  }).join('')
}

/**
 * Restore `PIPE_MARKER` back to `|`, and `LT_MARKER`/`GT_MARKER` back to
 * `<`/`>`, in a string. No-op if no marker is present (the common case), so
 * cheap to call blanket.
 */
function restorePipeMarkers(s: string): string {
  let out = s
  if (out.indexOf(PIPE_MARKER) !== -1) out = out.split(PIPE_MARKER).join('|')
  if (out.indexOf(LT_MARKER) !== -1) out = out.split(LT_MARKER).join('<')
  if (out.indexOf(GT_MARKER) !== -1) out = out.split(GT_MARKER).join('>')
  return out
}

/**
 * Walk an MdxNode tree and restore `PIPE_MARKER` to `|` in every string
 * field that could carry the marker (html content, string props, children).
 */
function restorePipeMarkersInNodes(nodes: MdxNode[]): void {
  for (const node of nodes) {
    if (node.content) node.content = restorePipeMarkers(node.content)
    if (node.props) {
      for (const key of Object.keys(node.props)) {
        const v = node.props[key]
        if (typeof v === 'string') node.props[key] = restorePipeMarkers(v)
      }
    }
    if (node.children && node.children.length > 0) restorePipeMarkersInNodes(node.children)
  }
}

function splitByCodeFences(markdown: string): Array<{ text: string; isCode: boolean }> {
  const fencedCodeRegex = /(^|\n)((`{3,}|~{3,}).*\n[\s\S]*?\n\3\s*(?:\n|$))/g
  const segments: Array<{ text: string; isCode: boolean }> = []
  let lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = fencedCodeRegex.exec(markdown)) !== null) {
    const codeStart = match.index + (match[1]?.length || 0)
    if (codeStart > lastIndex) {
      segments.push({ text: markdown.slice(lastIndex, codeStart), isCode: false })
    }
    segments.push({ text: match[2], isCode: true })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < markdown.length) {
    segments.push({ text: markdown.slice(lastIndex), isCode: false })
  }

  return segments
}

function preprocessJsxExpressions(markdown: string): string {
  // Split markdown into fenced code blocks and non-code segments.
  // Only process JSX expressions in non-code segments to avoid corrupting code examples.
  const segments = splitByCodeFences(markdown)

  // Build a pattern that matches known component tag names (case-insensitive for safety)
  const allNames = [...new Set([
    ...Object.values(COMPONENT_TAG_MAP),
    ...Object.keys(COMPONENT_TAG_MAP),
  ])].join('|')

  // Regex to find tag starts — the actual tag end is found by the scanner below,
  // because a simple [^>] regex breaks on `>` inside JSX expressions (e.g. Mermaid's `-->`).
  const tagStartRegex = new RegExp(
    `<((?:${allNames}))(?=\\s|/?>)`,
    'gi'
  )

  // Map of HTML5 element names that need renaming to avoid parser collisions.
  // <image> → <img> (HTML5 spec), <math> → MathML namespace switch.
  const HTML5_RENAMES: Record<string, string> = {
    image: 'specra-image',
    math: 'specra-math',
  }

  // Only process non-code segments
  return segments.map(({ text, isCode }) => {
    if (isCode) return text

    let processed = ''
    let lastEnd = 0

    // Reset regex state for each segment
    tagStartRegex.lastIndex = 0
    let startMatch: RegExpExecArray | null
    while ((startMatch = tagStartRegex.exec(text)) !== null) {
      const tagStart = startMatch.index
      const tagName = startMatch[1]

      // Scan forward from after the tag name to find the tag end,
      // properly handling quotes, template literals, and brace expressions.
      let pos = tagStart + startMatch[0].length
      let inDoubleQuote = false
      let inSingleQuote = false
      let inTemplateLiteral = false
      let braceDepth = 0
      let tagEnd = -1
      let isSelfClosing = false

      while (pos < text.length) {
        const ch = text[pos]

        if (inDoubleQuote) {
          if (ch === '\\') pos++ // skip escaped char
          else if (ch === '"') inDoubleQuote = false
        } else if (inSingleQuote) {
          if (ch === '\\') pos++ // skip escaped char
          else if (ch === "'") inSingleQuote = false
        } else if (inTemplateLiteral) {
          if (ch === '\\') pos++ // skip escaped char
          else if (ch === '`') inTemplateLiteral = false
        } else if (braceDepth > 0) {
          if (ch === '{') braceDepth++
          else if (ch === '}') braceDepth--
          else if (ch === '"') inDoubleQuote = true
          else if (ch === "'") inSingleQuote = true
          else if (ch === '`') inTemplateLiteral = true
        } else {
          // Top level of tag attributes
          if (ch === '"') inDoubleQuote = true
          else if (ch === "'") inSingleQuote = true
          else if (ch === '{') braceDepth++
          else if (ch === '/' && text[pos + 1] === '>') {
            isSelfClosing = true
            tagEnd = pos + 2
            break
          } else if (ch === '>') {
            tagEnd = pos + 1
            break
          }
        }
        pos++
      }

      if (tagEnd === -1) continue // Unclosed tag, skip

      // Extract attributes between tag name and closing >
      const attrsStart = tagStart + startMatch[0].length
      const attrsEnd = isSelfClosing ? tagEnd - 2 : tagEnd - 1
      const attrs = text.slice(attrsStart, attrsEnd)

      // Process JSX expression attributes (name={...}) into HTML-safe string attributes
      let result = ''
      let aPos = 0
      while (aPos < attrs.length) {
        const attrMatch = attrs.slice(aPos).match(/^(\w+)=\{/)
        if (attrMatch) {
          const attrName = attrMatch[1]
          const braceStart2 = aPos + attrMatch[0].length
          // Find matching closing brace, handling nesting + quotes
          let depth = 1
          let inDQ = false, inSQ = false, inTL = false
          let j = braceStart2
          for (; j < attrs.length && depth > 0; j++) {
            const c = attrs[j]
            if (inDQ) { if (c === '\\') j++; else if (c === '"') inDQ = false }
            else if (inSQ) { if (c === '\\') j++; else if (c === "'") inSQ = false }
            else if (inTL) { if (c === '\\') j++; else if (c === '`') inTL = false }
            else {
              if (c === '{') depth++
              else if (c === '}') depth--
              else if (c === '"') inDQ = true
              else if (c === "'") inSQ = true
              else if (c === '`') inTL = true
            }
          }
          if (depth === 0) {
            const expression = attrs.slice(braceStart2, j - 1)
            // Encode " and newlines so the value survives HTML attribute parsing
            // and the multiline-collapsing step. parse5 decodes &#10; back to \n.
            const escaped = expression.replace(/"/g, '&quot;').replace(/\n/g, '&#10;')
            result += `${attrName}="__jsx:${escaped}"`
            aPos = j
          } else {
            result += attrs[aPos]
            aPos++
          }
        } else {
          result += attrs[aPos]
          aPos++
        }
      }

      // Collapse multiline attributes to a single line so remark-parse
      // recognizes the tag as inline HTML.
      result = result.replace(/\s*\n\s*/g, ' ')

      // Rename tags that collide with HTML5 built-in elements
      const rename = HTML5_RENAMES[tagName.toLowerCase()]
      const safeName = rename || tagName
      const safeOpen = `<${safeName}`

      // Add text before this tag
      processed += text.slice(lastEnd, tagStart)

      // Emit the processed tag
      if (isSelfClosing) {
        // Convert self-closing to explicit open+close (HTML5 doesn't honor />
        // on non-void elements — it swallows subsequent siblings as children).
        processed += `${safeOpen}${result}></${safeName}>`
      } else {
        processed += `${safeOpen}${result}>`
      }

      lastEnd = tagEnd
      // Advance regex past this tag to avoid re-matching inside attrs
      tagStartRegex.lastIndex = tagEnd
    }

    // Add remaining text
    processed += text.slice(lastEnd)

    // Rename closing tags to match the opening tag renames
    processed = processed.replace(/<\/Image\s*>/gi, '</specra-image>')
    processed = processed.replace(/<\/Math\s*>/gi, '</specra-math>')

    // Convert JSX string children to a `children` prop attribute.
    // In JSX, <Math>{"E = mc^2"}</Math> passes the string as children.
    // In Svelte, slot content is not a string prop, so we convert it to an attribute.
    const jsxChildrenRegex = new RegExp(
      `(<(?:${allNames})[^>]*>)\\s*\\{\\s*(["'])([\\s\\S]*?)\\2\\s*\\}\\s*(<\\/(?:${allNames})\\s*>)`,
      'gi'
    )
    processed = processed.replace(jsxChildrenRegex, (_match, openTag: string, _quote: string, content: string, closeTag: string) => {
      // Unescape JavaScript string escape sequences (e.g. \\ → \, \n → newline)
      const unescaped = content.replace(/\\(.)/g, (_: string, ch: string) => {
        switch (ch) {
          case 'n': return '\n'
          case 't': return '\t'
          case 'r': return '\r'
          case '\\': return '\\'
          case '"': return '"'
          case "'": return "'"
          default: return ch
        }
      })
      // Escape for HTML attribute value
      const escaped = unescaped.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      // Inject children prop into the opening tag
      const newOpenTag = openTag.slice(0, -1) + ` children="${escaped}">`
      return `${newOpenTag}${closeTag}`
    })

    return processed
  }).join('')
}

/**
 * Parse a JSX expression string into a JavaScript value.
 * Handles objects like `{ sm: 1, md: 2 }`, numbers, booleans, and strings.
 */
function parseJsxExpression(expr: string): any {
  const trimmed = expr.trim()

  // Number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed)
  }

  // Boolean
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false

  // null/undefined
  if (trimmed === 'null') return null
  if (trimmed === 'undefined') return undefined

  // String literal (quoted or template literal)
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('`') && trimmed.endsWith('`'))) {
    return trimmed.slice(1, -1)
  }

  // Object literal like { sm: 1, md: 2 }
  // Convert JS object syntax to JSON: add quotes around keys
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      // Try direct JSON parse first
      return JSON.parse(trimmed)
    } catch {
      // Convert JS object notation to JSON: { sm: 1, md: 2 } → {"sm": 1, "md": 2}
      const jsonStr = trimmed.replace(
        /(\w+)\s*:/g,
        '"$1":'
      ).replace(
        /:\s*'([^']*)'/g,
        ': "$1"'
      )
      try {
        return JSON.parse(jsonStr)
      } catch {
        return trimmed
      }
    }
  }

  // Array literal
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // Convert JS object notation inside arrays to JSON
      const jsonStr = trimmed.replace(
        /(\w+)\s*:/g,
        '"$1":'
      ).replace(
        /:\s*'([^']*)'/g,
        ': "$1"'
      )
      try {
        return JSON.parse(jsonStr)
      } catch {
        return trimmed
      }
    }
  }

  return trimmed
}

/**
 * Process markdown content to HTML using remark/rehype pipeline.
 */
function normalizeBasePath(bp: string): string {
  if (!bp) return ''
  let normalized = bp.startsWith('/') ? bp : `/${bp}`
  return normalized.replace(/\/+$/, '')
}

function resolveDeploymentBasePath(): string {
  if (process.env.BASE_PATH) return normalizeBasePath(process.env.BASE_PATH)
  try {
    const configPath = path.join(process.cwd(), 'specra.config.json')
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (raw.deployment?.basePath && !raw.deployment?.customDomain) {
        return normalizeBasePath(raw.deployment.basePath)
      }
    }
  } catch { /* ignore */ }
  return ''
}

async function processMarkdownToHtml(markdown: string): Promise<string> {
  const basePath = resolveDeploymentBasePath()
  const masked = maskInlineCodePipes(markdown)

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkCodeMeta)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeKatex)

  if (basePath) {
    processor.use(rehypeBasePath, { basePath })
  }

  const result = await processor
    .use(rehypeStringify)
    .process(masked)

  return restorePipeMarkers(String(result))
}

/**
 * Convert hast properties to component props with correct casing.
 * Also parses back JSX expression values that were encoded during preprocessing.
 */
function convertProps(properties: Record<string, any>): Record<string, any> {
  const props: Record<string, any> = {}
  for (const [key, value] of Object.entries(properties)) {
    const propName = PROP_NAME_MAP[key] || key
    // HTML boolean attributes come through as empty strings
    if (value === '' || value === true) {
      props[propName] = true
    } else if (typeof value === 'string' && value.startsWith('__jsx:')) {
      // Parse back JSX expressions that were encoded during preprocessing
      const expression = value.slice(6).replace(/&quot;/g, '"').replace(/&#10;/g, '\n')
      props[propName] = parseJsxExpression(expression)
    } else {
      props[propName] = value
    }
  }
  return props
}

/**
 * Check if a hast node is a component element (custom tag).
 */
function isComponentElement(node: any): boolean {
  return node.type === 'element' && COMPONENT_TAG_MAP[node.tagName] !== undefined
}

/**
 * Check if a hast node is a fenced code block (<pre><code class="language-*">).
 * Returns the extracted props for CodeBlock if it is, or null otherwise.
 */
function extractCodeBlockProps(node: any): { code: string; language: string; filename?: string; showLineNumbers?: boolean; diff?: boolean } | null {
  if (node.type !== 'element' || node.tagName !== 'pre') return null
  const codeChild = node.children?.find((c: any) => c.type === 'element' && c.tagName === 'code')
  if (!codeChild) return null

  // Extract language from className like ['language-javascript']
  const classNames: string[] = codeChild.properties?.className || []
  const langClass = classNames.find((c: string) => typeof c === 'string' && c.startsWith('language-'))
  const language = langClass ? langClass.replace('language-', '') : 'txt'

  // Extract text content from the code element
  const code = extractTextContent(codeChild).replace(/\n$/, '')

  // Read attributes set by remark-code-meta from the fence meta. rehypeRaw
  // normalises `data-foo` to the camel-cased `dataFoo` hast property, so accept
  // both spellings, on either the <pre> or the <code>.
  const readDataAttr = (camel: string, kebab: string): any =>
    node.properties?.[camel] ?? node.properties?.[kebab] ??
    codeChild.properties?.[camel] ?? codeChild.properties?.[kebab]

  const filename = readDataAttr('dataFilename', 'data-filename')
  const lineNumbers = readDataAttr('dataLineNumbers', 'data-line-numbers')
  const showLineNumbers = lineNumbers === 'true' || lineNumbers === true || lineNumbers === ''
  const diffAttr = readDataAttr('dataDiff', 'data-diff')
  const diff = diffAttr === 'true' || diffAttr === true || diffAttr === ''

  return {
    code,
    language,
    ...(filename ? { filename } : {}),
    ...(showLineNumbers ? { showLineNumbers: true } : {}),
    ...(diff ? { diff: true } : {}),
  }
}

/**
 * Detect GitHub-style alert blockquotes: > [!WARNING] content
 * Returns the alert type and remaining content children, or null if not an alert.
 */
const ALERT_TYPE_MAP: Record<string, string> = {
  NOTE: 'note',
  TIP: 'tip',
  IMPORTANT: 'info',
  WARNING: 'warning',
  CAUTION: 'danger',
  INFO: 'info',
  SUCCESS: 'success',
  ERROR: 'error',
  DANGER: 'danger',
}

function extractBlockquoteAlert(node: any): { type: string; contentChildren: any[] } | null {
  if (node.type !== 'element' || node.tagName !== 'blockquote') return null
  if (!node.children || node.children.length === 0) return null

  // Find the first paragraph child
  const firstP = node.children.find((c: any) => c.type === 'element' && c.tagName === 'p')
  if (!firstP || !firstP.children || firstP.children.length === 0) return null

  // Check first text node for [!TYPE] pattern
  const firstText = firstP.children[0]
  if (firstText.type !== 'text') return null

  const match = firstText.value.match(/^\s*\[!(\w+)\]\s*\n?/)
  if (!match) return null

  const alertType = ALERT_TYPE_MAP[match[1].toUpperCase()]
  if (!alertType) return null

  // Build remaining content: modify the first paragraph to remove the alert marker
  const remainingFirstPChildren = [...firstP.children]
  const remainingText = firstText.value.slice(match[0].length)
  if (remainingText.trim()) {
    remainingFirstPChildren[0] = { ...firstText, value: remainingText }
  } else {
    remainingFirstPChildren.shift()
  }

  const contentChildren: any[] = []
  if (remainingFirstPChildren.length > 0) {
    contentChildren.push({ ...firstP, children: remainingFirstPChildren })
  }
  // Add any remaining blockquote children (paragraphs after the first)
  for (const child of node.children) {
    if (child !== firstP) {
      contentChildren.push(child)
    }
  }

  return { type: alertType, contentChildren }
}

/**
 * Recursively extract text content from a hast node.
 */
function extractTextContent(node: any): string {
  if (node.type === 'text') return node.value || ''
  if (node.children) {
    return node.children.map((c: any) => extractTextContent(c)).join('')
  }
  return ''
}

/**
 * Check if hast children contain raw markdown text that needs re-processing.
 * This happens when markdown content is inside custom component tags —
 * the HTML parser treats it as plain text instead of parsing it as markdown.
 */
function childrenContainMarkdownText(children: any[]): boolean {
  for (const child of children) {
    if (child.type === 'text' && child.value) {
      const text = child.value.trim()
      if (!text) continue
      // Check for markdown patterns: headings, bold, italic, links, lists
      // Text nodes inside HTML-parsed component tags often start with \n + whitespace
      if (/(?:^|\n)\s*#{1,6}\s/.test(child.value) ||  // headings
          /\*\*/.test(text) ||                          // bold
          /\[.*\]\(/.test(text) ||                      // links
          /(?:^|\n)\s*[-*+]\s/.test(child.value) ||     // unordered lists
          /(?:^|\n)\s*\d+\.\s/.test(child.value) ||     // ordered lists
          /(?:^|\n)\s*(`{3,}|~{3,})/.test(child.value) || // fenced code blocks
          (text.length > 10 && /\n/.test(text.trim()))   // multi-line text content (paragraphs)
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * Remove common leading whitespace from all lines in a text block.
 * This is necessary because markdown content inside component tags
 * inherits indentation from the MDX formatting, and 4+ spaces of
 * indentation would cause remark to treat lines as code blocks.
 */
function dedent(text: string): string {
  const lines = text.split('\n')
  // Find the minimum indentation of non-empty lines
  let minIndent = Infinity
  for (const line of lines) {
    if (line.trim().length === 0) continue
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0
    if (indent < minIndent) minIndent = indent
  }
  if (minIndent === 0 || minIndent === Infinity) return text
  // Strip the common indent from all lines
  return lines.map(line => line.slice(minIndent)).join('\n')
}

/**
 * Check if a text buffer currently has an unclosed fenced code block.
 * Returns the fence marker (e.g. "```") if inside a code fence, or null otherwise.
 */
function getOpenCodeFence(text: string): string | null {
  const lines = text.split('\n')
  let openFence: string | null = null
  for (const line of lines) {
    if (openFence) {
      // Check if this line closes the fence (same or more chars of same type)
      const trimmed = line.trim()
      if (trimmed.startsWith(openFence) && /^(`{3,}|~{3,})\s*$/.test(trimmed)) {
        openFence = null
      }
    } else {
      // Check if this line opens a fence
      const fenceMatch = line.match(/^(`{3,}|~{3,})/)
      if (fenceMatch) {
        openFence = fenceMatch[1]
      }
    }
  }
  return openFence
}

/**
 * Serialize a hast element back to its original tag text representation.
 * Used to reconstruct component/element tags as plain text when they
 * appear inside fenced code blocks (where they should be code, not components).
 */
function hastElementToText(node: any): string {
  const tagName = node.tagName || 'div'
  // Restore PascalCase for known components
  const displayName = COMPONENT_TAG_MAP[tagName] || tagName
  const props = node.properties || {}
  const attrs = Object.entries(props)
    .filter(([key]) => key !== 'className' || (props[key] as string[])?.length > 0)
    .map(([key, value]) => {
      if (value === true || value === '') return key
      if (typeof value === 'string' && value.startsWith('__jsx:')) {
        // Restore JSX expression syntax
        const expr = value.slice(6).replace(/&quot;/g, '"').replace(/&#10;/g, '\n')
        return `${key}={${expr}}`
      }
      return `${key}="${value}"`
    })
    .join(' ')
  const openTag = attrs ? `<${displayName} ${attrs}>` : `<${displayName}>`
  const childText = (node.children || []).map((c: any) => {
    if (c.type === 'text') return c.value || ''
    if (c.type === 'element') return hastElementToText(c)
    return ''
  }).join('')
  return `${openTag}${childText}</${displayName}>`
}

/**
 * Extract raw text from hast children, preserving component tags as placeholders.
 * Returns the markdown text and a map of placeholders to component MdxNodes.
 *
 * Tracks open code fences in the text buffer: if the buffer contains an unclosed
 * fenced code block (e.g. ``` opened but not closed), subsequent component/element
 * children are serialized back to text instead of being processed as real components.
 * This prevents component tags inside code examples from rendering as live components.
 */
async function processComponentChildren(children: any[]): Promise<MdxNode[]> {
  // Separate text runs from component/element children.
  // For sequences of text-only nodes, re-process through markdown.
  // For component elements, process recursively as before.
  const result: MdxNode[] = []
  let textBuffer = ''

  async function flushTextBuffer() {
    if (textBuffer.trim()) {
      // Dedent the text to remove inherited indentation from MDX formatting,
      // otherwise 4+ space indented lines get parsed as code blocks
      const dedented = dedent(textBuffer)

      // Re-process accumulated text through the markdown pipeline
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkMath)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
        .use(rehypeSlug)
        .use(rehypeKatex)

      const mdast = processor.parse(dedented)
      const hast = await processor.run(mdast)
      const processedChildren = (hast as any).children || []
      // These children are now proper HTML elements (headings, paragraphs, etc.)
      const nodes = await hastChildrenToMdxNodes(processedChildren)
      result.push(...nodes)
    }
    textBuffer = ''
  }

  for (const child of children) {
    if (child.type === 'text') {
      textBuffer += child.value || ''
    } else if (isComponentElement(child) || child.type === 'element') {
      // Check if we're inside an unclosed code fence in the text buffer.
      // If so, this element is part of a code example — serialize it back
      // to text rather than processing it as a real component.
      const openFence = getOpenCodeFence(textBuffer)
      if (openFence) {
        // We're inside a code fence — serialize this element as text
        textBuffer += hastElementToText(child)
      } else if (isComponentElement(child)) {
        await flushTextBuffer()
        const componentName = COMPONENT_TAG_MAP[child.tagName]
        const props = convertProps(child.properties || {})
        const childNodes = child.children && child.children.length > 0
          ? await processSmartChildren(child.children)
          : []
        result.push({
          type: 'component',
          name: componentName,
          props,
          children: childNodes,
        })
      } else {
        // Regular HTML element inside a component — flush text first, then serialize
        await flushTextBuffer()
        const codeBlockProps = extractCodeBlockProps(child)
        if (codeBlockProps) {
          result.push({
            type: 'component',
            name: 'CodeBlock',
            props: codeBlockProps,
            children: [],
          })
        } else if (hasNestedComponent(child)) {
          const openTag = toHtml({ ...child, children: [] }).replace(/<\/[^>]+>$/, '')
          result.push({ type: 'html', content: openTag })
          result.push(...await processSmartChildren(child.children))
          result.push({ type: 'html', content: `</${child.tagName}>` })
        } else {
          const html = toHtml(child).trim()
          if (html) {
            result.push({ type: 'html', content: html })
          }
        }
      }
    }
  }

  await flushTextBuffer()
  return result
}

/**
 * Smart child processing: detects if children contain raw markdown text
 * and re-processes it through the markdown pipeline if needed.
 */
async function processSmartChildren(children: any[]): Promise<MdxNode[]> {
  if (childrenContainMarkdownText(children)) {
    return processComponentChildren(children)
  }
  return hastChildrenToMdxNodes(children)
}

/**
 * Recursively convert hast children to MdxNode array.
 * Groups consecutive non-component nodes into single HTML blocks.
 */
async function hastChildrenToMdxNodes(children: any[]): Promise<MdxNode[]> {
  const nodes: MdxNode[] = []
  let htmlBuffer: any[] = []

  function flushHtmlBuffer() {
    if (htmlBuffer.length > 0) {
      const html = toHtml({ type: 'root', children: htmlBuffer })
      const trimmed = html.trim()
      if (trimmed) {
        nodes.push({ type: 'html', content: trimmed })
      } else if (html.includes(' ') && !html.includes('\n')) {
        // Preserve horizontal whitespace between elements (e.g., spaces between inline components).
        // Newline-only whitespace is formatting and can be discarded.
        nodes.push({ type: 'html', content: ' ' })
      }
      htmlBuffer = []
    }
  }

  for (const child of children) {
    // Check for fenced code blocks first (<pre><code class="language-*">)
    const codeBlockProps = extractCodeBlockProps(child)
    if (codeBlockProps) {
      flushHtmlBuffer()
      nodes.push({
        type: 'component',
        name: 'CodeBlock',
        props: codeBlockProps,
        children: [],
      })
    } else if (isComponentElement(child)) {
      flushHtmlBuffer()
      const componentName = COMPONENT_TAG_MAP[child.tagName]
      const props = convertProps(child.properties || {})
      const childNodes = child.children && child.children.length > 0
        ? await processSmartChildren(child.children)
        : []
      nodes.push({
        type: 'component',
        name: componentName,
        props,
        children: childNodes,
      })
    } else if (extractBlockquoteAlert(child)) {
      // GitHub-style alert blockquotes: > [!WARNING] content
      flushHtmlBuffer()
      const alert = extractBlockquoteAlert(child)!
      const contentNodes = alert.contentChildren.length > 0
        ? await hastChildrenToMdxNodes(alert.contentChildren)
        : []
      nodes.push({
        type: 'component',
        name: 'Callout',
        props: { type: alert.type },
        children: contentNodes,
      })
    } else {
      // Check if this regular element contains any component elements nested within
      if (hasNestedComponent(child)) {
        flushHtmlBuffer()
        // This is a regular HTML element that contains component children
        // We need to handle it specially - wrap it as an HTML open tag,
        // then process children, then close tag
        if (child.type === 'element') {
          const openTag = toHtml({ ...child, children: [] }).replace(/<\/[^>]+>$/, '')
          nodes.push({ type: 'html', content: openTag })
          nodes.push(...await hastChildrenToMdxNodes(child.children))
          nodes.push({ type: 'html', content: `</${child.tagName}>` })
        } else {
          htmlBuffer.push(child)
        }
      } else {
        htmlBuffer.push(child)
      }
    }
  }

  flushHtmlBuffer()
  return nodes
}

/**
 * Check if a hast node or any of its descendants is a component element.
 */
function hasNestedComponent(node: any): boolean {
  if (isComponentElement(node)) return true
  if (node.children) {
    return node.children.some((child: any) => hasNestedComponent(child))
  }
  return false
}

/**
 * Process markdown content to a structured MdxNode tree.
 * Runs the same remark/rehype pipeline but produces an AST
 * instead of a stringified HTML output.
 */
/**
 * Dedent content inside component tags before remark processing.
 * In CommonMark, 4+ spaces of indentation create code blocks.
 * When users indent content inside component tags (e.g. <Tabs> inside <Step>),
 * the inherited indentation causes remark to misinterpret child tags and
 * markdown as indented code blocks. This strips common leading indentation
 * from the content between known component open/close tags.
 *
 * Only processes the outermost component tags (those not nested inside another
 * known component). Inner components are handled naturally since their parent's
 * dedent removes the shared indentation.
 */
/**
 * Identify which lines in a text block are inside fenced code blocks.
 * Returns a Set of line indices (0-based) that are inside code fences.
 */
function getCodeFenceLineIndices(lines: string[]): Set<number> {
  const indices = new Set<number>()
  let openFence: string | null = null
  let openIndex = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (openFence) {
      indices.add(i)
      const trimmed = line.trim()
      if (trimmed.startsWith(openFence) && new RegExp(`^${openFence[0]}{${openFence.length},}\\s*$`).test(trimmed)) {
        openFence = null
      }
    } else {
      const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/)
      if (fenceMatch) {
        openFence = fenceMatch[2]
        openIndex = i
        indices.add(i)
      }
    }
  }
  return indices
}

function dedentComponentChildren(markdown: string): string {
  // Build a single regex that matches any known component opening tag
  const allNames = [...new Set([
    ...Object.values(COMPONENT_TAG_MAP),
    ...Object.keys(COMPONENT_TAG_MAP),
  ])]
  const namesPattern = allNames.join('|')

  // Find outermost component blocks and dedent their entire content
  // (including nested component tags) so remark doesn't misinterpret indentation.
  const openTagRegex = new RegExp(
    `(<(?:${namesPattern})(?:\\s[^>]*)?>)(\\n)`,
    'gi'
  )

  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  openTagRegex.lastIndex = 0
  while ((match = openTagRegex.exec(markdown)) !== null) {
    // Skip if this tag is nested inside a previously processed block
    if (match.index < lastIndex) continue

    const tagName = match[1].match(/<(\w+)/)?.[1]
    if (!tagName) continue

    const contentStart = match.index + match[0].length

    // Find the matching closing tag, handling nesting of the SAME tag
    const closeTagRegex = new RegExp(`</${tagName}\\s*>`, 'gi')
    const openNestRegex = new RegExp(`<${tagName}(?:\\s[^>]*)?>`, 'gi')

    closeTagRegex.lastIndex = contentStart
    openNestRegex.lastIndex = contentStart

    let depth = 1
    let closeMatch: RegExpExecArray | null = null

    while (depth > 0 && (closeMatch = closeTagRegex.exec(markdown)) !== null) {
      // Count any nested opens of the same tag before this close
      while (true) {
        const nested = openNestRegex.exec(markdown)
        if (!nested || nested.index >= closeMatch.index) {
          openNestRegex.lastIndex = closeMatch.index + closeMatch[0].length
          break
        }
        depth++
      }
      depth--
    }

    if (!closeMatch) continue

    const contentEnd = closeMatch.index
    const innerContent = markdown.slice(contentStart, contentEnd)

    // Find minimum indentation of non-empty lines that are NOT inside code fences.
    // Lines inside code fences (including fence markers and their content) are
    // excluded so that code at indent 0 doesn't prevent dedenting of component content.
    const lines = innerContent.split('\n')
    const codeFenceLines = getCodeFenceLineIndices(lines)
    let minIndent = Infinity
    for (let i = 0; i < lines.length; i++) {
      if (codeFenceLines.has(i)) continue
      const line = lines[i]
      if (line.trim().length === 0) continue
      const indent = line.match(/^(\s*)/)?.[1].length ?? 0
      if (indent > 0 && indent < minIndent) minIndent = indent
    }

    if (minIndent > 0 && minIndent !== Infinity) {
      // Dedent every non-empty line by the common indent, including code-fence
      // lines and their content. Code lines are excluded from the min-indent
      // *calculation* above (so a column-0 code line doesn't pin minIndent to 0),
      // but they must still be dedented here: leaving an indented fence at its
      // original column (e.g. 4 spaces) turns it into a CommonMark *indented*
      // code block (fences allow <=3 spaces of indent), which renders the raw
      // ```lang fence literally. The Math.min cap strips only the shared wrapper
      // indent, never a line's meaningful internal indentation.
      const dedented = lines.map((line) => {
        if (line.trim().length === 0) return line
        return line.slice(Math.min(minIndent, line.match(/^(\s*)/)?.[1].length ?? 0))
      }).join('\n')

      result += markdown.slice(lastIndex, contentStart) + dedented
      lastIndex = contentEnd
      // Advance past this entire component block
      openTagRegex.lastIndex = closeMatch.index + closeMatch[0].length
    }
  }

  if (lastIndex > 0) {
    result += markdown.slice(lastIndex)
    markdown = result
    // Re-run to handle inner components that were previously skipped
    // (e.g. <Step> inside <Steps> now has reduced indentation that needs further dedenting)
    return dedentComponentChildren(markdown)
  }

  return markdown
}

/**
 * Collapse blank lines inside component blocks so remark-parse treats the
 * entire component (from opening to closing tag) as a single HTML block.
 *
 * In CommonMark, a blank line inside an HTML block (type 6) ends the block.
 * This causes remark to split component content into separate blocks, and
 * plain text between child components becomes a `<p>` element that disrupts
 * parse5's handling of unknown element nesting (siblings become children).
 *
 * By removing blank lines inside component blocks, the entire component tree
 * stays as one HTML block that parse5 can parse correctly.
 */
function ensureComponentBlockIntegrity(markdown: string): string {
  const allNames = [...new Set([
    ...Object.values(COMPONENT_TAG_MAP),
    ...Object.keys(COMPONENT_TAG_MAP),
  ])]
  const namesPattern = allNames.join('|')

  // Find outermost component blocks and collapse blank lines within them
  const openTagRegex = new RegExp(
    `^(\\s*<(?:${namesPattern})(?:\\s[^>]*)?>)\\s*$`,
    'gim'
  )

  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  openTagRegex.lastIndex = 0
  while ((match = openTagRegex.exec(markdown)) !== null) {
    // Skip if inside a previously processed block
    if (match.index < lastIndex) continue

    const tagName = match[1].match(/<(\w+)/)?.[1]
    if (!tagName) continue

    const blockStart = match.index

    // Find matching closing tag, handling nesting
    const closeTagRegex = new RegExp(`</${tagName}\\s*>`, 'gi')
    const openNestRegex = new RegExp(`<${tagName}(?:\\s[^>]*)?>`, 'gi')

    closeTagRegex.lastIndex = match.index + match[0].length
    openNestRegex.lastIndex = match.index + match[0].length

    let depth = 1
    let closeMatch: RegExpExecArray | null = null

    while (depth > 0 && (closeMatch = closeTagRegex.exec(markdown)) !== null) {
      while (true) {
        const nested = openNestRegex.exec(markdown)
        if (!nested || nested.index >= closeMatch.index) {
          openNestRegex.lastIndex = closeMatch.index + closeMatch[0].length
          break
        }
        depth++
      }
      depth--
    }

    if (!closeMatch) continue

    const blockEnd = closeMatch.index + closeMatch[0].length
    const block = markdown.slice(blockStart, blockEnd)

    // Replace blank/whitespace-only lines (outside code fences) with HTML
    // comments so remark doesn't end the HTML block at those points.
    // In CommonMark, a blank line inside an HTML type-6 block ends the block.
    // An HTML comment on the line prevents this while being invisible in output.
    // Replace ALL blank/whitespace-only lines with HTML comments — even inside
    // code fences. The code fence content is raw text inside the HTML block and
    // will be re-processed by processComponentChildren through the markdown
    // pipeline, which restores proper code formatting.
    // Mask `<`/`>` written inside code (inline spans and fences) BEFORE the
    // blank-line collapse turns this whole block into one raw HTML block.
    // Once it is raw HTML, markdown code markers no longer protect their
    // contents, and a documented tag like `<script src="...">` reaches parse5
    // as real HTML — a raw-text element that never closes and swallows every
    // sibling after the component, heading and all. Restored by
    // `restorePipeMarkers` once the children are re-parsed as markdown.
    const collapsed = maskCodeAngleBrackets(block).replace(/^\s*$/gm, '<!-- -->')

    result += markdown.slice(lastIndex, blockStart) + collapsed
    lastIndex = blockEnd
    openTagRegex.lastIndex = blockEnd
  }

  if (lastIndex > 0) {
    result += markdown.slice(lastIndex)
    return result
  }

  return markdown
}

export async function processMarkdownToMdxNodes(markdown: string): Promise<MdxNode[]> {
  // Mask pipes inside inline code spans so GFM tables containing
  // `{{ x | filter }}`-style code don't get their rows broken.
  const masked = maskInlineCodePipes(markdown)

  // Pre-process JSX expression attributes into HTML-safe string attributes
  const preprocessed = preprocessJsxExpressions(masked)

  // Dedent content inside component tags so that indented children
  // (e.g. <Tabs> inside <Step>) don't get treated as code blocks
  // by remark-parse (4+ spaces = indented code in CommonMark).
  const dedented = dedentComponentChildren(preprocessed)

  // Ensure component block integrity in the markdown
  const normalized = ensureComponentBlockIntegrity(dedented)

  const basePath = resolveDeploymentBasePath()

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkCodeMeta)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
    // After rehypeSlug so the intent is obvious: replay the heading sequence
    // through a second slugger, then anchor each <Update> in that namespace.
    .use(rehypeChangelogIds)
    .use(rehypeKatex)

  if (basePath) {
    processor.use(rehypeBasePath, { basePath })
  }

  const mdast = processor.parse(normalized)
  const hast = await processor.run(mdast)

  // The hast root has children - process them into MdxNodes
  const children = (hast as any).children || []
  const nodes = await hastChildrenToMdxNodes(children)
  restorePipeMarkersInNodes(nodes)

  // Union each <Changelog>'s child tags into `allTags`. Done here, on the
  // server, because children render after their parent during SSR — a filter
  // bar that waited for its updates to self-register would serialize empty.
  annotateChangelogNodes(nodes)

  return nodes
}

/**
 * Calculate reading time based on word count
 * Average reading speed: 200 words per minute
 */
function calculateReadingTime(content: string): { minutes: number; words: number } {
  const words = content.trim().split(/\s+/).length
  const minutes = Math.ceil(words / 200)
  return { minutes, words }
}

export interface DocMeta {
  title: string
  description?: string
  slug?: string
  section?: string
  group?: string
  sidebar?: string
  order?: number
  sidebar_position?: number
  content?: string
  last_updated?: string
  draft?: boolean
  authors?: Array<{ id: string; name?: string }>
  tags?: string[]
  redirect_from?: string[]
  reading_time?: number
  word_count?: number
  icon?: string  // Icon name for sidebar display (Lucide icon name)
  tab_group?: string  // Tab group ID for organizing docs into tabs
  badge?: BadgeInput  // Badge(s) shown next to this page in the sidebar
  rss?: boolean  // Publish this page's <Update> entries as an RSS feed at <page>/rss.xml
  locale?: string // Locale of the document
  protected?: boolean  // Whether this page requires social login to access
  isProtected?: boolean  // Whether this page requires authentication
}

export interface Doc {
  slug: string
  filePath: string  // Original file path for sidebar grouping
  title: string
  meta: DocMeta
  content: string
  contentNodes?: MdxNode[]  // Structured node tree for component rendering
  categoryLabel?: string  // Label from _category_.json
  categoryPosition?: number  // Position from _category_.json
  categoryCollapsible?: boolean  // Collapsible from _category_.json
  categoryCollapsed?: boolean  // Default collapsed state from _category_.json
  categoryIcon?: string  // Icon from _category_.json
  categoryTabGroup?: string  // Tab group from _category_.json
  categoryBadge?: BadgeInput  // Badge(s) from _category_.json
  locale?: string // Locale of the document
}

export interface TocItem {
  id: string
  title: string
  level: number
}

export function getVersions(product?: string): string[] {
  try {
    const baseDir = (product && product !== "_default_")
      ? path.join(DOCS_DIR, product)
      : DOCS_DIR
    const entries = fs.readdirSync(baseDir)
    return entries.filter((v) => {
      if (!fs.statSync(path.join(baseDir, v)).isDirectory()) return false
      // In the default product's base dir, skip product directories (those with _product_.json)
      if (!product || product === "_default_") {
        const hasProductJson = fs.existsSync(path.join(baseDir, v, "_product_.json"))
        if (hasProductJson) return false
      }
      return true
    })
  } catch (error) {
    return ["v1.0.0"]
  }
}

/**
 * Get versions scoped to a specific product.
 * Convenience wrapper around getVersions() for product-aware code.
 */
export function getProductVersions(product: string): string[] {
  return getVersions(product)
}

/**
 * Recursively find all MDX files in a directory
 */
function findMdxFiles(dir: string, baseDir: string = dir): string[] {
  const files: string[] = []

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        files.push(...findMdxFiles(fullPath, baseDir))
      } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
        // Get relative path from base directory and normalize to forward slashes
        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/')
        files.push(relativePath)
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error)
  }

  return files
}

/**
 * Internal function to read a doc from file path
 */
function readDocFromFile(filePath: string, originalSlug: string): Doc | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }

    // Validate path is within allowed directory
    if (!validatePathWithinDirectory(filePath, DOCS_DIR)) {
      console.error(`[Security] Path traversal attempt blocked: ${filePath}`)
      return null
    }

    const fileContents = fs.readFileSync(filePath, "utf8")
    const { data, content } = matter(fileContents, {
      engines: {
        yaml: {
          parse: (str: string) => yaml.load(str) as Record<string, unknown>,
          stringify: (obj: Record<string, unknown>) => yaml.dump(obj),
        },
      },
    })

    // Security: Validate MDX content for dangerous patterns
    const securityCheck = validateMDXSecurity(content, {
      strictMode: process.env.NODE_ENV === 'production',
      blockDangerousPatterns: true,
    })

    if (!securityCheck.valid) {
      console.error(`[Security] MDX validation failed for ${filePath}:`, securityCheck.issues)
      if (process.env.NODE_ENV === 'production') {
        return null
      }
      // In development, log warnings but continue
      console.warn('[Security] Continuing in development mode with sanitized content')
    }

    // Use sanitized content if available
    const safeContent = securityCheck.sanitized || content

    // Calculate reading time
    const { minutes, words } = calculateReadingTime(safeContent)

    // If custom slug provided, replace only the filename part, keep the folder structure
    let finalSlug = originalSlug
    if (data.slug) {
      const customSlug = data.slug.replace(/^\//, '')
      const parts = originalSlug.split("/")

      if (parts.length > 1) {
        // Keep folder structure, replace only filename
        parts[parts.length - 1] = customSlug
        finalSlug = parts.join("/")
      } else {
        // Root level file, use custom slug as-is
        finalSlug = customSlug
      }
    }

    return {
      slug: finalSlug,
      filePath: originalSlug,  // Keep original file path for sidebar
      title: data.title || originalSlug,
      meta: {
        ...data,
        content: safeContent,
        reading_time: minutes,
        word_count: words,
        ...(data.protected === true ? { isProtected: true } : {}),
      } as DocMeta,
      content: safeContent,
    }
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error)
    return null
  }
}

export function getI18nConfig(): I18nConfig | null {
  const config = getConfig()
  const i18n = config.features?.i18n

  if (!i18n) return null

  if (typeof i18n === 'boolean') {
    return i18n ? {
      defaultLocale: 'en',
      locales: ['en'],
      localeNames: { en: 'English' }
    } : null
  }

  return i18n
}

export async function getDocBySlug(slug: string, version = "v1.0.0", locale?: string, product?: string): Promise<Doc | null> {
  try {
    // Security: Sanitize and validate slug
    const sanitizedVersion = sanitizePath(version)
    let sanitizedSlug = sanitizePath(slug)

    // Get i18n config
    const i18nConfig = getI18nConfig()

    // Determine locale from slug if not provided
    let detectedLocale = locale || i18nConfig?.defaultLocale

    if (i18nConfig) {
      const parts = sanitizedSlug.split('/')
      if (parts.length > 0 && i18nConfig.locales.includes(parts[0])) {
        detectedLocale = parts[0]
        sanitizedSlug = parts.slice(1).join('/')
        if (sanitizedSlug === "") sanitizedSlug = "index"
      }
    }

    const targetLocale = detectedLocale
    const isDefaultLocale = targetLocale === i18nConfig?.defaultLocale

    // Try finding the file in this order:
    // 1. Localized extension: slug.locale.mdx (e.g. guide.fr.mdx)
    // 2. Default file: slug.mdx (only if using default locale and configured to fallback or strictly default)

    // Construct potential paths — product-aware
    const basePath = resolveDocsPath(sanitizedVersion, product)

    let result: Doc | null = null

    // 1. Try localized file extension
    if (targetLocale) {
      const localizedPath = path.join(basePath, `${sanitizedSlug}.${targetLocale}.mdx`)
      const doc = readDocFromFile(localizedPath, sanitizedSlug)
      if (doc) {
        doc.slug = i18nConfig ? `${targetLocale}/${sanitizedSlug}` : sanitizedSlug
        doc.meta.locale = targetLocale
        result = doc
      }
    }

    // 2. Try default file
    if (!result) {
      const defaultPath = path.join(basePath, `${sanitizedSlug}.mdx`)
      const doc = readDocFromFile(defaultPath, sanitizedSlug)

      if (doc && (isDefaultLocale || !i18nConfig)) {
        const usePrefix = i18nConfig && (i18nConfig.prefixDefault || targetLocale !== i18nConfig.defaultLocale)

        if (usePrefix && targetLocale) {
          doc.slug = `${targetLocale}/${doc.slug}`
        }
        doc.meta.locale = targetLocale || 'en'
        result = doc
      }
    }

    // Process markdown for the found doc
    if (result) {
      const rawContent = result.content
      result.content = await processMarkdownToHtml(rawContent)
      result.contentNodes = await processMarkdownToMdxNodes(rawContent)
    }

    return result
  } catch (error) {
    console.error(`Error reading doc ${slug}:`, error)
    return null
  }
}

export function getAllDocs(version = "v1.0.0", locale?: string, product?: string): Doc[] {
  try {
    const versionDir = resolveDocsPath(version, product)

    if (!fs.existsSync(versionDir)) {
      return []
    }

    // Get i18n config
    const i18nConfig = getI18nConfig()
    const targetLocale = locale || i18nConfig?.defaultLocale || 'en'

    const mdxFiles = findMdxFiles(versionDir)
    const categoryConfigs = getAllCategoryConfigs(version, product)

    const docs = mdxFiles.map((file) => {
        // file contains path relative to version dir, e.g. "getting-started/intro.mdx" or "intro.fr.mdx"

        let originalFilePath = file.replace(/\.mdx$/, "")

        // Handle localized files
        let isLocalized = false
        let fileLocale = i18nConfig?.defaultLocale || 'en'

        if (i18nConfig) {
          // Check for .<locale> suffix
          const parts = originalFilePath.split('.')
          const lastPart = parts[parts.length - 1]
          if (i18nConfig.locales.includes(lastPart)) {
            fileLocale = lastPart
            isLocalized = true
            originalFilePath = parts.slice(0, -1).join('.')
          }
        }

        // Read doc directly from file (no HTML processing - sidebar only needs metadata)
        const slug = isLocalized ? originalFilePath : originalFilePath
        const filePath = isLocalized
          ? path.join(versionDir, `${originalFilePath}.${fileLocale}.mdx`)
          : path.join(versionDir, `${originalFilePath}.mdx`)

        const doc = readDocFromFile(filePath, slug)

        if (!doc) return null

        // Set locale info
        if (i18nConfig) {
          const usePrefix = i18nConfig.prefixDefault || fileLocale !== i18nConfig.defaultLocale
          doc.slug = usePrefix ? `${fileLocale}/${doc.slug}` : doc.slug
        }
        doc.meta.locale = fileLocale

        // Override filePath properties for sidebar grouping
        // (we want grouped by logical path, not physically localized path if possible)
        doc.filePath = originalFilePath // Use logical path (without .fr) for grouping

        const folderPath = path.dirname(originalFilePath).replace(/\\/g, '/')
        if (folderPath !== ".") {
          const categoryConfig = categoryConfigs.get(folderPath)
          if (categoryConfig) {
            doc.categoryLabel = categoryConfig.label
            doc.categoryPosition = categoryConfig.position ?? categoryConfig.sidebar_position
            doc.categoryCollapsible = categoryConfig.collapsible
            doc.categoryCollapsed = categoryConfig.collapsed
            doc.categoryIcon = categoryConfig.icon
            doc.categoryTabGroup = categoryConfig.tab_group
            doc.categoryBadge = categoryConfig.badge
          }
        }

        return doc
      })

    const isDevelopment = process.env.NODE_ENV === "development"

    // Create a map to track unique slugs and avoid duplicates, prioritizing target locale
    const uniqueDocs = new Map<string, Doc>()

    // Sort docs such that target locale comes first? No, we need to filter/merge.
    const validDocs = docs.filter((doc): doc is Doc => doc !== null && (isDevelopment || !doc.meta.draft))

    // Group by logical slug (we stored logical path in filePath, maybe use that?)
    // Actually doc.slug might differ if custom slug used.

    // If we have intro.mdx (en) and intro.fr.mdx (fr)
    // And targetLocale is 'fr'
    // We want the 'fr' one.

    validDocs.forEach(doc => {
      // Identify logical slug. 
      // If doc.slug already has prefix (e.g. fr/intro), stripped slug is 'intro'.
      let logicalSlug = doc.slug
      if (i18nConfig) {
        const parts = logicalSlug.split('/')
        if (i18nConfig.locales.includes(parts[0])) {
          logicalSlug = parts.slice(1).join('/')
        }
      }

      const existing = uniqueDocs.get(logicalSlug)

      if (!existing) {
        // If doc matches target locale or is default (and we allow default fallback), take it.
        // For now, take everything, filter later?
        // Better: Only add if it matches target locale OR is default and we don't have target yet.
        if (doc.meta.locale === targetLocale) {
          uniqueDocs.set(logicalSlug, doc)
        } else if (doc.meta.locale === i18nConfig?.defaultLocale) {
          uniqueDocs.set(logicalSlug, doc)
        }
      } else {
        // We have an existing entry. prefer targetLocale
        if (doc.meta.locale === targetLocale && existing.meta.locale !== targetLocale) {
          uniqueDocs.set(logicalSlug, doc)
        }
      }
    })

    const sortedDocs = Array.from(uniqueDocs.values()).sort((a, b) => {
      const orderA = a.meta.sidebar_position ?? a.meta.order ?? 999
      const orderB = b.meta.sidebar_position ?? b.meta.order ?? 999
      return orderA - orderB
    })

    return sortedDocs
  } catch (error) {
    console.error(`Error getting all docs for version ${version}:`, error)
    return []
  }
}

// export function getAdjacentDocs(currentSlug: string, allDocs: Doc[]): { previous?: Doc; next?: Doc } {
//   const currentIndex = allDocs.findIndex((doc) => doc.slug === currentSlug)

//   if (currentIndex === -1) {
//     return {}
//   }

//   return {
//     previous: currentIndex > 0 ? allDocs[currentIndex - 1] : undefined,
//     next: currentIndex < allDocs.length - 1 ? allDocs[currentIndex + 1] : undefined,
//   }
// }

// Flatten the sidebar structure into a linear order
function flattenSidebarOrder(
  rootGroups: Record<string, SidebarGroup>,
  standalone: Doc[]
): Doc[] {
  const flatDocs: Doc[] = []

  // Recursively flatten groups - intermix folders and files by position
  const flattenGroup = (group: SidebarGroup) => {
    const sortedChildren = sortSidebarGroups(group.children)
    const sortedItems = sortSidebarItems(group.items)

    // Merge child groups and items, then sort by position
    const merged: Array<{ type: 'group', group: SidebarGroup, position: number } | { type: 'item', doc: Doc, position: number }> = [
      ...sortedChildren.map(([, childGroup]) => ({
        type: 'group' as const,
        group: childGroup,
        position: childGroup.position
      })),
      ...sortedItems.map((doc) => ({
        type: 'item' as const,
        doc,
        position: doc.meta.sidebar_position ?? doc.meta.order ?? 999
      }))
    ]

    // Sort by position
    merged.sort((a, b) => a.position - b.position)

    // Process in sorted order
    merged.forEach((item) => {
      if (item.type === 'group') {
        flattenGroup(item.group)
      } else {
        flatDocs.push(item.doc)
      }
    })
  }

  // Add standalone items first
  sortSidebarItems(standalone).forEach((doc) => {
    flatDocs.push(doc)
  })

  // Then add all grouped items
  const sortedRootGroups = sortSidebarGroups(rootGroups)
  sortedRootGroups.forEach(([, group]) => {
    flattenGroup(group)
  })

  return flatDocs
}

export function getAdjacentDocs(currentSlug: string, allDocs: Doc[]): { previous?: Doc; next?: Doc } {
  // Build the same sidebar structure
  const { rootGroups, standalone } = buildSidebarStructure(allDocs)

  // Flatten into the same order as shown in the sidebar
  const orderedDocs = flattenSidebarOrder(rootGroups, standalone)

  // Find current doc in the ordered list
  const currentIndex = orderedDocs.findIndex((doc) => doc.slug === currentSlug)

  if (currentIndex === -1) {
    return {}
  }

  const currentDoc = orderedDocs[currentIndex]

  // Get current doc's tab group (from meta or category)
  const currentTabGroup = currentDoc.meta?.tab_group || currentDoc.categoryTabGroup

  // Filter docs to match the current doc's tab group status
  // If current has a tab group, only show docs in the same tab group
  // If current has NO tab group, only show docs with NO tab group
  const filteredDocs = orderedDocs.filter((doc) => {
    const docTabGroup = doc.meta?.tab_group || doc.categoryTabGroup

    // If current doc has a tab group, only include docs with the same tab group
    if (currentTabGroup) {
      return docTabGroup === currentTabGroup
    }

    // If current doc has no tab group, only include docs with no tab group
    return !docTabGroup
  })

  // Find current doc's index within the filtered list
  const filteredIndex = filteredDocs.findIndex((doc) => doc.slug === currentSlug)

  if (filteredIndex === -1) {
    return {}
  }

  return {
    previous: filteredIndex > 0 ? filteredDocs[filteredIndex - 1] : undefined,
    next: filteredIndex < filteredDocs.length - 1 ? filteredDocs[filteredIndex + 1] : undefined,
  }
}

export function extractTableOfContents(content: string): TocItem[] {
  // One regex over both kinds of anchor so they come back in document order.
  //   group 1/2 — an ATX heading, at any level (see the slugger note below)
  //   group 3   — the `label` of an <Update>, which anchors a changelog entry
  // `[^>]*?` (not `.`) spans newlines, because authors wrap long <Update> tags.
  const anchorRegex = /^(#{1,6})[ \t]+(.+)$|<update\b[^>]*?\blabel\s*=\s*["']([^"']+)["']/gim
  const toc: TocItem[] = []

  // Mirror rehype-slug exactly: it builds ONE GithubSlugger per document and
  // slugs every h1–h6 in order, so a repeated heading renders as `setup` and
  // then `setup-1`. github-slugger's bare `slug()` export is stateless and
  // cannot know that, so it emitted `setup` twice and the second ToC link
  // silently scrolled to the first heading.
  //
  // The slugger must see headings the ToC never displays (h1, h4–h6) because
  // they still consume names from the same namespace — `# Setup` followed by
  // `## Setup` renders the h2 as `setup-1`.
  //
  // <Update> labels share this slugger too, mirroring rehype-changelog-ids.ts,
  // so a label can never collide with a heading of the same text.
  const slugger = new GithubSlugger()

  // Headings inside fenced code blocks are code, not headings. They get no
  // `id` in the rendered page, so a ToC entry for them can only ever 404 —
  // and rehype-slug never sees them either, so skipping them keeps the two
  // sluggers in lockstep. The same reasoning covers a fenced <Update> example.
  for (const { text: segment, isCode } of splitByCodeFences(content)) {
    if (isCode) continue

    let match
    anchorRegex.lastIndex = 0
    while ((match = anchorRegex.exec(segment)) !== null) {
      const [, hashes, headingText, updateLabel] = match

      if (updateLabel !== undefined) {
        const label = updateLabel.trim()
        if (!label) continue
        // Updates sit at the ToC's top level, alongside h2s.
        toc.push({ id: slugger.slug(label), title: label, level: 2 })
        continue
      }

      const level = hashes.length
      const text = headingText.trim()

      // Backticks are stripped first because rehype-slug slugs the RENDERED
      // heading text, where `code` markup is already gone. Always slug, even
      // for levels we drop, to keep the occurrence counters aligned.
      const id = slugger.slug(text.replace(/`/g, ""))

      if (level < 2 || level > 3) continue

      toc.push({ id, title: text, level })
    }
  }

  return toc
}

/**
 * Check if a slug represents a category (has child documents)
 */
export function isCategoryPage(slug: string, allDocs: Doc[]): boolean {
  return allDocs.some((doc) => {
    const parts = doc.slug.split("/")
    const docParent = parts.slice(0, -1).join("/")
    return docParent === slug && doc.slug !== slug
  })
}


