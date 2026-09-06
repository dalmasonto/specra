<script lang="ts">
  import { Search, Menu, Github, Twitter, MessageCircle } from 'lucide-svelte';
  import { base } from '$app/paths';
  import { getConfigContext } from '$lib/stores/config.js';
  import { sidebarStore } from '$lib/stores/sidebar.js';
  import VersionSwitcher from './VersionSwitcher.svelte';
  import LanguageSwitcher from './LanguageSwitcher.svelte';
  import ProductSwitcher from './ProductSwitcher.svelte';
  import { page } from '$app/stores';
  import VersionBanner from './VersionBanner.svelte';
  import ThemeToggle from './ThemeToggle.svelte';
  import SearchModal from './SearchModal.svelte';
  import Logo from './Logo.svelte';
  import Icon from './Icon.svelte';
  import type { SpecraConfig } from '$lib/config.types.js';
  import type { BannerConfig } from '$lib/config.types.js';
  import type { Snippet } from 'svelte';
  import { browser } from '$app/environment';

  interface VersionMeta {
    id: string;
    label: string;
    badge?: string;
    hidden?: boolean;
  }

  /** Flat shape (from page components) */
  interface ProductItemFlat {
    slug: string;
    label: string;
    icon?: string;
    badge?: string;
    activeVersion?: string;
    isDefault: boolean;
  }

  /** Nested shape (from SDK getProducts()) */
  interface ProductItemNested {
    slug: string;
    config: {
      label: string;
      icon?: string;
      badge?: string;
      activeVersion?: string;
    };
    isDefault: boolean;
  }

  type ProductInput = ProductItemFlat | ProductItemNested;

  interface Props {
    currentVersion: string;
    versions: string[];
    versionsMeta?: VersionMeta[];
    versionBanner?: BannerConfig;
    config?: SpecraConfig;
    products?: ProductInput[];
    currentProduct?: string;
    subheader?: Snippet;
  }

  let { currentVersion, versions = [], versionsMeta, versionBanner, config: configProp, products, currentProduct, subheader }: Props = $props();

  const configStore = getConfigContext();
  let config = $derived(configProp || $configStore);
  let searchOpen = $state(false);
  let isFlush = $derived(config?.navigation?.sidebarStyle === 'flush');
  let headerEl = $state<HTMLElement | null>(null);

  // i18n / language switcher config
  let i18n = $derived(
    config?.features?.i18n && typeof config.features.i18n === 'object' ? config.features.i18n : null
  );
  let localeList = $derived<string[]>(i18n?.locales ?? []);
  let defaultLocale = $derived(i18n?.defaultLocale ?? 'en');
  // Active locale = the first path segment matching a configured locale, else default.
  let activeLocale = $derived.by(() => {
    const parts = ($page?.url?.pathname || '').split('/').filter(Boolean);
    return parts.find((p) => localeList.includes(p)) || defaultLocale;
  });

  // Set a CSS variable on :root with the header's actual height so sidebars
  // can use it for their sticky top offset. Uses ResizeObserver to stay
  // in sync when banner is dismissed or tabs change.
  $effect(() => {
    if (!browser || !headerEl) return;

    function updateHeight() {
      if (headerEl) {
        const height = headerEl.offsetHeight;
        document.documentElement.style.setProperty('--header-height', `${height}px`);
      }
    }

    // Set immediately to avoid flash of wrong position
    updateHeight();
    // Also set on next frame in case layout hasn't settled
    requestAnimationFrame(updateHeight);

    const observer = new ResizeObserver(updateHeight);
    observer.observe(headerEl);

    return () => observer.disconnect();
  });

  $effect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchOpen = true;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });
</script>

