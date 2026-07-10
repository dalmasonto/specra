/**
 * Sidebar badge resolution.
 *
 * Authors mark a page or a category with a badge and a small pill renders next
 * to its sidebar row. A badge is a short text plus a color, and the common
 * cases ship as presets so the frontmatter stays a single word:
 *
 *   badge: new                              # preset
 *   badge: { text: Beta, color: purple }    # explicit
 *   badge: { text: "v3 only" }              # free text, default color
 *   badge: [new, beta]                      # several pills on one row
 *
 * Both frontmatter (`meta.badge`) and `_category_.json` (`badge`) pass through
 * `resolveBadges`, so the two surfaces can never drift apart.
 */

export const BADGE_COLORS = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "cyan",
] as const

export type BadgeColor = (typeof BADGE_COLORS)[number]

export const DEFAULT_BADGE_COLOR: BadgeColor = "gray"

/** A badge written out longhand. `color` falls back to the preset, then to gray. */
export interface BadgeSpec {
  text: string
  color?: BadgeColor
}

/** Anything an author may write in frontmatter or `_category_.json`. */
export type BadgeInput = string | BadgeSpec | Array<string | BadgeSpec>

/** A badge ready to render: color narrowed, classes attached. */
export interface ResolvedBadge {
  text: string
  color: BadgeColor
  className: string
}

/**
 * Tailwind scans this file (see the `@source` directive in `styles/globals.css`),
 * so every class must appear here as a complete literal string. Composing them at
 * runtime — `bg-${color}-500/10` — compiles to nothing.
 *
 * Gray leans on the theme tokens so it tracks the active preset theme; the rest
 * are fixed palette colors, since a "Deprecated" pill should read the same red
 * whichever theme the site ships.
 */
const BADGE_COLOR_CLASSES: Record<BadgeColor, string> = {
  gray: "bg-muted text-muted-foreground",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
  orange: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  green: "bg-green-500/10 text-green-600 dark:text-green-400",
  teal: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  purple: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  pink: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  cyan: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
}

/** Shorthand names an author can use in place of a `{ text, color }` pair. */
export const BADGE_PRESETS: Record<string, Required<BadgeSpec>> = {
  new: { text: "New", color: "green" },
  updated: { text: "Updated", color: "blue" },
  beta: { text: "Beta", color: "purple" },
  experimental: { text: "Experimental", color: "orange" },
  "pre-release": { text: "Pre-release", color: "amber" },
  deprecated: { text: "Deprecated", color: "red" },
  "coming-soon": { text: "Coming soon", color: "gray" },
}

/** `Pre_Release`, `PRE RELEASE` and `pre-release` all name the same preset. */
function presetKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-")
}

function isBadgeColor(value: unknown): value is BadgeColor {
  return typeof value === "string" && (BADGE_COLORS as readonly string[]).includes(value)
}

function finalize(text: string, color: BadgeColor): ResolvedBadge {
  return { text, color, className: BADGE_COLOR_CLASSES[color] }
}

function resolveBadge(entry: unknown): ResolvedBadge | null {
  if (typeof entry === "string") {
    const preset = BADGE_PRESETS[presetKey(entry)]
    if (preset) return finalize(preset.text, preset.color)

    const text = entry.trim()
    return text ? finalize(text, DEFAULT_BADGE_COLOR) : null
  }

  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const { text, color } = entry as Partial<BadgeSpec>
    if (typeof text !== "string") return null

    const trimmed = text.trim()
    if (!trimmed) return null

    // `{ text: Beta }` still picks up the preset color; an explicit, valid
    // `color` always wins. An unknown color degrades to gray rather than
    // throwing, so one typo cannot fail a whole docs build.
    const preset = BADGE_PRESETS[presetKey(trimmed)]
    const resolved = isBadgeColor(color) ? color : (preset?.color ?? DEFAULT_BADGE_COLOR)
    return finalize(trimmed, resolved)
  }

  return null
}

/**
 * Normalize any author input into a render-ready list. Unparseable entries are
 * dropped individually, so one bad badge never takes its siblings down with it.
 */
export function resolveBadges(input: unknown): ResolvedBadge[] {
  if (input === null || input === undefined) return []

  const entries = Array.isArray(input) ? input : [input]
  const badges: ResolvedBadge[] = []

  for (const entry of entries) {
    const badge = resolveBadge(entry)
    if (badge) badges.push(badge)
  }

  return badges
}
