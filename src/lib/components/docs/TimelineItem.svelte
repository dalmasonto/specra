<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    title: string;
    date?: string;
    icon?: string;
    /** Visual state of this milestone. */
    status?: 'done' | 'current' | 'upcoming';
    children?: Snippet;
  }

  let { title, date, icon, status = 'done', children }: Props = $props();
</script>

<div class="timeline-item timeline-{status} relative pl-11 pb-6 last:pb-0">
  <!-- Marker: an explicit icon, otherwise the auto step number. -->
  <span class="timeline-node" aria-hidden="true">
    {#if icon}
      <Icon {icon} size={15} />
    {:else}
      <span class="timeline-number"></span>
    {/if}
  </span>

  <div class="timeline-card rounded-lg border border-border bg-card px-4 py-3 transition-colors duration-200 hover:border-primary/40">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h3 class="text-base font-semibold leading-tight text-card-foreground">{title}</h3>
      {#if date}
        <span class="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {date}
        </span>
      {/if}
    </div>
    {#if children}
      <div class="prose prose-sm dark:prose-invert mt-1.5 max-w-none [&>*:last-child]:mb-0">
        {@render children()}
      </div>
    {/if}
  </div>
</div>

<style>
  .timeline-item {
    counter-increment: timeline-step;
  }

  /* Vertical connector, centred under the node, running to the next item. */
  .timeline-item::after {
    content: '';
    position: absolute;
    left: 1rem;
    top: 2.25rem;
    bottom: 0;
    width: 2px;
    transform: translateX(-50%);
    background: var(--border);
  }
  .timeline-item:last-child::after {
    display: none;
  }
  /* Not-yet-done segments read as dashed. */
  .timeline-upcoming::after {
    background: repeating-linear-gradient(
      to bottom,
      var(--border) 0 4px,
      transparent 4px 9px
    );
  }

  /* Node circle. A background-coloured ring lifts it off the connector. */
  .timeline-node {
    position: absolute;
    left: 1rem;
    top: 0;
    transform: translateX(-50%);
    width: 2rem;
    height: 2rem;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    background: var(--primary);
    color: var(--primary-foreground);
    box-shadow: 0 0 0 3px var(--background);
  }
  .timeline-number::before {
    content: counter(timeline-step);
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1;
  }

  /* Upcoming: hollow, muted. */
  .timeline-upcoming .timeline-node {
    background: var(--background);
    color: var(--muted-foreground);
    border: 2px solid var(--border);
    box-shadow: none;
  }

  /* Current: emphasised with a static ring plus a soft pulse. */
  .timeline-current .timeline-node {
    box-shadow:
      0 0 0 3px var(--background),
      0 0 0 5px color-mix(in oklab, var(--primary) 30%, transparent);
  }
  .timeline-current .timeline-node::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: 9999px;
    border: 2px solid var(--primary);
    animation: timeline-pulse 1.8s ease-out infinite;
  }
  @keyframes timeline-pulse {
    0% {
      transform: scale(1);
      opacity: 0.6;
    }
    100% {
      transform: scale(1.85);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .timeline-current .timeline-node::after {
      animation: none;
    }
  }
</style>
