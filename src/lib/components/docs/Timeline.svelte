<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();
</script>

<div class="my-6 ml-1" style="counter-reset: timeline-step;">
  {#if children}
    {@render children()}
  {/if}
</div>
