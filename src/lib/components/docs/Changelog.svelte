<script lang="ts">
  import type { Snippet } from 'svelte';
  import { setChangelogContext } from '$lib/changelog-context.js';

  interface Props {
    /**
     * Union of every child <Update>'s tags, injected server-side by
     * annotateChangelogNodes. Not authored by hand: children render after their
     * parent during SSR, so a bar that waited for them to self-register would
     * serialize empty and then flash on hydration.
     */
    allTags?: string[];
    children?: Snippet;
  }

  let { allTags = [], children }: Props = $props();

  let selected = $state<string[]>([]);

  setChangelogContext({
    matches(tags) {
      // Reading `selected` here is what subscribes each <Update> to the filter.
      if (selected.length === 0) return true;
      if (!tags?.length) return false;
      // AND logic: an update must carry every selected tag, not merely one.
      return selected.every((tag) => tags.includes(tag));
    }
  });

  function toggle(tag: string) {
    selected = selected.includes(tag)
      ? selected.filter((t) => t !== tag)
      : [...selected, tag];
  }
</script>

<div class="specra-changelog">
  {#if allTags.length > 0}
    <div class="mb-8 flex flex-wrap items-center gap-2 border-b border-border pb-6">
      <span class="mr-1 text-xs font-medium text-muted-foreground">Filter</span>

      {#each allTags as tag (tag)}
        {@const active = selected.includes(tag)}
        <button
          type="button"
          aria-pressed={active}
          onclick={() => toggle(tag)}
          class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors {active
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
        >
          {tag}
        </button>
      {/each}

      {#if selected.length > 0}
        <button
          type="button"
          onclick={() => (selected = [])}
          class="ml-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Clear
        </button>
      {/if}
    </div>
  {/if}

  {#if children}
    {@render children()}
  {/if}
</div>
