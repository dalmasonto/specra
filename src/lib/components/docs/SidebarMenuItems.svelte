<script lang="ts">
  import { page } from '$app/stores';
  import { base } from '$app/paths';
  import { ChevronRight, ChevronDown, Lock } from 'lucide-svelte';
  import type { SpecraConfig } from '$lib/config.types.js';
  import Icon from './Icon.svelte';
  import SidebarBadge from './SidebarBadge.svelte';
  import { resolveBadges, type BadgeInput } from '$lib/badges.js';
  import { sortSidebarItems, sortSidebarGroups } from '$lib/sidebar-utils.js';
  import { renderInlineCode } from '$lib/inline.js';

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
      sidebar_position?: number;
      order?: number;
      badge?: BadgeInput;
      [key: string]: any;
    };
  }

  interface SidebarGroup {
    label: string;
    path: string;
    icon?: string;
    badge?: BadgeInput;
    items: DocItem[];
    position: number;
    collapsible: boolean;
    defaultCollapsed: boolean;
    children: Record<string, SidebarGroup>;
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

  /** URL prefix: {base}/docs/{product}/{version} for named products, {base}/docs/{version} for default */
  let docsBase = $derived(
    product && product !== '_default_'
      ? `${base}/docs/${product}/${version}`
      : `${base}/docs/${version}`
  );

  const STORAGE_KEY = 'specra-sidebar-collapsed';

  function loadCollapsedState(): Record<string, boolean> {
    if (typeof window === 'undefined') return {};
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  function saveCollapsedState(state: Record<string, boolean>) {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // localStorage unavailable
    }
  }

  let collapsed: Record<string, boolean> = $state(loadCollapsedState());
  let pathname = $derived($page.url.pathname.replace(/\/$/, ''));

  // Filter docs by active tab group if tab groups are configured
  let hasTabGroups = $derived(
    config.navigation?.tabGroups && config.navigation.tabGroups.length > 0
  );

  let filteredDocs = $derived.by(() => {
    if (!hasTabGroups) return docs;

    // Fall back to the first tab group when activeTabGroup isn't set —
    // that happens whenever the current doc has no `tab_group` in its
    // frontmatter and no `_category_.json` ancestor with a tab_group.
    // Without this fallback the sidebar bypasses tab filtering entirely
    // and renders every doc, while the tab bar still visually highlights
    // the first tab (TabGroups.svelte applies the same fallback on its
    // own `activeTab`). The end result looked like "every tab contains
    // every doc" — but the real cause was that the sidebar's filter just
    // wasn't running.
    const effectiveTabGroup =
      activeTabGroup || config.navigation?.tabGroups?.[0]?.id;
    if (!effectiveTabGroup) return docs;

    const firstTabId = config.navigation?.tabGroups?.[0]?.id;
    return docs.filter((doc) => {
      const docTabGroup = doc.meta?.tab_group || doc.categoryTabGroup;
      if (!docTabGroup) {
        // Unlabeled docs land in the first tab group (Getting Started).
        return effectiveTabGroup === firstTabId;
      }
      return docTabGroup === effectiveTabGroup;
    });
  });

  // Build hierarchical tree structure
  interface SidebarStructure {
    rootGroups: Record<string, SidebarGroup>;
    standalone: DocItem[];
  }

  let structure = $derived.by((): SidebarStructure => {
    const rootGroups: Record<string, SidebarGroup> = {};
    const standalone: DocItem[] = [];

    filteredDocs.forEach((doc) => {
      const pathParts = doc.filePath.split('/');
      const isIndexFile =
        doc.filePath.endsWith('/index') ||
        doc.filePath === 'index' ||
        (pathParts.length > 1 && doc.slug === pathParts.slice(0, -1).join('/'));

      const customGroup = doc.sidebar || doc.group;

      if (customGroup) {
        const groupName = customGroup.charAt(0).toUpperCase() + customGroup.slice(1);
        if (!rootGroups[groupName]) {
          rootGroups[groupName] = {
            label: groupName,
            path: customGroup,
            items: [],
            position: 999,
            collapsible: doc.categoryCollapsible ?? true,
            defaultCollapsed: doc.categoryCollapsed ?? false,
            children: {}
          };
        }
        if (isIndexFile) {
          rootGroups[groupName].position = doc.sidebar_position ?? 999;
          rootGroups[groupName].icon = doc.categoryIcon;
          rootGroups[groupName].badge = doc.categoryBadge;
        }
        rootGroups[groupName].items.push(doc);
        return;
      }

      if (pathParts.length > 1) {
        const folderParts = pathParts.slice(0, -1);
        let currentLevel = rootGroups;
        let currentPath = '';

        for (let i = 0; i < folderParts.length; i++) {
          const folder = folderParts[i];
          currentPath = currentPath ? `${currentPath}/${folder}` : folder;
          const folderLabel = folder
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');

          const isOwnCategory = i === folderParts.length - 1;

          if (!currentLevel[folder]) {
            currentLevel[folder] = {
              label:
                doc.categoryLabel && isOwnCategory
                  ? doc.categoryLabel
                  : folderLabel,
              path: currentPath,
              icon: doc.categoryIcon,
              // A doc's `_category_.json` describes its *own* folder, so the
              // badge must not leak onto the ancestor folders we walk through.
              badge: isOwnCategory ? doc.categoryBadge : undefined,
              items: [],
              position: doc.categoryPosition ?? 999,
              collapsible: doc.categoryCollapsible ?? true,
              defaultCollapsed: doc.categoryCollapsed ?? false,
              children: {}
            };
          }

          if (isOwnCategory) {
            if (doc.categoryBadge) {
              currentLevel[folder].badge = doc.categoryBadge;
            }
            if (isIndexFile) {
              currentLevel[folder].position =
                doc.categoryPosition ?? doc.sidebar_position ?? 999;
              if (doc.categoryLabel) {
                currentLevel[folder].label = doc.categoryLabel;
              }
              if (doc.categoryIcon) {
                currentLevel[folder].icon = doc.categoryIcon;
              }
            }
            currentLevel[folder].items.push(doc);
          }

          currentLevel = currentLevel[folder].children;
        }
      } else {
        standalone.push(doc);
      }
    });

    return { rootGroups, standalone };
  });

  let sortedRootGroups = $derived(sortSidebarGroups(structure.rootGroups));
  let sortedStandalone = $derived(sortSidebarItems(structure.standalone));

  function toggleSection(section: string) {
    collapsed = { ...collapsed, [section]: !collapsed[section] };
    saveCollapsedState(collapsed);
  }

  function isActiveInGroup(group: SidebarGroup): boolean {
    const hasActiveItem = group.items.some(
      (doc) => pathname === `${docsBase}/${doc.slug}`
    );
    if (hasActiveItem) return true;
    return Object.values(group.children).some((child) => isActiveInGroup(child));
  }

  function getGroupHref(group: SidebarGroup): string {
    let groupHref = `${docsBase}/${group.path}`;

    if (config.features?.i18n) {
      const i18n = config.features.i18n;
      const locales = typeof i18n === 'object' ? i18n.locales : ['en'];
      const pathParts = pathname?.split('/') || [];
      const potentialLocale = pathParts[3];

      if (potentialLocale && locales.includes(potentialLocale)) {
        groupHref = `${docsBase}/${potentialLocale}/${group.path}`;
      }
    }

    return groupHref;
  }

  function isGroupCollapsed(groupKey: string, group: SidebarGroup): boolean {
    const hasActive = isActiveInGroup(group);
    const isGroupActive = pathname === `${docsBase}/${group.path}`;
    if (hasActive || isGroupActive) return false;
    return collapsed[groupKey] ?? group.defaultCollapsed;
  }

  type MergedItem =
    | { type: 'group'; key: string; group: SidebarGroup; position: number }
    | { type: 'item'; doc: DocItem; position: number };

  function getMergedItems(group: SidebarGroup): MergedItem[] {
    const sortedItems = sortSidebarItems(group.items);
    const sortedChildren = sortSidebarGroups(group.children);

    const merged: MergedItem[] = [
      ...sortedChildren.map(([childKey, childGroup]) => ({
        type: 'group' as const,
        key: childKey,
        group: childGroup,
        position: childGroup.position
      })),
      ...sortedItems.map((doc) => ({
        type: 'item' as const,
        doc,
        position: doc.sidebar_position ?? doc.meta?.sidebar_position ?? doc.meta?.order ?? 999
      }))
    ];

    merged.sort((a, b) => a.position - b.position);
    return merged;
  }
</script>

<!-- Recursive group renderer component -->
{#snippet renderGroup(groupKey: string, group: SidebarGroup, depth: number)}
  {@const sortedItems = sortSidebarItems(group.items)}
  {@const sortedChildren = sortSidebarGroups(group.children)}
  {@const hasChildren = sortedChildren.length > 0}
  {@const hasItems = sortedItems.length > 0}
  {@const hasContent = hasChildren || hasItems}
  {@const isGroupActive = pathname === `${docsBase}/${group.path}`}
  {@const isCollapsed = isGroupCollapsed(groupKey, group)}
  {@const marginLeft = depth > 0 ? 'ml-4' : ''}
  {@const groupHref = getGroupHref(group)}
  {@const mergedItems = getMergedItems(group)}
  {@const groupBadges = resolveBadges(group.badge)}

  <div class="space-y-1 {marginLeft}">
    <div class="flex items-center group">
      <a
        href={groupHref}
        onclick={(e) => {
          e.preventDefault();
          toggleSection(groupKey);
        }}
        class="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 text-sm font-semibold rounded-l-xl transition-all {isGroupActive
          ? 'bg-primary/10 text-primary'
          : 'text-foreground hover:bg-accent/50'}"
      >
        {#if group.icon}
          <Icon icon={group.icon} size={16} className="shrink-0" />
        {/if}
        <span class="truncate">{@html renderInlineCode(group.label)}</span>
        {#if groupBadges.length > 0}
          <span class="ml-auto flex items-center gap-1 shrink-0">
            {#each groupBadges as badge (badge.text)}
              <SidebarBadge {badge} />
            {/each}
          </span>
        {/if}
      </a>

      {#if hasContent && group.collapsible && config.navigation?.collapsibleSidebar}
        <button
          onclick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSection(groupKey);
          }}
          class="p-2 rounded-r-xl transition-all {isGroupActive ? 'hover:bg-primary/20' : 'hover:bg-accent/50'}"
          aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
        >
          {#if isCollapsed}
            <ChevronRight class="h-4 w-4 {isGroupActive ? 'text-primary' : 'text-muted-foreground'}" />
          {:else}
            <ChevronDown class="h-4 w-4 {isGroupActive ? 'text-primary' : 'text-muted-foreground'}" />
          {/if}
        </button>
      {/if}
    </div>

    {#if !isCollapsed && hasContent}
      <div class="ml-4 space-y-1">
        {#each mergedItems as item}
          {#if item.type === 'group'}
            {@render renderGroup(`${groupKey}/${item.key}`, item.group, depth + 1)}
          {:else}
            {@const href = `${docsBase}/${item.doc.slug}`}
            {@const isActive = pathname === href}
            {@const badges = resolveBadges(item.doc.meta?.badge)}
            <a
              {href}
              onclick={onLinkClick}
              class="flex items-center gap-2 min-w-0 px-3 py-2 text-sm rounded-xl transition-all {isActive
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-foreground hover:text-foreground hover:bg-accent/50'}"
            >
              {#if item.doc.meta?.icon}
                <Icon icon={item.doc.meta.icon} size={16} className="shrink-0" />
              {/if}
              <span class="truncate">{@html renderInlineCode(item.doc.title)}</span>
              {#if badges.length > 0 || item.doc.meta?.isProtected}
                <span class="ml-auto flex items-center gap-1 shrink-0">
                  {#each badges as badge (badge.text)}
                    <SidebarBadge {badge} />
                  {/each}
                  {#if item.doc.meta?.isProtected}
                    <Lock size={14} class="text-muted-foreground" />
                  {/if}
                </span>
              {/if}
            </a>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<nav class="space-y-1">
  {#if sortedStandalone.length > 0}
    {#each sortedStandalone as doc (doc.slug)}
      {@const href = `${docsBase}/${doc.slug}`}
      {@const isActive = pathname === href}
      {@const badges = resolveBadges(doc.meta?.badge)}
      <a
        {href}
        onclick={onLinkClick}
        class="flex items-center gap-2 min-w-0 px-3 py-2 text-sm rounded-xl transition-all {isActive
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-foreground hover:text-foreground hover:bg-accent/50'}"
      >
        {#if doc.meta?.icon}
          <Icon icon={doc.meta.icon} size={16} className="shrink-0" />
        {/if}
        <span class="truncate">{@html renderInlineCode(doc.title)}</span>
        {#if badges.length > 0 || doc.meta?.isProtected}
          <span class="ml-auto flex items-center gap-1 shrink-0">
            {#each badges as badge (badge.text)}
              <SidebarBadge {badge} />
            {/each}
            {#if doc.meta?.isProtected}
              <Lock size={14} class="text-muted-foreground" />
            {/if}
          </span>
        {/if}
      </a>
    {/each}
  {/if}

  {#each sortedRootGroups as [groupKey, group] (groupKey)}
    {@render renderGroup(groupKey, group, 0)}
  {/each}
</nav>
