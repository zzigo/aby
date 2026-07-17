<script lang="ts">
  import { onMount } from 'svelte';
  import type { CatalogItem, CatalogSegment } from '@zztt/aby-domain';
  import { formatDuration, formatTechnicalFormat } from '$lib/presentation';
  import { currentPlayback, loadPlayback, loadSegmentPlayback } from '$lib/player';

  const views = ['Cover', 'Spectrogram'] as const;
  let items = $state<CatalogItem[]>([]);
  let selected = $state<CatalogItem | null>(null);
  let viewIndex = $state(0);
  let drawerOpen = $state(false);
  let loading = $state(true);
  let message = $state('Loading the private catalog…');
  let gestureStart = { x: 0, y: 0 };
  let drawerGestureY = 0;

  onMount(async () => {
    try {
      const response = await fetch('/api/catalog');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Catalog could not be loaded');
      items = body.items;
      selected = items[0] ?? null;
      drawerOpen = items.length === 0;
      message = items.length ? `${items.length} playable item${items.length === 1 ? '' : 's'}` : 'No committed assets yet.';
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
    message = `Loading ${item.workTitle}…`;
    try {
      await loadPlayback(item.asset.id, item.workTitle, item.creator ?? item.recordingTitle);
      message = `Playing ${item.workTitle}`;
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
      message = `Playing ${formatDuration(segment.endTimeMs - segment.startTimeMs)} segment`;
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
    <div class="instrument-status"><span></span>{message}</div>

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
        <div class="spectrogram-view">
          <div class="spectrogram-empty" aria-label="Spectrogram analysis pending">
            <span>Derived spectral artifact pending</span>
            <div class="spectral-grid"></div>
          </div>
          <div class="descriptor-strip">
            <div><small>Length</small><strong>{formatDuration(selected.asset.technicalMetadata.durationMs)}</strong></div>
            <div><small>Format</small><strong>{formatTechnicalFormat(selected.asset.technicalMetadata)}</strong></div>
            <div><small>Rate</small><strong>{selected.asset.technicalMetadata.sampleRate ?? '—'} Hz</strong></div>
            <div><small>Channels</small><strong>{selected.asset.technicalMetadata.channels ?? '—'}</strong></div>
            <div><small>Bit rate</small><strong>{selected.asset.technicalMetadata.bitRate ? `${Math.round(selected.asset.technicalMetadata.bitRate / 1000)} kb/s` : '—'}</strong></div>
          </div>
        </div>
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
    <div class="catalog-items">
      {#each items as item, index (item.asset.id)}
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
        <p class="catalog-empty">The catalog is empty. Promotion and canonical commit happen in Inspect.</p>
      {/each}
    </div>
  </aside>
</main>
