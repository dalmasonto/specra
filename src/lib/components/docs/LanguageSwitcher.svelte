<script lang="ts">
  import { ChevronDown, Check, Globe } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';

  interface Props {
    currentLocale: string;
    locales: string[];
    localeNames?: Record<string, string>;
    defaultLocale: string;
    prefixDefault?: boolean;
  }

  let { currentLocale, locales, localeNames, defaultLocale, prefixDefault = false }: Props = $props();

  let isOpen = $state(false);
  let dropdownEl = $state<HTMLDivElement | null>(null);

  function labelFor(locale: string): string {
    return localeNames?.[locale] || locale.toUpperCase();
  }

  let currentLabel = $derived(labelFor(currentLocale));

  $effect(() => {
    if (!browser || !isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (dropdownEl && !dropdownEl.contains(e.target as Node)) {
        isOpen = false;
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') isOpen = false;
    }

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  });

  function switchLocale(targetLocale: string) {
    if (targetLocale === currentLocale) {
      isOpen = false;
      return;
    }
    isOpen = false;

    const parts = $page.url.pathname.split('/').filter(Boolean);

    // Split the path into the prefix up to the version and the logical slug,
    // locating the locale segment (the first part that is a known locale).
    let prefixParts: string[];
    let logicalParts: string[];
    const localeIdx = parts.findIndex((p) => locales.includes(p));
    if (localeIdx !== -1) {
      prefixParts = parts.slice(0, localeIdx);
      logicalParts = parts.slice(localeIdx + 1);
    } else {
      // No locale in the URL yet (unprefixed default locale) — insert right
      // after the version segment.
      const version = ($page.data as any)?.version as string | undefined;
      const vIdx = version ? parts.indexOf(version) : 1;
      const insertAt = vIdx >= 0 ? vIdx : 1;
      prefixParts = parts.slice(0, insertAt + 1);
      logicalParts = parts.slice(insertAt + 1);
    }

    // Whether the target locale needs a path prefix (matches specra's slug rules).
    const usePrefix = prefixDefault || targetLocale !== defaultLocale;
    const localeSeg = usePrefix ? [targetLocale] : [];

    // Fall back to the docs home for the target locale when the current page
    // has no translation there. availableLocales is supplied by the app's load
    // function; when absent we navigate to the same page (best effort).
    const availableLocales = ($page.data as any)?.availableLocales as string[] | undefined;
    const hasTranslation = availableLocales ? availableLocales.includes(targetLocale) : true;

    const targetParts = hasTranslation
      ? [...prefixParts, ...localeSeg, ...logicalParts]
      : [...prefixParts, ...localeSeg];

    goto('/' + targetParts.join('/'));
  }
</script>

{#if locales.length > 1}
  <div class="relative" bind:this={dropdownEl}>
    <button
      onclick={() => (isOpen = !isOpen)}
      class="flex items-center gap-1.5 h-8 px-3 text-sm font-medium rounded-md border border-border bg-background hover:bg-accent transition-colors text-foreground"
      aria-expanded={isOpen}
      aria-haspopup="listbox"
      aria-label="Switch language"
    >
      <Globe class="h-3.5 w-3.5 text-muted-foreground" />
      <span class="hidden sm:inline">{currentLabel}</span>
      <ChevronDown class="h-3.5 w-3.5 text-muted-foreground transition-transform {isOpen ? 'rotate-180' : ''}" />
    </button>

    {#if isOpen}
      <div
        class="absolute top-full right-0 mt-1 w-48 py-1 bg-popover border border-border rounded-md shadow-lg z-50"
        role="listbox"
        aria-label="Available languages"
      >
        {#each locales as locale}
          <button
            role="option"
            aria-selected={locale === currentLocale}
            onclick={() => switchLocale(locale)}
            class="w-full flex items-center justify-between px-3 py-1.5 text-sm transition-colors {locale === currentLocale
              ? 'text-primary bg-accent/50 font-medium'
              : 'text-foreground hover:bg-accent'}"
          >
            <span>{labelFor(locale)}</span>
            {#if locale === currentLocale}
              <Check class="h-3.5 w-3.5 text-primary" />
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