<header bind:this={headerEl} class="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
  <div class="{isFlush ? '' : 'container mx-auto'} flex h-16 items-center justify-between px-4 md:px-6">
    <div class="flex items-center gap-1">
      <button
        onclick={() => sidebarStore.toggle()}
        class="lg:hidden hover:bg-muted p-2 rounded-md transition-colors"
        aria-label="Toggle menu"
      >
        <Menu class="h-5 w-5" />
      </button>
      <a href="{base}/" class="flex items-center gap-2">
        {#if !config.site.hideLogo}
          {#if config.site.logo}
            <Logo logo={config.site.logo} alt={config.site.title} className="w-18 object-contain" />
          {:else}
            <div class="h-8 w-8 rounded-xl bg-primary flex items-center justify-center">
              <span class="text-primary-foreground font-bold text-lg">
                {config.site.title.charAt(0).toUpperCase()}
              </span>
            </div>
          {/if}
        {/if}
        {#if !config.site.hideTitle}
          <span class="font-semibold text-lg text-foreground">{config.site.title ?? 'Specra'}</span>
        {/if}
      </a>
    </div>

    <div class="flex items-center gap-2">
      {#if config.search?.enabled}
        <button
          onclick={() => (searchOpen = true)}
          class="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground bg-muted rounded-md transition-colors"
        >
          <Search class="h-4 w-4" />
          <span class="hidden sm:inline">{config.search.placeholder || 'Search'}</span>
          <kbd class="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-background px-1.5 font-mono text-xs font-medium">
            ⌘K
          </kbd>
        </button>
      {/if}

      {#if products && products.length > 1}
        <ProductSwitcher {products} {currentProduct} />
      {/if}

      {#if config.features?.versioning}
        <VersionSwitcher {currentVersion} {versions} {versionsMeta} />
      {/if}

      {#if localeList.length > 1}
        <LanguageSwitcher
          currentLocale={activeLocale}
          locales={localeList}
          localeNames={i18n?.localeNames}
          {defaultLocale}
          prefixDefault={i18n?.prefixDefault}
        />
      {/if}

      <!-- Social Links -->
      {#if config.social?.github}
        <a
          href={config.social.github}
          target="_blank"
          rel="noopener noreferrer"
          class="hidden md:flex items-center justify-center h-9 w-9 rounded-md hover:bg-muted transition-colors"
          aria-label="GitHub"
        >
          <Github class="h-4 w-4" />
        </a>
      {/if}
      {#if config.social?.twitter}
        <a
          href={config.social.twitter}
          target="_blank"
          rel="noopener noreferrer"
          class="hidden md:flex items-center justify-center h-9 w-9 rounded-md hover:bg-muted transition-colors"
          aria-label="Twitter"
        >
          <Twitter class="h-4 w-4" />
        </a>
      {/if}
      {#if config.social?.discord}
        <a
          href={config.social.discord}
          target="_blank"
          rel="noopener noreferrer"
          class="hidden md:flex items-center justify-center h-9 w-9 rounded-md hover:bg-muted transition-colors"
          aria-label="Discord"
        >
          <MessageCircle class="h-4 w-4" />
        </a>
      {/if}
      {#if config.social?.custom}
        {#each config.social.custom as link}
          <span class="relative hidden md:inline-flex group/tip">
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-center h-9 w-9 rounded-md hover:bg-muted transition-colors"
              aria-label={link.label}
            >
              {#if link.icon}
                <Icon icon={link.icon} size={16} />
              {:else}
                <span class="text-xs font-medium">{link.label.slice(0, 2)}</span>
              {/if}
            </a>
            <span class="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-1 text-xs text-popover-foreground bg-popover border border-border rounded-md shadow-sm whitespace-nowrap pointer-events-none opacity-0 group-hover/tip:opacity-100 transition-opacity z-50">
              {link.label}
            </span>
          </span>
        {/each}
      {/if}

      <ThemeToggle />
    </div>
  </div>

  <!-- Search Modal -->
  <SearchModal isOpen={searchOpen} onClose={() => (searchOpen = false)} {config} />

  {#if versionBanner}
    <VersionBanner banner={versionBanner} />
  {/if}

  {#if subheader}
    {@render subheader()}
  {/if}
</header>
