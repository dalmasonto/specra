/**
 * Context shared between `<Changelog>` and its `<Update>` children.
 *
 * Siblings cannot see each other in Svelte 5, so tag filtering needs a common
 * parent to hold the selected-tag set. `<Update>` works fine without one — a
 * bare update outside a `<Changelog>` simply never gets filtered.
 */
import { getContext, setContext } from 'svelte'

const CHANGELOG_KEY = Symbol('specra:changelog')

export interface ChangelogContext {
  /** True when an update carrying `tags` survives the current filter. */
  matches(tags: string[] | undefined): boolean
}

export function setChangelogContext(context: ChangelogContext): void {
  setContext(CHANGELOG_KEY, context)
}

export function getChangelogContext(): ChangelogContext | undefined {
  return getContext<ChangelogContext | undefined>(CHANGELOG_KEY)
}
