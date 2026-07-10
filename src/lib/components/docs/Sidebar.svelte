<script lang="ts">
  import type { SpecraConfig } from '$lib/config.types.js';
  import type { BadgeInput } from '$lib/badges.js';
  import SidebarMenuItems from './SidebarMenuItems.svelte';

  interface DocItem {
    title: string;
    slug: string;
    filePath: string;
    section?: string;
    group?: string;
    sidebar?: string;
    sidebar_position?: number;
    categoryLabel?: string;
    categoryPosition?: number;
    categoryCollapsible?: boolean;
    categoryCollapsed?: boolean;
    categoryIcon?: string;
    categoryTabGroup?: string;
    categoryBadge?: BadgeInput;
    meta?: {
      icon?: string;
      tab_group?: string;
      badge?: BadgeInput;
      [key: string]: any;
    };
  }

  interface Props {
    docs: DocItem[];
    version: string;
    product?: string;
    onLinkClick?: () => void;
    config: SpecraConfig;
    activeTabGroup?: string;
  }

  let { docs = [], version, product, onLinkClick, config, activeTabGroup }: Props = $props();

  let isFlush = $derived(config.navigation?.sidebarStyle === 'flush');
  let containerClass = $derived(
    isFlush
      ? `overflow-y-auto p-4 border-r border-border`
      : `overflow-y-auto bg-muted/30 dark:bg-muted/10 rounded-2xl p-4 border border-border/50`
  );
</script>

{#if config.navigation?.showSidebar}
  <aside class="w-64 shrink-0 sticky self-start pt-4" style="top: var(--header-height, 4rem);">
    <div class={containerClass} style="max-height: calc(100vh - var(--header-height, 4rem) - 2rem);">
      <div class="flex items-center justify-between mb-4 px-2">
        <h2 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Documentation</h2>
        {#if config.features?.showVersionBadge && version}
          <span class="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-md">{version}</span>
        {/if}
      </div>
      <SidebarMenuItems
        {docs}
        {version}
        {product}
        {onLinkClick}
        {config}
        {activeTabGroup}
      />
    </div>
  </aside>
{/if}
