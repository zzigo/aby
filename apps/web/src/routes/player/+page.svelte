<script lang="ts">
  import { onMount } from 'svelte';
  import type { CatalogItem, CatalogSegment } from '@zztt/aby-domain';
  import type { PageData } from './$types';
  import { formatDuration } from '$lib/presentation';
  import { currentPlayback, loadPlayback, loadSegmentPlayback } from '$lib/player';
  import SpectrogramView from '$lib/components/SpectrogramView.svelte';

  const views = ['Cover', 'Spectrogram'] as const;
  let { data }: { data: PageData } = $props();
  let items = $state<CatalogItem[]>([]);
  let selected = $state<CatalogItem | null>(null);
  let viewIndex = $state(0);
  let drawerOpen = $state(false);
  let loading = $state(true);
  let message = $state('');
  let activeFolder = $state<string | null>(null);
  let favoriteFolders = $state<string[]>([]);
  let recentFolders = $state<string[]>([]);
  let folderTreeOpen = $state(false);
  let gestureStart = { x: 0, y: 0 };
  let drawerGestureY = 0;
  const storageSuffix = $derived(data.user?.id ?? 'anonymous');
  const folderOptions = $derived.by(() => {
    const paths: string[] = [];
    for (const item of items) {
      const parts = item.asset.objectKey.split('/');
      if (parts[0] !== 'aby' || !['aud', 'mov'].includes(parts[1] ?? '')) continue;
      const directory = parts.slice(0, -1);
      for (let end = 3; end <= directory.length; end += 1) {
        const path = directory.slice(0, end).join('/');
        if (!paths.includes(path)) paths.push(path);
      }
    }
    return paths.sort((left, right) => left.localeCompare(right));
  });
  const shortcutFolders = $derived([...favoriteFolders, ...recentFolders]
    .filter((path, index, paths) => paths.indexOf(path) === index && folderOptions.includes(path)).slice(0, 5));
  const visibleItems = $derived(activeFolder ? items.filter((item) => item.asset.objectKey.startsWith(`${activeFolder}/`)) : items);

  function folderLabel(path: string) {
    return path.replace(/^aby\//, '');
  }

  function persistFolders() {
    localStorage.setItem(`aby.favorite-folders:${storageSuffix}`, JSON.stringify(favoriteFolders));
    localStorage.setItem(`aby.recent-folders:${storageSuffix}`, JSON.stringify(recentFolders));
  }

  function selectFolder(path: string | null) {
    activeFolder = path;
    folderTreeOpen = false;
    if (path) recentFolders = [path, ...recentFolders.filter((candidate) => candidate !== path)].slice(0, 5);
    persistFolders();
  }

  function toggleFavorite(path: string) {
    favoriteFolders = favoriteFolders.includes(path)
      ? favoriteFolders.filter((candidate) => candidate !== path)
      : [path, ...favoriteFolders];
    persistFolders();
  }

  onMount(async () => {
    try {
      const response = await fetch('/api/catalog');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Catalog could not be loaded');
      items = body.items;
      selected = items[0] ?? null;
      try {
        const storedFavorites: unknown = JSON.parse(localStorage.getItem(`aby.favorite-folders:${storageSuffix}`) ?? '[]');
        const storedRecents: unknown = JSON.parse(localStorage.getItem(`aby.recent-folders:${storageSuffix}`) ?? '[]');
        favoriteFolders = Array.isArray(storedFavorites) ? storedFavorites.filter((value): value is string => typeof value === 'string') : [];
        recentFolders = Array.isArray(storedRecents) ? storedRecents.filter((value): value is string => typeof value === 'string') : [];
      } catch {
        favoriteFolders = [];
        recentFolders = [];
      }
      if (!recentFolders.length && items[0]) {
        const parts = items[0].asset.objectKey.split('/');
        const workFolder = parts.slice(0, Math.min(5, parts.length - 1)).join('/');
        if (workFolder.startsWith('aby/')) recentFolders = [workFolder];
      }
      drawerOpen = items.length === 0;
      message = '';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Catalog could not be loaded';
      drawerOpen = true;
    } finally {
      loading = false;
    }
  });

  function selectView(direction: number) {
    viewIndex = (viewIndex + direction + views.length) % views.length;
  }

  function startViewGesture(event: TouchEvent) {
    const touch = event.touches[0];
    if (touch) gestureStart = { x: touch.clientX, y: touch.clientY };
  }

  function endViewGesture(event: TouchEvent) {
    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - gestureStart.x;
    const deltaY = touch.clientY - gestureStart.y;
    if (Math.abs(deltaX) > 56 && Math.abs(deltaX) > Math.abs(deltaY)) selectView(deltaX < 0 ? 1 : -1);
  }

  function startDrawerGesture(event: TouchEvent) {
    drawerGestureY = event.touches[0]?.clientY ?? 0;
  }

  function endDrawerGesture(event: TouchEvent) {
    const deltaY = (event.changedTouches[0]?.clientY ?? drawerGestureY) - drawerGestureY;
    if (Math.abs(deltaY) > 48) drawerOpen = deltaY < 0;
  }

  async function playItem(item: CatalogItem) {
    selected = item;
    drawerOpen = false;
    message = '';
    try {
      await loadPlayback(item.asset.id, item.workTitle, item.creator ?? item.recordingTitle);
      message = '';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Playback failed';
    }
  }

  async function playSegment(item: CatalogItem, segment: CatalogSegment) {
    selected = item;
    drawerOpen = false;
    try {
      await loadSegmentPlayback(
        item.asset.id,
        segment.label || `${item.workTitle} · segment`,
        item.creator ?? item.recordingTitle,
        segment.startTimeMs,
        segment.endTimeMs
      );
      message = '';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Segment playback failed';
    }
  }
</script>

<svelte:head>
  <title>Aby — Player</title>
  <meta name="description" content="A touch-first catalog and temporal media instrument." />
</svelte:head>

<main class:transport-active={Boolean($currentPlayback)} class="instrument-shell">
  <section class="instrument-stage" ontouchstart={startViewGesture} ontouchend={endViewGesture} aria-label={`${views[viewIndex]} visualization`}>
    {#if message}<div class="instrument-status">{message}</div>{/if}

    {#if selected}
      {#if viewIndex === 0}
        <div class="cover-view">
          <button class="cover-touch" onclick={() => playItem(selected!)} aria-label={`Play ${selected.workTitle}`}>
            {#if selected.coverUrl}
              <img src={selected.coverUrl} alt={`Candidate artwork for ${selected.workTitle}`} />
            {:else}
              <span class="cover-fallback"><small>{selected.creator ?? 'Aby'}</small><strong>{selected.workTitle}</strong></span>
            {/if}
            <span class="cover-play">{$currentPlayback?.assetId === selected.asset.id ? 'Reload' : 'Play'}</span>
          </button>
          <div class="instrument-copy">
            <span class="eyebrow">{selected.releaseDate ?? 'Undated'}{selected.label ? ` · ${selected.label}` : ''}</span>
            <h1>{selected.workTitle}</h1>
            <p>{selected.creator ?? selected.recordingTitle}</p>
          </div>
        </div>
      {:else}
        <SpectrogramView asset={selected.asset} onplay={() => playItem(selected!)} />
      {/if}
    {:else if loading}
      <div class="instrument-empty">Opening the instrument…</div>
    {:else}
      <div class="instrument-empty">Commit an asset in Inspect, then return here to play it.</div>
    {/if}

    <button class="view-arrow previous" onclick={() => selectView(-1)} aria-label="Previous visualization">←</button>
    <button class="view-arrow next" onclick={() => selectView(1)} aria-label="Next visualization">→</button>
    <div class="view-switcher" aria-label="Visualization selector">
      {#each views as view, index (view)}
        <button class:active={viewIndex === index} onclick={() => viewIndex = index}>{view}</button>
      {/each}
    </div>
  </section>

  <aside class:open={drawerOpen} class="catalog-drawer" ontouchstart={startDrawerGesture} ontouchend={endDrawerGesture}>
    <button class="drawer-handle" onclick={() => drawerOpen = !drawerOpen} aria-expanded={drawerOpen}>
      <span></span>
      <strong>Catalog</strong>
      <small>{items.length} items · {drawerOpen ? 'swipe down to close' : 'swipe up to browse'}</small>
    </button>
    <div class="folder-shortcuts" aria-label="Canonical Aby folders">
      <button class:active={activeFolder === null} onclick={() => selectFolder(null)}>All</button>
      {#each shortcutFolders as folder (folder)}
        <button class:active={activeFolder === folder} onclick={() => selectFolder(folder)}>{folderLabel(folder)}</button>
      {/each}
      <button class="folder-add" class:active={folderTreeOpen} onclick={() => folderTreeOpen = !folderTreeOpen} aria-label="Choose favorite Aby folders">+</button>
    </div>
    {#if folderTreeOpen}
      <div class="folder-tree" aria-label="Aby canonical folder tree">
        {#each folderOptions as folder (folder)}
          <div>
            <button class:active={activeFolder === folder} onclick={() => selectFolder(folder)}>{folderLabel(folder)}</button>
            <button class="favorite-toggle" class:active={favoriteFolders.includes(folder)} onclick={() => toggleFavorite(folder)} aria-label={`${favoriteFolders.includes(folder) ? 'Remove' : 'Add'} ${folderLabel(folder)} ${favoriteFolders.includes(folder) ? 'from' : 'to'} favorites`}>★</button>
          </div>
        {/each}
      </div>
    {/if}
    <div class="catalog-items">
      {#each visibleItems as item, index (item.asset.id)}
        <article class:selected={selected?.asset.id === item.asset.id}>
          <button class="catalog-primary" onclick={() => playItem(item)}>
            <span class="catalog-index">{String(index + 1).padStart(2, '0')}</span>
            {#if item.coverUrl}<img src={item.coverUrl} alt="" />{:else}<span class="catalog-cover-fallback">A</span>{/if}
            <span class="catalog-copy"><strong>{item.workTitle}</strong><small>{item.creator ?? item.recordingTitle}</small></span>
            <span class="catalog-duration">{formatDuration(item.asset.technicalMetadata.durationMs)}</span>
          </button>
          {#if item.segments.length}
            <div class="catalog-segments">
              {#each item.segments as segment (segment.id)}
                <button onclick={() => playSegment(item, segment)}>
                  <span>{segment.label ?? 'Segment'}</span>
                  <small>{formatDuration(segment.startTimeMs)}–{formatDuration(segment.endTimeMs)}</small>
                </button>
              {/each}
            </div>
          {/if}
        </article>
      {:else}
        <p class="catalog-empty">{items.length ? 'No items in this Aby folder.' : 'The catalog is empty.'}</p>
      {/each}
    </div>
  </aside>
</main>
