<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type { CatalogItem, CatalogSegment } from '@zztt/aby-domain';
  import type { PageData } from './$types';
  import { formatDuration } from '$lib/presentation';
  import { currentPlayback, currentPlaybackTimeMs, loadPlayback, loadSegmentPlayback } from '$lib/player';
  import SpectrogramView from '$lib/components/SpectrogramView.svelte';
  import TrackEditor from '$lib/components/TrackEditor.svelte';

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
  let openActionsId = $state<string | null>(null);
  let editingItem = $state<CatalogItem | null>(null);
  let itemGesture = { id: '', x: 0, y: 0 };
  let suppressClickId = '';
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
  const catalogGroups = $derived.by(() => {
    const works = new SvelteMap<string, { id: string; title: string; direct: CatalogItem[]; albums: SvelteMap<string, { id: string; title: string; items: CatalogItem[] }> }>();
    for (const item of visibleItems) {
      let work = works.get(item.asset.workId);
      if (!work) {
        work = { id: item.asset.workId, title: item.workTitle, direct: [], albums: new SvelteMap() };
        works.set(item.asset.workId, work);
      }
      if (item.albumId && item.albumTitle) {
        let album = work.albums.get(item.albumId);
        if (!album) { album = { id: item.albumId, title: item.albumTitle, items: [] }; work.albums.set(item.albumId, album); }
        album.items.push(item);
      } else work.direct.push(item);
    }
    const sortTracks = (tracks: CatalogItem[]) => tracks.sort((a, b) =>
      (a.trackNumber ?? Number.MAX_SAFE_INTEGER) - (b.trackNumber ?? Number.MAX_SAFE_INTEGER)
      || a.recordingTitle.localeCompare(b.recordingTitle, undefined, { numeric: true })
    );
    return [...works.values()].map((work) => ({
      ...work, direct: sortTracks(work.direct),
      albums: [...work.albums.values()].map((album) => ({ ...album, items: sortTracks(album.items) }))
        .sort((a, b) => a.title.localeCompare(b.title))
    })).sort((a, b) => a.title.localeCompare(b.title));
  });

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

  function startItemGesture(event: PointerEvent, item: CatalogItem) {
    itemGesture = { id: item.asset.id, x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  async function endItemGesture(event: PointerEvent, item: CatalogItem) {
    if (itemGesture.id !== item.asset.id) return;
    const deltaX = event.clientX - itemGesture.x;
    const deltaY = event.clientY - itemGesture.y;
    if (Math.abs(deltaX) < 64 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    suppressClickId = item.asset.id;
    if (deltaX > 0) openActionsId = openActionsId === item.asset.id ? null : item.asset.id;
    else await removeItem(item);
  }

  function playFromCatalog(item: CatalogItem) {
    if (suppressClickId === item.asset.id) { suppressClickId = ''; return; }
    playItem(item);
  }

  async function removeItem(item: CatalogItem) {
    const before = items;
    items = items.filter((candidate) => candidate.asset.id !== item.asset.id);
    if (selected?.asset.id === item.asset.id) selected = items[0] ?? null;
    try {
      const response = await fetch(`/api/assets/${item.asset.id}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Delete failed');
      message = '';
    } catch (error) {
      items = before;
      message = error instanceof Error ? error.message : 'Delete failed';
    }
  }

  function replaceItem(updated: CatalogItem) {
    items = items.map((item) => item.asset.id === updated.asset.id ? updated : item);
    if (selected?.asset.id === updated.asset.id) selected = updated;
    if (editingItem?.asset.id === updated.asset.id) editingItem = updated;
  }

  async function regenerateItem(item: CatalogItem) {
    message = 'Refreshing metadata…';
    try {
      const response = await fetch(`/api/assets/${item.asset.id}/metadata`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Metadata refresh failed');
      replaceItem(body.item); openActionsId = null; message = '';
    } catch (error) { message = error instanceof Error ? error.message : 'Metadata refresh failed'; }
  }

  let isPressing = $state(false);
  let pointerStartMs = 0;
  let audioStartPlaybackTimeMs = 0;

  function handlePointerDown(event: PointerEvent) {
    if (!$currentPlayback) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    isPressing = true;
    pointerStartMs = Date.now();
    audioStartPlaybackTimeMs = $currentPlaybackTimeMs;
  }

  async function handlePointerUp(event: PointerEvent) {
    if (!isPressing) return;
    isPressing = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    const pressDuration = Date.now() - pointerStartMs;
    const currentAudioTime = $currentPlaybackTimeMs;

    let startMs = 0;
    let endMs = 0;

    if (pressDuration < 500) {
      // Tap: last 5 seconds
      startMs = Math.max(0, currentAudioTime - 5000);
      endMs = currentAudioTime;
    } else {
      // Press & Hold: duration of press
      startMs = audioStartPlaybackTimeMs;
      endMs = currentAudioTime;
    }

    if (endMs > startMs) {
      await saveMobileSegment(startMs, endMs);
    }
  }

  function handlePointerCancel(event: PointerEvent) {
    if (!isPressing) return;
    isPressing = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  async function saveMobileSegment(startMs: number, endMs: number) {
    try {
      const response = await fetch('/api/segments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assetId: $currentPlayback!.assetId,
          startTimeMs: Math.round(startMs),
          endTimeMs: Math.round(endMs),
          sourceContext: 'mobile_draft',
          label: 'Mobile Capture'
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Failed to save segment');
      
      // Reload catalog
      const catalogResponse = await fetch('/api/catalog');
      const catalogBody = await catalogResponse.json();
      if (catalogResponse.ok) {
        items = catalogBody.items;
      }
      message = `Saved draft: ${formatDuration(startMs)} – ${formatDuration(endMs)}`;
      setTimeout(() => { if (message.startsWith('Saved draft')) message = ''; }, 4000);
    } catch (error) {
      message = error instanceof Error ? error.message : 'Failed to save segment';
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
    {#if $currentPlayback}
      <button 
        class="master-capture-btn" 
        onpointerdown={handlePointerDown} 
        onpointerup={handlePointerUp}
        onpointercancel={handlePointerCancel}
        style="position: absolute; right: 24px; bottom: 120px; width: 72px; height: 72px; border-radius: 50%; border: 2px solid {isPressing ? 'var(--signal)' : 'var(--line)'}; background: {isPressing ? 'var(--signal)' : 'rgba(23, 24, 23, 0.85)'}; color: {isPressing ? '#101110' : 'var(--signal)'}; display: grid; place-items: center; cursor: pointer; z-index: 15; box-shadow: 0 8px 32px rgba(0,0,0,0.5); backdrop-filter: blur(8px); transition: transform 0.15s, background 0.15s; font-size: 11px; font-weight: 700; font-family: ui-monospace, monospace; user-select: none;"
        aria-label="Capture segment"
      >
        {isPressing ? 'RECORD' : 'CAPTURE'}
      </button>
    {/if}
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
    {#snippet trackRow(item: CatalogItem)}
      <article class:selected={selected?.asset.id === item.asset.id} class:actions-open={openActionsId === item.asset.id} onpointerdown={(event) => startItemGesture(event, item)} onpointerup={(event) => endItemGesture(event, item)}>
        <div class="item-actions" aria-hidden={openActionsId !== item.asset.id}>
          <button onclick={() => regenerateItem(item)} title="Regenerate metadata" aria-label="Regenerate metadata">↻</button>
          <button onclick={() => editingItem = item} title="Edit track" aria-label="Edit track">✎</button>
        </div>
        <button class="catalog-primary" onclick={() => playFromCatalog(item)}>
          <span class="catalog-index">{item.trackNumber ? String(item.trackNumber).padStart(2, '0') : '—'}</span>
          {#if item.coverUrl}<img src={item.coverUrl} alt="" />{:else}<span class="catalog-cover-fallback">A</span>{/if}
          <span class="catalog-copy"><strong>{item.recordingTitle}</strong><small>{item.creator ?? item.workTitle}</small></span>
          <span class="catalog-duration">{formatDuration(item.asset.technicalMetadata.durationMs)}</span>
        </button>
        {#if item.segments.length}<div class="catalog-segments">{#each item.segments as segment (segment.id)}<button onclick={() => playSegment(item, segment)}><span>{segment.label ?? 'Segment'}</span><small>{formatDuration(segment.startTimeMs)}–{formatDuration(segment.endTimeMs)}</small></button>{/each}</div>{/if}
      </article>
    {/snippet}
    <div class="catalog-items">
      {#each catalogGroups as work (work.id)}
        <section class="work-group">
          <h3>{work.title}</h3>
          {#each work.direct as item (item.asset.id)}{@render trackRow(item)}{/each}
          {#each work.albums as album (album.id)}
            <details class="album-group">
              <summary><span>{album.title}</span><small>{album.items.length} tracks</small></summary>
              {#each album.items as item (item.asset.id)}{@render trackRow(item)}{/each}
            </details>
          {/each}
        </section>
      {:else}
        <p class="catalog-empty">{items.length ? 'No items in this Aby folder.' : 'The catalog is empty.'}</p>
      {/each}
    </div>
  </aside>
</main>

{#if editingItem}
  {#key editingItem.asset.id}<TrackEditor item={editingItem} onclose={() => editingItem = null} onsaved={replaceItem} />{/key}
{/if}

<style>
  .work-group>h3{margin:16px 14px 7px;font:600 11px/1.2 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--signal)}
  .album-group{margin:0;border-top:1px solid var(--line)}.album-group summary{display:flex;justify-content:space-between;align-items:center;padding:11px 14px;cursor:pointer;font-size:12px;background:#121411;list-style-position:inside}.album-group summary small{color:var(--muted);font:9px ui-monospace,monospace}.album-group[open] summary{background:#181b16}
  .catalog-items article{position:relative;overflow:hidden;touch-action:pan-y}.catalog-primary{position:relative;z-index:1;transition:transform .16s ease;background:var(--surface)}.actions-open .catalog-primary{transform:translateX(92px)}
  .item-actions{position:absolute;inset:0 auto 0 0;width:92px;display:grid;grid-template-columns:1fr 1fr;background:var(--signal)}.item-actions button{border:0;border-right:1px solid #1c2117;background:transparent;color:#10110f;font-size:20px}
</style>
