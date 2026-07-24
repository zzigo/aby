<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type { CatalogItem } from '@zztt/aby-domain';

  type TileSize = 'small' | 'medium' | 'large';
  type GroupBy = 'none' | 'tags' | 'artist' | 'year' | 'composer' | 'collection' | 'set';
  type SortBy = 'title' | 'artist' | 'year' | 'composer' | 'collection' | 'set';
  let { items, onselect, ondelete }: { 
    items: CatalogItem[]; 
    onselect: (item: CatalogItem) => void;
    ondelete: (item: CatalogItem) => void;
  } = $props();
  let sidebarOpen = $state(false);
  let showTitle = $state(true);
  let showYear = $state(true);
  let showTags = $state(false);
  let showArtist = $state(true);
  let tileSize = $state<TileSize>('medium');
  let groupBy = $state<GroupBy>('none');
  let sortBy = $state<SortBy>('title');
  let sortDescending = $state(false);
  let touchStart = { x: 0, y: 0 };

  let albumTouchStartX = 0;
  let activeSwipeKey = $state<string | null>(null);
  let activeSwipeOffset = $state(0);

  function onAlbumTouchStart(event: TouchEvent, key: string) {
    const touch = event.touches[0];
    if (touch) {
      albumTouchStartX = touch.clientX;
      activeSwipeKey = key;
      activeSwipeOffset = 0;
    }
  }

  function onAlbumTouchMove(event: TouchEvent) {
    if (!activeSwipeKey) return;
    const touch = event.touches[0];
    if (touch) {
      const dx = touch.clientX - albumTouchStartX;
      if (dx < 0) {
        activeSwipeOffset = dx;
      } else {
        activeSwipeOffset = 0;
      }
    }
  }

  function onAlbumTouchEnd(event: TouchEvent, item: CatalogItem) {
    if (!activeSwipeKey) return;
    if (activeSwipeOffset < -100) {
      ondelete(item);
    }
    activeSwipeKey = null;
    activeSwipeOffset = 0;
  }

  function handleSelect(item: CatalogItem, event: MouseEvent) {
    if (activeSwipeOffset < -10) {
      event.preventDefault();
      return;
    }
    onselect(item);
  }

  const albums = $derived.by(() => {
    const groups = new SvelteMap<string, CatalogItem>();
    for (const item of items) {
      const key = item.albumId ?? `work:${item.asset.workId}`;
      const current = groups.get(key);
      if (!current || (!current.coverUrl && item.coverUrl)) groups.set(key, item);
    }
    return [...groups.values()];
  });

  function albumTitle(item: CatalogItem) {
    return item.albumTitle ?? item.workTitle;
  }

  function artist(item: CatalogItem) {
    return item.albumArtist ?? item.creator ?? 'Unknown artist';
  }

  function composer(item: CatalogItem) {
    return item.asset.canonicalMetadata.roles?.find((credit) => /compos/i.test(credit.role))?.name
      ?? item.creator
      ?? 'Unknown composer';
  }

  function year(item: CatalogItem) {
    return item.releaseDate?.match(/(?:18|19|20|21)\d{2}/)?.[0] ?? 'Unknown year';
  }

  function collection(item: CatalogItem) {
    return item.asset.canonicalMetadata.collectionCode ?? 'Uncatalogued';
  }

  function setName(item: CatalogItem) {
    return item.asset.canonicalMetadata.albumSet?.title ?? 'No set';
  }

  function sortValue(item: CatalogItem, key: SortBy) {
    if (key === 'artist') return artist(item);
    if (key === 'year') return year(item);
    if (key === 'composer') return composer(item);
    if (key === 'collection') return collection(item);
    if (key === 'set') return setName(item);
    return albumTitle(item);
  }

  function groupValues(item: CatalogItem): string[] {
    if (groupBy === 'tags') return tags(item).length ? tags(item) : ['Untagged'];
    if (groupBy === 'artist') return [artist(item)];
    if (groupBy === 'year') return [year(item)];
    if (groupBy === 'composer') return [composer(item)];
    if (groupBy === 'collection') return [collection(item)];
    if (groupBy === 'set') return [setName(item)];
    return ['All albums'];
  }

  const albumGroups = $derived.by(() => {
    const groups = new SvelteMap<string, CatalogItem[]>();
    for (const item of albums) {
      for (const value of groupValues(item)) groups.set(value, [...(groups.get(value) ?? []), item]);
    }
    const direction = sortDescending ? -1 : 1;
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
      .map(([label, entries]) => ({
        label,
        items: entries.sort((left, right) => {
          const primary = sortValue(left, sortBy).localeCompare(sortValue(right, sortBy), undefined, { numeric: true });
          return (primary || albumTitle(left).localeCompare(albumTitle(right))) * direction;
        })
      }));
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
      if (['none', 'tags', 'artist', 'year', 'composer', 'collection', 'set'].includes(value.groupBy)) groupBy = value.groupBy;
      if (['title', 'artist', 'year', 'composer', 'collection', 'set'].includes(value.sortBy)) sortBy = value.sortBy;
      sortDescending = value.sortDescending === true;
    } catch { /* keep gallery defaults */ }
  });

  function persist() {
    localStorage.setItem('aby.gallery-settings', JSON.stringify({
      showTitle, showYear, showTags, showArtist, tileSize, groupBy, sortBy, sortDescending
    }));
  }

  function handleShortcut(event: KeyboardEvent) {
    if (!event.metaKey || event.key !== '/') return;
    event.preventDefault();
    sidebarOpen = !sidebarOpen;
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

<svelte:window onkeydown={handleShortcut} />

<div class="gallery-view" class:sidebar-open={sidebarOpen} ontouchstart={startGesture} ontouchend={endGesture} role="application" aria-label="Album gallery">
  <button class="gallery-settings" onclick={() => sidebarOpen = !sidebarOpen} aria-label={sidebarOpen ? 'Close gallery sidebar' : 'Open gallery sidebar'}>{sidebarOpen ? '<' : '>'}</button>
  <aside aria-label="Gallery display settings" ontouchstart={startGesture} ontouchend={endGesture}>
    <small class="shortcut">⌘ /</small>
    <h2>GROUP BY</h2>
    <select bind:value={groupBy} onchange={persist} aria-label="Group albums by">
      <option value="none">NONE</option>
      <option value="tags">TAGS</option>
      <option value="artist">ARTISTS</option>
      <option value="year">YEAR</option>
      <option value="composer">COMPOSER</option>
      <option value="collection">COLLECTION</option>
      <option value="set">SET</option>
    </select>
    <h2>SORT</h2>
    <div class="sort-controls">
      <select bind:value={sortBy} onchange={persist} aria-label="Sort albums by">
        <option value="title">TITLE</option>
        <option value="artist">ARTIST</option>
        <option value="year">YEAR</option>
        <option value="composer">COMPOSER</option>
        <option value="collection">COLLECTION</option>
        <option value="set">SET</option>
      </select>
      <button onclick={() => { sortDescending = !sortDescending; persist(); }} aria-label="Reverse album sort">{sortDescending ? '↓' : '↑'}</button>
    </div>
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
  <div class="gallery-content">
    {#each albumGroups as group (group.label)}
      <section class="gallery-group">
        {#if groupBy !== 'none'}<h2>{group.label}<small>{group.items.length}</small></h2>{/if}
        <div class="gallery-grid" class:small={tileSize === 'small'} class:large={tileSize === 'large'}>
          {#each group.items as item (item.albumId ?? item.asset.workId)}
            <div class="swipe-container" style="position: relative; overflow: hidden; background: #000;">
              <div class="swipe-delete-indicator" style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: flex-end; padding-right: 20px; background: #8d453b; color: #fff; font-family: ui-monospace, monospace; font-size: 10px; font-weight: bold; pointer-events: none;">
                DELETE
              </div>
              <button 
                class="gallery-album" 
                onclick={(e) => handleSelect(item, e)}
                ontouchstart={(e) => onAlbumTouchStart(e, item.albumId ?? `work:${item.asset.workId}`)}
                ontouchmove={onAlbumTouchMove}
                ontouchend={(e) => onAlbumTouchEnd(e, item)}
                style={activeSwipeKey === (item.albumId ?? `work:${item.asset.workId}`) ? `transform: translateX(${activeSwipeOffset}px); transition: none; width: 100%;` : `transform: translateX(0); transition: transform 0.2s ease; width: 100%;`}
              >
                <span class="gallery-cover">
                  {#if item.coverUrl}<img src={item.coverUrl} alt="" />{:else}<span>{albumTitle(item).slice(0, 1)}</span>{/if}
                </span>
                {#if showTitle || showYear || showArtist || showTags}
                  <span class="gallery-meta">
                    {#if showTitle}<strong>{albumTitle(item)}</strong>{/if}
                    {#if showArtist}<small>{artist(item)}</small>{/if}
                    {#if showYear}<small>{item.releaseDate ?? '—'}</small>{/if}
                    {#if showTags && tags(item).length}<small>{tags(item).join(' · ')}</small>{/if}
                  </span>
                {/if}
              </button>
            </div>
          {/each}
        </div>
      </section>
    {/each}
  </div>
</div>

<style>
  .gallery-view{position:absolute;z-index:6;inset:0;background:#0b0c0b;overflow:hidden}.gallery-settings{position:absolute;z-index:7;top:12px;left:12px;width:40px;height:40px;border:0;background:#111310cc;color:var(--signal);font:20px ui-monospace,monospace}.gallery-content{height:100%;box-sizing:border-box;padding:12px 12px 150px;overflow:auto}.gallery-group>h2{display:flex;align-items:baseline;gap:10px;margin:44px 0 10px;color:#f2f3ef;font:12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em}.gallery-group>h2 small{color:var(--muted);font-size:8px}.gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));align-content:start;gap:2px}.gallery-grid.small{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}.gallery-grid.large{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}.gallery-album{min-width:0;padding:0;border:0;background:#111210;color:#fff;text-align:left}.gallery-cover{aspect-ratio:1;display:grid;place-items:center;overflow:hidden;background:#20231d;color:var(--signal);font:42px Georgia,serif}.gallery-cover img{width:100%;height:100%;object-fit:cover}.gallery-meta{min-height:62px;padding:9px;display:grid;align-content:start;gap:3px}.gallery-meta strong,.gallery-meta small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.gallery-meta strong{font-size:11px;font-weight:500}.gallery-meta small{color:var(--muted);font:8px ui-monospace,monospace}aside{position:absolute;z-index:5;top:0;bottom:0;left:0;width:min(280px,78vw);box-sizing:border-box;padding:72px 22px 30px;background:#151714f5;transform:translateX(-100%);transition:transform .25s ease;backdrop-filter:blur(18px);overflow:auto}.sidebar-open aside{transform:translateX(0)}.shortcut{position:absolute;top:25px;right:22px;color:var(--muted);font:8px ui-monospace,monospace}aside h2{margin:0 0 10px;color:var(--muted);font:9px ui-monospace,monospace;letter-spacing:.12em}aside h2:not(:first-of-type){margin-top:24px}aside label{min-height:42px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line);font:10px ui-monospace,monospace}aside input{accent-color:var(--signal)}aside select{width:100%;height:40px;border:1px solid var(--line);background:#20231d;color:#f2f3ef;padding:0 10px;font:9px ui-monospace,monospace}.sort-controls{display:grid;grid-template-columns:1fr 40px;gap:2px}.sort-controls button{border:0;background:var(--signal);color:#10110f;font:16px ui-monospace,monospace}.sizes{display:grid;grid-template-columns:repeat(3,1fr);gap:2px}.sizes button{height:40px;border:0;background:#20231d;color:var(--muted);font:10px ui-monospace,monospace}.sizes button.active{color:#10110f;background:var(--signal)}
</style>
