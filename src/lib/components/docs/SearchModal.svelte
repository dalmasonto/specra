<script lang="ts">
  import { Search, X, FileText, Hash, ArrowUp, ArrowDown, CornerDownLeft, Loader2 } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import type { SpecraConfig } from '$lib/config.types.js';

  interface SearchResult {
    slug: string;
    title: string;
    description?: string;
    excerpt?: string;
    version?: string;
    headings?: Array<{ id: string; title: string }>;
  }

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    config: SpecraConfig;
  }

  let { isOpen, onClose, config }: Props = $props();

  let query = $state('');
  let results = $state<SearchResult[]>([]);
  let isLoading = $state(false);
  let selectedIndex = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const siteBaseUrl = $derived(config.site?.baseUrl || '/');
  const docsBaseUrl = '/docs';

  // Determine the locale the user is currently reading in, so search can be
  // scoped to that language. Locale appears as a path segment after the
  // version (e.g. /docs/v1.0.0/fr/...); fall back to the configured default.
  const currentLocale = $derived.by(() => {
    const i18n = config.features?.i18n;
    if (!i18n) return undefined;
    const locales = typeof i18n === 'object' ? i18n.locales : ['en'];
    const defaultLocale = typeof i18n === 'object' ? i18n.defaultLocale : 'en';
    const parts = ($page?.url?.pathname || '').split('/').filter(Boolean);
    const found = parts.find((p) => locales.includes(p));
    return found || defaultLocale;
  });

  $effect(() => {
    if (isOpen && inputEl) {
      // Focus input when modal opens
      setTimeout(() => inputEl?.focus(), 50);
    }
    if (!isOpen) {
      query = '';
      results = [];
      selectedIndex = 0;
      isLoading = false;
    }
  });

  $effect(() => {
    if (!browser) return;

    function handleKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) {
          onClose();
        }
      }
    }

    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  });

  function handleSearch(value: string) {
    query = value;
    selectedIndex = 0;

    if (debounceTimer) clearTimeout(debounceTimer);

    if (!value.trim()) {
      results = [];
      isLoading = false;
      return;
    }

    isLoading = true;
    debounceTimer = setTimeout(async () => {
      try {
        const localeParam = currentLocale ? `&locale=${encodeURIComponent(currentLocale)}` : '';
        const response = await fetch(
          `${siteBaseUrl.replace(/\/$/, '')}/api/search?q=${encodeURIComponent(value.trim())}${localeParam}`
        );
        if (response.ok) {
          const data = await response.json();
          results = data.results || data || [];
        } else {
          results = [];
        }
      } catch {
        results = [];
      } finally {
        isLoading = false;
      }
    }, 300);
  }

  function navigateToResult(result: SearchResult) {
    const version = result.version || config.site?.activeVersion || 'v1';
    const url = `${docsBaseUrl}/${version}/${result.slug}`;
    goto(url);
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          navigateToResult(results[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }

  function highlightMatch(text: string, searchQuery: string): string {
    if (!searchQuery.trim() || !text) return text;
    const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return text.replace(regex, '<mark class="bg-primary/20 text-primary rounded-sm px-0.5">$1</mark>');
  }
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
    role="dialog"
    aria-modal="true"
    aria-label="Search documentation"
    onkeydown={handleKeydown}
  >
    <!-- Backdrop -->
    <button
      class="absolute inset-0 bg-background/80 backdrop-blur-sm"
      onclick={onClose}
      aria-label="Close search"
      tabindex="-1"
    ></button>

    <!-- Modal -->
    <div class="relative w-full max-w-lg mx-4 bg-popover border border-border rounded-xl shadow-2xl overflow-hidden">
      <!-- Search Input -->
      <div class="flex items-center border-b border-border px-4">
        <Search class="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          bind:this={inputEl}
          type="text"
          placeholder={config.search?.placeholder || 'Search documentation...'}
          value={query}
          oninput={(e) => handleSearch(e.currentTarget.value)}
          class="flex-1 h-12 px-3 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
        />
        {#if isLoading}
          <Loader2 class="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
        {:else if query}
          <button
            onclick={() => handleSearch('')}
            class="p-1 hover:bg-accent rounded-md"
            aria-label="Clear search"
          >
            <X class="h-3 w-3 text-muted-foreground" />
          </button>
        {/if}
      </div>

      <!-- Results -->
      <div class="max-h-80 overflow-y-auto">
        {#if results.length > 0}
          <div class="py-2">
            {#each results as result, index}
              <button
                class="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors {index === selectedIndex ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50'}"
                onclick={() => navigateToResult(result)}
                onmouseenter={() => (selectedIndex = index)}
              >
                <FileText class="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium truncate">
                    {@html highlightMatch(result.title, query)}
                  </div>
                  {#if result.description || result.excerpt}
                    <div class="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {@html highlightMatch(result.description || result.excerpt || '', query)}
                    </div>
                  {/if}
                  {#if result.headings && result.headings.length > 0}
                    <div class="flex flex-wrap gap-1 mt-1">
                      {#each result.headings.slice(0, 3) as heading}
                        <span class="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                          <Hash class="h-2.5 w-2.5" />
                          {heading.title}
                        </span>
                      {/each}
                    </div>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        {:else if query && !isLoading}
          <div class="py-12 text-center">
            <p class="text-sm text-muted-foreground">No results found for "{query}"</p>
            <p class="text-xs text-muted-foreground mt-1">Try different keywords or check spelling</p>
          </div>
        {:else if !query}
          <div class="py-12 text-center">
            <p class="text-sm text-muted-foreground">Start typing to search...</p>
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex items-center gap-4 px-4 py-2 border-t border-border text-xs text-muted-foreground">
        <span class="inline-flex items-center gap-1">
          <ArrowUp class="h-3 w-3" />
          <ArrowDown class="h-3 w-3" />
          navigate
        </span>
        <span class="inline-flex items-center gap-1">
          <CornerDownLeft class="h-3 w-3" />
          open
        </span>
        <span class="inline-flex items-center gap-1">
          <kbd class="px-1.5 py-0.5 rounded border border-border bg-muted text-[10px] font-mono">esc</kbd>
          close
        </span>
      </div>
    </div>
  </div>
{/if}
