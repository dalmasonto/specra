<script lang="ts">
  import type { ResolvedBadge } from '$lib/badges.js';

  interface Props {
    badge: ResolvedBadge;
  }

  let { badge }: Props = $props();
</script>

<span
  class="px-1.5 py-0.5 text-[10px] font-medium rounded-full leading-none whitespace-nowrap {badge.className}"
>
  {badge.text}
</span>
