<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type { CatalogItem, CatalogSegment, TimedTextDocument } from '@zztt/aby-domain';
  import type { PageData } from './$types';
  import { displayTrackTitle, formatDuration, formatTechnicalFormat } from '$lib/presentation';
  import {
    currentPlayback,
    currentPlaybackTimeMs,
    loadPlayback,
    loadSegmentPlayback,
    setPlaybackCatalog,
    type PlaybackContextItem
  } from '$lib/player';
  import SpectrogramView from '$lib/components/SpectrogramView.svelte';
  import WaveformView from '$lib/components/WaveformView.svelte';
  import TrackEditor from '$lib/components/TrackEditor.svelte';
  import AlbumEditor from '$lib/components/AlbumEditor.svelte';

  const views = ['Cover', 'Waveform', 'Spectrogram'] as const;
  type CatalogMode = 'album' | 'work' | 'creator' | 'folder' | 'tag';
  let { data }: { data: PageData } = $props();
  let items = $state<CatalogItem[]>([]);
  let selected = $state<CatalogItem | null>(null);
  let viewIndex = $state(0);
  let drawerOpen = $state(false);
  let loading = $state(true);
  let message = $state('');
  let catalogMode = $state<CatalogMode>('album');
  let catalogQuery = $state('');
  let activeFolder = $state<string | null>(null);
  let favoriteFolders = $state<string[]>([]);
  let recentFolders = $state<string[]>([]);
  let folderTreeOpen = $state(false);
  let openActionsId = $state<string | null>(null);
  let editingItem = $state<CatalogItem | null>(null);
  let editingAlbumItems = $state<CatalogItem[] | null>(null);
  let coverFlipped = $state(false);
  let lyricsOpen = $state(false);
  let lyricsDocument = $state<TimedTextDocument | null>(null);
  let lyricsLoading = $state(false);
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
  const visibleItems = $derived.by(() => {
    const folderItems = activeFolder ? items.filter((item) => item.asset.objectKey.startsWith(`${activeFolder}/`)) : items;
    const query = catalogQuery.trim().toLocaleLowerCase();
    if (!query) return folderItems;
    return folderItems.filter((item) => [
      item.workTitle, item.albumTitle, item.recordingTitle, item.creator, item.albumArtist,
      item.asset.canonicalMetadata.collectionCode, item.asset.objectKey,
      ...(item.asset.canonicalMetadata.tags ?? []),
      ...(item.asset.canonicalMetadata.albumTags ?? []),
      ...Object.values(item.asset.technicalMetadata.tags)
    ].some((value) => value?.toLocaleLowerCase().includes(query)));
  });
  const sortTracks = (tracks: CatalogItem[]) => tracks.sort((a, b) =>
    (a.trackNumber ?? Number.MAX_SAFE_INTEGER) - (b.trackNumber ?? Number.MAX_SAFE_INTEGER)
    || a.recordingTitle.localeCompare(b.recordingTitle, undefined, { numeric: true })
  );
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
    return [...works.values()].map((work) => ({
      ...work, direct: sortTracks(work.direct),
      albums: [...work.albums.values()].map((album) => ({ ...album, items: sortTracks(album.items) }))
        .sort((a, b) => a.title.localeCompare(b.title))
    })).sort((a, b) => a.title.localeCompare(b.title));
  });
  const albumGroups = $derived.by(() => {
    const groups = new SvelteMap<string, { id: string; title: string; albumId?: string; items: CatalogItem[] }>();
    for (const item of visibleItems) {
      const id = item.albumId ?? `direct:${item.asset.workId}`;
      let group = groups.get(id);
      if (!group) {
        group = { id, title: item.albumTitle ?? item.workTitle, ...(item.albumId ? { albumId: item.albumId } : {}), items: [] };
        groups.set(id, group);
      }
      group.items.push(item);
    }
    return [...groups.values()].map((group) => ({ ...group, items: sortTracks(group.items) }))
      .sort((left, right) => left.title.localeCompare(right.title));
  });
  const creatorGroups = $derived.by(() => nestedGroups(visibleItems, (item) => item.albumArtist || item.creator || 'Unknown', (item) => item.workTitle));
  const folderGroups = $derived.by(() => nestedGroups(
    visibleItems,
    (item) => item.asset.canonicalMetadata.collectionCode || item.asset.objectKey.split('/')[2] || 'uncatalogued',
    (item) => item.albumArtist || item.creator || item.asset.objectKey.split('/')[3] || 'Unknown'
  ));
  const tagGroups = $derived.by(() => {
    const groups = new SvelteMap<string, { id: string; title: string; items: CatalogItem[] }>();
    for (const item of visibleItems) {
      const canonicalTags = [...new Set([
        ...(item.asset.canonicalMetadata.tags ?? []),
        ...(item.asset.canonicalMetadata.albumTags ?? [])
      ])];
      const labels = canonicalTags.length
        ? canonicalTags
        : [item.asset.canonicalMetadata.collectionCode || 'untagged'];
      for (const label of labels) {
        const id = label.toLocaleLowerCase();
        let group = groups.get(id);
        if (!group) { group = { id, title: label, items: [] }; groups.set(id, group); }
        group.items.push(item);
      }
    }
    return [...groups.values()].map((group) => ({ ...group, items: sortTracks(group.items) }))
      .sort((left, right) => left.title.localeCompare(right.title));
  });
  const navigationAlbums = $derived.by(() => {
    const groups = new SvelteMap<string, { id: string; title: string; items: CatalogItem[] }>();
    for (const item of items) {
      const id = item.albumId ?? `work:${item.asset.workId}`;
      let group = groups.get(id);
      if (!group) {
        group = { id, title: item.albumTitle ?? item.workTitle, items: [] };
        groups.set(id, group);
      }
      group.items.push(item);
    }
    return [...groups.values()]
      .map((group) => ({ ...group, items: sortTracks(group.items) }))
      .sort((left, right) => left.title.localeCompare(right.title));
  });
  const selectedAlbumId = $derived(selected ? selected.albumId ?? `work:${selected.asset.workId}` : '');
  const selectedAlbumIndex = $derived(navigationAlbums.findIndex((album) => album.id === selectedAlbumId));
  const selectedAlbumItems = $derived(selectedAlbumIndex >= 0 ? navigationAlbums[selectedAlbumIndex]?.items ?? [] : []);
  const selectedAssetId = $derived(selected?.asset.id ?? '');
  const selectedTrackIndex = $derived(selectedAssetId ? selectedAlbumItems.findIndex((item) => item.asset.id === selectedAssetId) : -1);
  const activeLyricIndex = $derived.by(() => {
    if (!lyricsDocument?.cues.length || lyricsDocument.syncLevel === 'none') return -1;
    const adjustedTime = ($currentPlaybackTimeMs - lyricsDocument.offsetMs) / lyricsDocument.timeScale;
    let active = -1;
    for (const [index, cue] of lyricsDocument.cues.entries()) {
      if (cue.startMs !== null && cue.startMs <= adjustedTime) active = index;
      else if (cue.startMs !== null && cue.startMs > adjustedTime) break;
    }
    return active;
  });
  const visibleLyricCues = $derived.by(() => {
    if (!lyricsDocument || lyricsDocument.syncLevel === 'none') return [];
    const start = Math.max(0, activeLyricIndex < 0 ? 0 : activeLyricIndex);
    return lyricsDocument.cues.slice(start, start + 3);
  });

  function nestedGroups(source: CatalogItem[], parentTitle: (item: CatalogItem) => string, childTitle: (item: CatalogItem) => string) {
    const parents = new SvelteMap<string, { id: string; title: string; children: SvelteMap<string, { id: string; title: string; items: CatalogItem[] }> }>();
    for (const item of source) {
      const title = parentTitle(item);
      const id = title.toLocaleLowerCase();
      let parent = parents.get(id);
      if (!parent) { parent = { id, title, children: new SvelteMap() }; parents.set(id, parent); }
      const nestedTitle = childTitle(item);
      const nestedId = nestedTitle.toLocaleLowerCase();
      let child = parent.children.get(nestedId);
      if (!child) { child = { id: nestedId, title: nestedTitle, items: [] }; parent.children.set(nestedId, child); }
      child.items.push(item);
    }
    return [...parents.values()].map((parent) => ({
      id: parent.id, title: parent.title,
      children: [...parent.children.values()].map((child) => ({ ...child, items: sortTracks(child.items) }))
        .sort((left, right) => left.title.localeCompare(right.title))
    })).sort((left, right) => left.title.localeCompare(right.title));
  }

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

  function playbackContext(item: CatalogItem): PlaybackContextItem {
    return {
      assetId: item.asset.id,
      title: displayTrackTitle(item.recordingTitle, item.trackNumber),
      subtitle: item.albumArtist ?? item.creator ?? item.albumTitle ?? item.workTitle,
      ...(item.albumId ? { albumId: item.albumId } : {}),
      ...(item.trackNumber !== undefined ? { trackNumber: item.trackNumber } : {})
    };
  }

  function syncPlaybackCatalog(source: CatalogItem[] = items) {
    setPlaybackCatalog(source.map(playbackContext));
  }

  onMount(async () => {
    try {
      const response = await fetch('/api/catalog');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Catalog could not be loaded');
      items = body.items;
      syncPlaybackCatalog(items);
      const navigationState = page.state as { assetId?: unknown };
      const requestedAssetId = typeof navigationState.assetId === 'string'
        ? navigationState.assetId
        : new URL(window.location.href).searchParams.get('asset');
      selected = items.find((item) => item.asset.id === requestedAssetId)
        ?? items.find((item) => item.asset.id === $currentPlayback?.assetId)
        ?? items[0]
        ?? null;
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

  onMount(() => {
    const handleShortcut = async (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, button, [contenteditable="true"]')
        || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (event.code === 'Space') {
        event.preventDefault();
        const audio = document.querySelector<HTMLAudioElement>('.persistent-player audio');
        if (audio) {
          if (audio.paused) await audio.play().catch(() => {});
          else audio.pause();
        } else if (selected) {
          await playItem(selected);
        }
      } else if (event.key.toLowerCase() === 'c' && $currentPlayback) {
        event.preventDefault();
        const endMs = $currentPlaybackTimeMs;
        const startMs = Math.max(0, endMs - 5000);
        if (endMs > startMs) await saveMobileSegment(startMs, endMs);
      } else if (event.key.toLowerCase() === 'e' && $currentPlayback) {
        event.preventDefault();
        const playingItem = items.find((item) => item.asset.id === $currentPlayback?.assetId);
        if (playingItem) editItem(playingItem);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  });

  onMount(() => currentPlayback.subscribe((playback) => {
    if (!playback) return;
    const next = items.find((item) => item.asset.id === playback.assetId);
    if (next && next.asset.id !== selected?.asset.id) {
      selected = next;
      coverFlipped = false;
      lyricsOpen = false;
      lyricsDocument = null;
    }
  }));

  function selectView(direction: number) {
    viewIndex = (viewIndex + direction + views.length) % views.length;
  }

  async function navigateTrack(direction: -1 | 1) {
    const target = selectedAlbumItems[selectedTrackIndex + direction];
    if (target) await playItem(target);
  }

  async function navigateAlbum(direction: -1 | 1) {
    const target = navigationAlbums[selectedAlbumIndex + direction]?.items[0];
    if (target) await playItem(target);
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
    coverFlipped = false;
    lyricsOpen = false;
    lyricsDocument = null;
    drawerOpen = false;
    message = '';
    try {
      const context = playbackContext(item);
      await loadPlayback(context.assetId, context.title, context.subtitle, {
        ...(context.albumId ? { albumId: context.albumId } : {}),
        ...(context.trackNumber !== undefined ? { trackNumber: context.trackNumber } : {})
      });
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
        item.albumArtist ?? item.creator ?? displayTrackTitle(item.recordingTitle, item.trackNumber),
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
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    const deltaX = event.clientX - itemGesture.x;
    const deltaY = event.clientY - itemGesture.y;
    itemGesture = { id: '', x: 0, y: 0 };
    if (Math.abs(deltaX) < 64 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    suppressClickId = item.asset.id;
    if (deltaX > 0) openActionsId = openActionsId === item.asset.id ? null : item.asset.id;
    else await removeItem(item);
  }

  function cancelItemGesture(event: PointerEvent, item: CatalogItem) {
    if (itemGesture.id !== item.asset.id) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    itemGesture = { id: '', x: 0, y: 0 };
  }

  function editItem(item: CatalogItem) {
    openActionsId = null;
    suppressClickId = '';
    editingItem = item;
  }

  function editAlbum(albumItems: CatalogItem[]) {
    openActionsId = null;
    editingAlbumItems = albumItems;
  }

  function playFromCatalog(item: CatalogItem) {
    if (suppressClickId === item.asset.id) { suppressClickId = ''; return; }
    playItem(item);
  }

  async function removeItem(item: CatalogItem) {
    const before = items;
    items = items.filter((candidate) => candidate.asset.id !== item.asset.id);
    syncPlaybackCatalog(items);
    if (selected?.asset.id === item.asset.id) selected = items[0] ?? null;
    try {
      const response = await fetch(`/api/assets/${item.asset.id}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Delete failed');
      message = '';
    } catch (error) {
      items = before;
      syncPlaybackCatalog(items);
      message = error instanceof Error ? error.message : 'Delete failed';
    }
  }

  function replaceItem(updated: CatalogItem) {
    items = items.map((item) => item.asset.id === updated.asset.id ? updated : item);
    syncPlaybackCatalog(items);
    if (selected?.asset.id === updated.asset.id) selected = updated;
    if (editingItem?.asset.id === updated.asset.id) editingItem = updated;
  }

  function replaceAlbumItems(updated: CatalogItem[]) {
    const replacements = new Map(updated.map((item) => [item.asset.id, item]));
    items = items.map((item) => replacements.get(item.asset.id) ?? item);
    syncPlaybackCatalog(items);
    if (selected) selected = replacements.get(selected.asset.id) ?? selected;
    if (editingItem) editingItem = replacements.get(editingItem.asset.id) ?? editingItem;
    editingAlbumItems = updated;
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

  async function loadLyricsDocument(open: boolean) {
    if (!selected?.hasLyrics) return;
    if (lyricsDocument) { lyricsOpen = open; return; }
    const assetId = selected.asset.id;
    lyricsLoading = true;
    try {
      const response = await fetch(`/api/assets/${assetId}/lyrics`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Lyrics could not be loaded');
      if (selected?.asset.id !== assetId) return;
      lyricsDocument = body.lyrics;
      lyricsOpen = open && Boolean(lyricsDocument);
    } catch (error) {
      message = error instanceof Error ? error.message : 'Lyrics could not be loaded';
    } finally {
      lyricsLoading = false;
    }
  }

  async function toggleLyrics() {
    if (lyricsOpen) { lyricsOpen = false; return; }
    await loadLyricsDocument(true);
  }

  async function showCoverMetadata() {
    coverFlipped = true;
    if (selected?.hasLyrics && !lyricsDocument) await loadLyricsDocument(false);
  }

  function acceptLyrics(lyrics: TimedTextDocument) {
    lyricsDocument = lyrics;
    lyricsOpen = true;
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
        syncPlaybackCatalog(items);
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

<main class:transport-active={Boolean($currentPlayback)} class:signal-active={viewIndex === 1 || viewIndex === 2} class="instrument-shell">
  <section class="instrument-stage" ontouchstart={startViewGesture} ontouchend={endViewGesture} aria-label={`${views[viewIndex]} visualization`}>
    {#if message}<div class="instrument-status">{message}</div>{/if}

    {#if selected}
      {#if viewIndex === 0}
        <div class="cover-view">
          <div class="cover-flip" data-flipped={coverFlipped ? 'true' : 'false'}>
            <div class="cover-flip__inner">
              <button class="cover-flip__face cover-flip__front cover-touch" onclick={showCoverMetadata} aria-label={`Show metadata for ${selected.albumTitle ?? selected.workTitle}`}>
                {#if selected.coverUrl}
                  <img src={selected.coverUrl} alt={`Cover for ${selected.albumTitle ?? selected.workTitle}`} draggable="false" />
                {:else}
                  <span class="cover-fallback"><small>{selected.albumArtist ?? selected.creator ?? 'Aby'}</small><strong>{selected.albumTitle ?? selected.workTitle}</strong></span>
                {/if}
                <span class="cover-info" aria-hidden="true">ⓘ</span>
              </button>
              <section class="cover-flip__face cover-flip__back cover-back" aria-label="Album metadata">
                <button class="cover-flip__button flip-back-control" onclick={() => coverFlipped = false} aria-label="Return to cover" title="Return to cover">×</button>
                <button class="cover-edit-control" onclick={() => editItem(selected!)} aria-label={`Edit ${selected.recordingTitle}`} title="Edit track">✎</button>
                <dl>
                  <div><dt>Track</dt><dd>{displayTrackTitle(selected.recordingTitle, selected.trackNumber)}</dd></div>
                  <div><dt>Album</dt><dd>{selected.albumTitle ?? '—'}</dd></div>
                  <div><dt>Artist</dt><dd>{selected.albumArtist ?? selected.creator ?? '—'}</dd></div>
                  <div><dt>Work</dt><dd>{selected.workTitle}</dd></div>
                  <div><dt>Release</dt><dd>{selected.releaseDate ?? '—'}</dd></div>
                  <div><dt>Label</dt><dd>{selected.label ?? '—'}</dd></div>
                  <div><dt>Format</dt><dd>{formatTechnicalFormat(selected.asset.technicalMetadata)}</dd></div>
                  <div><dt>Length</dt><dd>{formatDuration(selected.asset.technicalMetadata.durationMs)}</dd></div>
                  <div class="notes"><dt>Notes</dt><dd>{selected.asset.canonicalMetadata.notes ?? selected.asset.canonicalMetadata.albumNotes ?? '—'}</dd></div>
                  {#if selected.hasLyrics}<div class="back-lyrics"><dt>Plain lyrics</dt><dd>{lyricsDocument?.plainText ?? (lyricsLoading ? 'Loading…' : '—')}</dd></div>{/if}
                </dl>
                {#if selected.hasLyrics}<nav class="cover-back-nav"><button onclick={toggleLyrics}>Lyrics</button></nav>{/if}
              </section>
            </div>
          </div>
          <div class="instrument-copy">
            <span class="eyebrow">{selected.releaseDate ?? 'Undated'}{selected.label ? ` · ${selected.label}` : ''}</span>
            <h1>{selected.albumTitle ?? selected.workTitle}</h1>
            <p>{selected.albumArtist ?? selected.creator ?? displayTrackTitle(selected.recordingTitle, selected.trackNumber)}</p>
          </div>
        </div>
      {:else if viewIndex === 1}
        <WaveformView asset={selected.asset} />
      {:else if viewIndex === 2}
        <SpectrogramView asset={selected.asset} onplay={() => playItem(selected!)} />
      {/if}
    {:else if loading}
      <div class="instrument-empty">Opening the instrument…</div>
    {:else}
      <div class="instrument-empty">Commit an asset in Inspect, then return here to play it.</div>
    {/if}

    <button class="side-navigation visualization previous" onclick={() => selectView(-1)} aria-label="Previous visualization" title="Previous visualization">
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M25 16H7m0 0 7-7m-7 7 7 7" /></svg>
    </button>
    <button class="side-navigation visualization next" onclick={() => selectView(1)} aria-label="Next visualization" title="Next visualization">
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 16h18m0 0-7-7m7 7-7 7" /></svg>
    </button>
    {#if selected}
      <button class="side-navigation album previous" onclick={() => navigateAlbum(-1)} disabled={selectedAlbumIndex <= 0} title="Previous album" aria-label="Previous album">
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 7v18M24 8l-8 8 8 8" /></svg>
      </button>
      <button class="side-navigation album next" onclick={() => navigateAlbum(1)} disabled={selectedAlbumIndex < 0 || selectedAlbumIndex >= navigationAlbums.length - 1} title="Next album" aria-label="Next album">
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M23 7v18M8 8l8 8-8 8" /></svg>
      </button>
      <button class="side-navigation track previous" onclick={() => navigateTrack(-1)} disabled={selectedTrackIndex <= 0} title="Previous track" aria-label="Previous track">
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="m20 7-9 9 9 9" /></svg>
      </button>
      <button class="side-navigation track next" onclick={() => navigateTrack(1)} disabled={selectedTrackIndex < 0 || selectedTrackIndex >= selectedAlbumItems.length - 1} title="Next track" aria-label="Next track">
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="m12 7 9 9-9 9" /></svg>
      </button>
    {/if}
    {#if selected?.hasLyrics}
      <button class:active={lyricsOpen} class="lyrics-toggle" onclick={toggleLyrics} disabled={lyricsLoading} title="Toggle lyrics" aria-label="Toggle lyrics">
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 9h18M7 15h14M7 21h10" /><path d="M23 20c0 3-1.8 5-5 5 2.1-1.5 2.8-3 2.8-5H23Z" /></svg>
      </button>
    {/if}
    {#if lyricsOpen && lyricsDocument}
      <section class="lyrics-overlay" aria-label="Lyrics" aria-live="polite">
        {#if lyricsDocument.syncLevel === 'none'}
          <div class="plain-lyrics">{lyricsDocument.plainText}</div>
        {:else}
          <div class="timed-lyrics">
            {#each visibleLyricCues as cue, index (cue.id ?? cue.position)}
              <p class:current={index === 0 && activeLyricIndex >= 0}>{cue.text}</p>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
    {#if $currentPlayback}
      <button 
        class="master-capture-btn" 
        onpointerdown={handlePointerDown} 
        onpointerup={handlePointerUp}
        onpointercancel={handlePointerCancel}
        style="position: absolute; right: 24px; bottom: 140px; width: 72px; height: 72px; padding: 0; text-align: center; text-indent: -1px; border-radius: 50%; border: 2px solid {isPressing ? 'var(--signal)' : 'var(--line)'}; background: {isPressing ? 'var(--signal)' : 'rgba(23, 24, 23, 0.85)'}; color: {isPressing ? '#101110' : 'var(--signal)'}; display: grid; place-items: center; cursor: pointer; z-index: 15; box-shadow: 0 8px 32px rgba(0,0,0,0.5); backdrop-filter: blur(8px); transition: transform 0.15s, background 0.15s; font-size: 11px; line-height: 1; font-weight: 700; font-family: ui-monospace, monospace; user-select: none;"
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
    <div class="catalog-header">
      <div class="catalog-modes" role="toolbar" aria-label="Catalog grouping">
        <button class:active={catalogMode === 'album'} onclick={() => catalogMode = 'album'} title="Albums" aria-label="Group by album">▣</button>
        <button class:active={catalogMode === 'work'} onclick={() => catalogMode = 'work'} title="Works and versions" aria-label="Group by work and version">≋</button>
        <button class:active={catalogMode === 'creator'} onclick={() => catalogMode = 'creator'} title="Composers and works" aria-label="Group by composer">♯</button>
        <button class:active={catalogMode === 'folder'} onclick={() => catalogMode = 'folder'} title="Canonical folders" aria-label="Group by folder">⌑</button>
        <button class:active={catalogMode === 'tag'} onclick={() => catalogMode = 'tag'} title="Tags" aria-label="Group by tag">#</button>
      </div>
      <label class="catalog-search"><span>⌕</span><input bind:value={catalogQuery} type="search" placeholder="SEARCH" aria-label="Search catalog" /></label>
    </div>
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
      <article class:selected={selected?.asset.id === item.asset.id} class:actions-open={openActionsId === item.asset.id}>
        {#if openActionsId === item.asset.id}
          <div class="item-actions">
            <button onclick={() => regenerateItem(item)} title="Regenerate metadata" aria-label="Regenerate metadata">↻</button>
            <button onclick={() => editItem(item)} title="Edit track" aria-label="Edit track">✎</button>
          </div>
        {/if}
        <button class="catalog-primary" onclick={() => playFromCatalog(item)} onpointerdown={(event) => startItemGesture(event, item)} onpointerup={(event) => endItemGesture(event, item)} onpointercancel={(event) => cancelItemGesture(event, item)}>
          <span class="catalog-index">{item.trackNumber ? String(item.trackNumber).padStart(2, '0') : '—'}</span>
          {#if item.coverUrl}<img src={item.coverUrl} alt="" />{:else}<span class="catalog-cover-fallback">A</span>{/if}
          <span class="catalog-copy"><strong>{displayTrackTitle(item.recordingTitle, item.trackNumber)}</strong><small>{item.albumArtist ?? item.creator ?? item.workTitle}</small></span>
          <span class="catalog-duration">{formatDuration(item.asset.technicalMetadata.durationMs)}</span>
        </button>
        <button class="catalog-edit" onclick={() => editItem(item)} title="Edit track" aria-label={`Edit ${item.recordingTitle}`}>✎</button>
        {#if item.segments.length}<div class="catalog-segments">{#each item.segments as segment (segment.id)}<button onclick={() => playSegment(item, segment)}><span>{segment.label ?? 'Segment'}</span><small>{formatDuration(segment.startTimeMs)}–{formatDuration(segment.endTimeMs)}</small></button>{/each}</div>{/if}
      </article>
    {/snippet}
    <div class="catalog-items">
      {#if catalogMode === 'album'}
        {#each albumGroups as album (album.id)}
          <details class="album-group ontology-root">
            <summary><span>{album.title}</span><span class="album-meta"><small>{album.items.length} tracks</small>{#if album.albumId}<button onclick={(event) => { event.preventDefault(); event.stopPropagation(); editAlbum(album.items); }} aria-label={`Edit album ${album.title}`} title="Edit album">✎</button>{/if}</span></summary>
            {#each album.items as item (item.asset.id)}{@render trackRow(item)}{/each}
          </details>
        {:else}<p class="catalog-empty">No matching items.</p>{/each}
      {:else if catalogMode === 'work'}
        {#each catalogGroups as work (work.id)}
          <section class="work-group"><h3>{work.title}</h3>
            {#each work.direct as item (item.asset.id)}{@render trackRow(item)}{/each}
            {#each work.albums as album (album.id)}
              <details class="album-group"><summary><span>{album.title}</span><span class="album-meta"><small>version · {album.items.length}</small><button onclick={(event) => { event.preventDefault(); event.stopPropagation(); editAlbum(album.items); }} aria-label={`Edit version ${album.title}`} title="Edit album version">✎</button></span></summary>{#each album.items as item (item.asset.id)}{@render trackRow(item)}{/each}</details>
            {/each}
          </section>
        {:else}<p class="catalog-empty">No matching items.</p>{/each}
      {:else if catalogMode === 'creator'}
        {#each creatorGroups as creator (creator.id)}
          <section class="work-group"><h3>{creator.title}</h3>{#each creator.children as work (work.id)}<details class="album-group"><summary><span>{work.title}</span><small>{work.items.length}</small></summary>{#each work.items as item (item.asset.id)}{@render trackRow(item)}{/each}</details>{/each}</section>
        {:else}<p class="catalog-empty">No matching items.</p>{/each}
      {:else if catalogMode === 'folder'}
        {#each folderGroups as folder (folder.id)}
          <section class="work-group"><h3>{folder.title}</h3>{#each folder.children as entity (entity.id)}<details class="album-group"><summary><span>{entity.title}</span><small>{entity.items.length}</small></summary>{#each entity.items as item (item.asset.id)}{@render trackRow(item)}{/each}</details>{/each}</section>
        {:else}<p class="catalog-empty">No matching items.</p>{/each}
      {:else}
        {#each tagGroups as tag (tag.id)}
          <section class="work-group"><h3>#{tag.title}</h3>{#each tag.items as item (item.asset.id)}{@render trackRow(item)}{/each}</section>
        {:else}<p class="catalog-empty">No matching items.</p>{/each}
      {/if}
    </div>
  </aside>
</main>

{#if editingItem}
  {#key editingItem.asset.id}<TrackEditor item={editingItem} onclose={() => editingItem = null} onsaved={replaceItem} onlyrics={acceptLyrics} />{/key}
{/if}
{#if editingAlbumItems?.[0]}
  {#key editingAlbumItems[0].albumId}<AlbumEditor items={editingAlbumItems} onclose={() => editingAlbumItems = null} onsaved={replaceAlbumItems} />{/key}
{/if}

<style>
  .work-group>h3{margin:16px 14px 7px;font:600 11px/1.2 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--signal)}
  .catalog-header{height:48px;display:flex;align-items:center;gap:12px;padding:0 14px;border-bottom:1px solid var(--line);background:#0e0f0e}.catalog-modes{display:flex;gap:2px}.catalog-modes button{width:34px;height:34px;padding:0;border:0;background:transparent;color:var(--muted);font:16px ui-monospace,monospace}.catalog-modes button.active{background:var(--signal);color:#10110f}.catalog-search{height:34px;min-width:100px;flex:1;display:flex;align-items:center;gap:7px;border-bottom:1px solid #3b3f39;color:var(--muted)}.catalog-search input{width:100%;min-width:0;border:0;background:transparent;color:#fff;outline:0;font:10px ui-monospace,monospace;letter-spacing:.08em}.ontology-root{border-top:0;border-bottom:1px solid var(--line)}
  .album-group{margin:0;border-top:1px solid var(--line)}.album-group summary{display:flex;justify-content:space-between;align-items:center;padding:7px 8px 7px 14px;cursor:pointer;font-size:12px;background:#121411;list-style-position:inside}.album-group summary small{color:var(--muted);font:9px ui-monospace,monospace}.album-group[open] summary{background:#181b16}.album-meta{display:flex;align-items:center;gap:8px}.album-meta button{width:34px;height:30px;border:0;background:transparent;color:var(--muted);font-size:16px}.album-meta button:hover,.album-meta button:focus-visible{color:var(--signal)}
  .catalog-items article{position:relative;overflow:hidden;touch-action:pan-y}.catalog-primary{position:relative;z-index:1;padding-right:68px;transition:transform .16s ease;background:var(--surface)}.actions-open .catalog-primary{transform:translateX(92px)}
  .item-actions{position:absolute;inset:0 auto 0 0;width:92px;display:grid;grid-template-columns:1fr 1fr;background:var(--signal)}.item-actions button{border:0;border-right:1px solid #1c2117;background:transparent;color:#10110f;font-size:20px}
  .catalog-edit{position:absolute;z-index:2;top:50%;right:12px;width:38px;height:38px;padding:0;transform:translateY(-50%);border:0;background:transparent;color:var(--muted);font-size:17px}.catalog-edit:hover,.catalog-edit:focus-visible{color:var(--signal)}.actions-open .catalog-edit{pointer-events:none;opacity:0}
</style>
