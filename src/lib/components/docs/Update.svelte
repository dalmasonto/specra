<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getChangelogContext } from '$lib/changelog-context.js';

  interface Props {
    /** Date or release name. Anchors the entry and names it in the ToC. */
    label?: string;
    /** Slug of `label`, injected server-side by rehype-changelog-ids. */
    id?: string;
    /** Secondary line, typically a version. */
    description?: string;
    tags?: string[];
    /** Overrides the RSS entry. Consumed server-side; unused when rendering. */
    rss?: { title?: string; description?: string };
    children?: Snippet;
  }

  let { label, id, description, tags = [], children }: Props = $props();

  // Absent outside a <Changelog>, in which case nothing filters this update.
  const changelog = getChangelogContext();

  // Reads the parent's selected-tag state, so toggling a filter re-renders.
  let visible = $derived(changelog ? changelog.matches(tags) : true);
</script>

{#if visible}
  <div
    {id}
    class="specra-update grid gap-x-8 gap-y-3 pb-12 scroll-mt-24 last:pb-0 md:grid-cols-[10rem_minmax(0,1fr)]"
  >
    <div class="md:sticky md:top-24 md:self-start md:text-right">
      {#if label}
        {#if id}
          <a
            href="#{id}"
            class="text-sm font-semibold text-foreground transition-colors hover:text-primary"
          >
            {label}
          </a>
        {:else}
          <span class="text-sm font-semibold text-foreground">{label}</span>
        {/if}
      {/if}

      {#if description}
        <div class="mt-1 text-xs text-muted-foreground">{description}</div>
      {/if}

      {#if tags.length > 0}
        <div class="mt-2 flex flex-wrap gap-1 md:justify-end">
          {#each tags as tag (tag)}
            <span
              class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
            >
              {tag}
            </span>
          {/each}
        </div>
      {/if}
    </div>

    <div class="relative border-l border-border pl-8">
      <span
        aria-hidden="true"
        class="absolute -left-[4.5px] top-2 h-2 w-2 rounded-full bg-border ring-4 ring-background"
      ></span>
      <div class="prose prose-sm dark:prose-invert max-w-none [&>*:last-child]:mb-0">
        {#if children}
          {@render children()}
        {/if}
      </div>
    </div>
  </div>
{/if}
