<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type { CatalogItem } from '@zztt/aby-domain';

  type TileSize = 'small' | 'medium' | 'large';
  let { items, onselect }: { items: CatalogItem[]; onselect: (item: CatalogItem) => void } = $props();
  let sidebarOpen = $state(false);
  let showTitle = $state(true);
  let showYear = $state(true);
  let showTags = $state(false);
  let showArtist = $state(true);
  let tileSize = $state<TileSize>('medium');
  let touchStart = { x: 0, y: 0 };

  const albums = $derived.by(() => {
    const groups = new SvelteMap<string, CatalogItem>();
    for (const item of items) {
      const key = item.albumId ?? `work:${item.asset.workId}`;
      const current = groups.get(key);
      if (!current || (!current.coverUrl && item.coverUrl)) groups.set(key, item);
    }
    return [...groups.values()].sort((left, right) =>
      (left.albumTitle ?? left.workTitle).localeCompare(right.albumTitle ?? right.workTitle)
    );
  });

  onMount(() => {
    const stored = localStorage.getItem('aby.gallery-settings');
    if (!stored) return;
    try {
      const value = JSON.parse(stored);
      showTitle = value.showTitle !== false;
      showYear = value.showYear !== false;
      showTags = value.showTags === true;
      showArtist = value.showArtist !== false;
      if (value.tileSize === 'small' || value.tileSize === 'medium' || value.tileSize === 'large') tileSize = value.tileSize;
    } catch { /* keep gallery defaults */ }
  });

  function persist() {
    localStorage.setItem('aby.gallery-settings', JSON.stringify({ showTitle, showYear, showTags, showArtist, tileSize }));
  }

  function startGesture(event: TouchEvent) {
    event.stopPropagation();
    const touch = event.touches[0];
    if (touch) touchStart = { x: touch.clientX, y: touch.clientY };
  }

  function endGesture(event: TouchEvent) {
    event.stopPropagation();
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) <= Math.abs(dy)) return;
    if (!sidebarOpen && touchStart.x <= 48 && dx > 0) sidebarOpen = true;
    else if (sidebarOpen && dx < 0) sidebarOpen = false;
  }

  function tags(item: CatalogItem) {
    return [...new Set([...(item.asset.canonicalMetadata.albumTags ?? []), ...(item.asset.canonicalMetadata.tags ?? [])])].slice(0, 4);
  }
</script>

<div class="gallery-view" class:sidebar-open={sidebarOpen} ontouchstart={startGesture} ontouchend={endGesture} role="application" aria-label="Album gallery">
  <button class="gallery-settings" onclick={() => sidebarOpen = !sidebarOpen} aria-label="Gallery display settings">☰</button>
  <aside aria-label="Gallery display settings" ontouchstart={startGesture} ontouchend={endGesture}>
    <h2>DISPLAY</h2>
    <label><input type="checkbox" bind:checked={showTitle} onchange={persist} /> TITLE</label>
    <label><input type="checkbox" bind:checked={showYear} onchange={persist} /> YEAR</label>
    <label><input type="checkbox" bind:checked={showArtist} onchange={persist} /> ARTIST</label>
    <label><input type="checkbox" bind:checked={showTags} onchange={persist} /> TAGS</label>
    <h2>SIZE</h2>
    <div class="sizes">
      {#each ['small', 'medium', 'large'] as size (size)}
        <button class:active={tileSize === size} onclick={() => { tileSize = size as TileSize; persist(); }}>{size.slice(0, 1).toUpperCase()}</button>
      {/each}
    </div>
  </aside>
  <div class="gallery-grid" class:small={tileSize === 'small'} class:large={tileSize === 'large'}>
    {#each albums as item (item.albumId ?? item.asset.workId)}
      <button class="gallery-album" onclick={() => onselect(item)}>
        <span class="gallery-cover">
          {#if item.coverUrl}<img src={item.coverUrl} alt="" />{:else}<span>{(item.albumTitle ?? item.workTitle).slice(0, 1)}</span>{/if}
        </span>
        {#if showTitle || showYear || showArtist || showTags}
          <span class="gallery-meta">
            {#if showTitle}<strong>{item.albumTitle ?? item.workTitle}</strong>{/if}
            {#if showArtist}<small>{item.albumArtist ?? item.creator ?? '—'}</small>{/if}
            {#if showYear}<small>{item.releaseDate ?? '—'}</small>{/if}
            {#if showTags && tags(item).length}<small>{tags(item).join(' · ')}</small>{/if}
          </span>
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .gallery-view{position:absolute;z-index:6;inset:0;background:#0b0c0b;overflow:hidden}.gallery-settings{position:absolute;z-index:3;top:12px;left:12px;width:40px;height:40px;border:0;background:#111310cc;color:var(--signal);font:16px ui-monospace,monospace}.gallery-grid{height:100%;box-sizing:border-box;padding:12px 12px 150px;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));align-content:start;gap:2px;overflow:auto}.gallery-grid.small{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}.gallery-grid.large{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}.gallery-album{min-width:0;padding:0;border:0;background:#111210;color:#fff;text-align:left}.gallery-cover{aspect-ratio:1;display:grid;place-items:center;overflow:hidden;background:#20231d;color:var(--signal);font:42px Georgia,serif}.gallery-cover img{width:100%;height:100%;object-fit:cover}.gallery-meta{min-height:62px;padding:9px;display:grid;align-content:start;gap:3px}.gallery-meta strong,.gallery-meta small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gallery-meta strong{font-size:11px;font-weight:500}.gallery-meta small{color:var(--muted);font:8px ui-monospace,monospace}aside{position:absolute;z-index:5;top:0;bottom:0;left:0;width:min(280px,78vw);box-sizing:border-box;padding:72px 22px;background:#151714f5;transform:translateX(-100%);transition:transform .25s ease;backdrop-filter:blur(18px)}.sidebar-open aside{transform:translateX(0)}aside h2{margin:0 0 14px;color:var(--muted);font:9px ui-monospace,monospace;letter-spacing:.12em}aside h2:not(:first-child){margin-top:30px}aside label{min-height:42px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line);font:10px ui-monospace,monospace}aside input{accent-color:var(--signal)}.sizes{display:grid;grid-template-columns:repeat(3,1fr);gap:2px}.sizes button{height:40px;border:0;background:#20231d;color:var(--muted);font:10px ui-monospace,monospace}.sizes button.active{color:#10110f;background:var(--signal)}
</style>
