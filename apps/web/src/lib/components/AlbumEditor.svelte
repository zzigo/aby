<script lang="ts">
  import { untrack } from 'svelte';
  import type { CatalogItem } from '@zztt/aby-domain';

  interface DiscogsCandidate {
    id: string;
    title: string;
    creator: string;
    year?: string;
    label?: string;
    catalogNumber?: string;
    coverUrl?: string;
    canonicalUrl: string;
  }

  let { items: initialItems, onclose, onsaved }: {
    items: CatalogItem[];
    onclose: () => void;
    onsaved: (items: CatalogItem[]) => void;
  } = $props();
  let albumItems = $state(untrack(() => initialItems));
  const first = $derived(albumItems[0]);
  let title = $state(untrack(() => initialItems[0]?.albumTitle ?? ''));
  let creator = $state(untrack(() => initialItems[0]?.creator ?? ''));
  let releaseDate = $state(untrack(() => initialItems[0]?.releaseDate ?? ''));
  let label = $state(untrack(() => initialItems[0]?.label ?? ''));
  let catalogNumber = $state(untrack(() => initialItems[0]?.asset.canonicalMetadata.catalogNumber ?? ''));
  let candidate = $state<DiscogsCandidate | null>(untrack(() => {
    const value = initialItems[0]?.asset.canonicalMetadata.discogs;
    return value && typeof value === 'object' ? value as unknown as DiscogsCandidate : null;
  }));
  let message = $state('');
  let busy = $state(false);

  async function jsonRequest(path: string, options: Parameters<typeof fetch>[1]) {
    const response = await fetch(path, options);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? 'Request failed');
    return body;
  }

  function acceptItems(updated: CatalogItem[]) {
    albumItems = updated;
    onsaved(updated);
  }

  async function save() {
    if (!first) return;
    busy = true;
    message = 'Saving…';
    try {
      const body = await jsonRequest(`/api/albums/${first.albumId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          creator: creator || null,
          releaseDate: releaseDate || null,
          label: label || null,
          catalogNumber: catalogNumber || null
        })
      });
      acceptItems(body.items);
      message = 'Saved';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Save failed';
    } finally {
      busy = false;
    }
  }

  async function refreshDiscogs() {
    if (!first) return;
    busy = true;
    message = 'Searching Discogs…';
    try {
      const body = await jsonRequest(`/api/albums/${first.albumId}/metadata`, { method: 'POST' });
      candidate = body.candidate;
      title = candidate?.title || title;
      creator = candidate?.creator || creator;
      releaseDate = candidate?.year || releaseDate;
      label = candidate?.label || label;
      catalogNumber = candidate?.catalogNumber || catalogNumber;
      acceptItems(body.items);
      message = 'Discogs candidate loaded';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Discogs search failed';
    } finally {
      busy = false;
    }
  }

  async function uploadCover(file?: File) {
    if (!file || !first) return;
    busy = true;
    message = 'Uploading cover…';
    try {
      const form = new FormData();
      form.set('cover', file);
      const body = await jsonRequest(`/api/albums/${first.albumId}/cover`, { method: 'POST', body: form });
      acceptItems(body.items);
      message = 'Cover updated';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Cover upload failed';
    } finally {
      busy = false;
    }
  }
</script>

{#if first}
  <div class="album-editor" role="dialog" aria-modal="true" aria-label={`Edit album ${title}`}>
    <header>
      <div><small>ALBUM / {first.albumId}</small><h1>{title}</h1></div>
      <button class="close" onclick={onclose} aria-label="Close album editor">×</button>
    </header>

    <main>
      <section class="canonical">
        <h2>Album</h2>
        <div class="grid">
          <label>Title<input bind:value={title} /></label>
          <label>Creator<input bind:value={creator} /></label>
          <label>Release<input bind:value={releaseDate} /></label>
          <label>Label<input bind:value={label} /></label>
          <label>Catalog no.<input bind:value={catalogNumber} /></label>
        </div>
        <div class="dependencies"><span>WORK {first.asset.workId}</span><span>ALBUM {first.albumId}</span><span>{albumItems.length} TRACKS</span></div>
      </section>

      <section class="cover-section">
        <div class="section-title"><h2>Cover</h2><button onclick={refreshDiscogs} disabled={busy}>↻ Discogs</button></div>
        <label class="drop" ondragover={(event) => event.preventDefault()} ondrop={(event) => { event.preventDefault(); uploadCover(event.dataTransfer?.files[0]); }}>
          {#if first.coverUrl}<img src={first.coverUrl} alt={`Cover for ${title}`} />{:else}<span>DROP IMAGE</span>{/if}
          <input type="file" accept="image/jpeg,image/png,image/webp" onchange={(event) => uploadCover(event.currentTarget.files?.[0])} />
        </label>
      </section>

      <section class="tracks">
        <h2>Tracks</h2>
        <ol>
          {#each albumItems as item (item.asset.id)}
            <li><span>{item.trackNumber ?? '—'}</span><strong>{item.recordingTitle}</strong><small>{item.asset.technicalMetadata.formatName}</small></li>
          {/each}
        </ol>
      </section>

      <section class="discogs">
        <div class="section-title"><h2>Discogs</h2><button onclick={refreshDiscogs} disabled={busy}>↻ Refresh</button></div>
        {#if candidate}
          <dl>
            <dt>Release</dt><dd>{candidate.title}</dd>
            <dt>Artist</dt><dd>{candidate.creator}</dd>
            <dt>Year</dt><dd>{candidate.year ?? '—'}</dd>
            <dt>Label</dt><dd>{candidate.label ?? '—'}</dd>
            <dt>Catalog</dt><dd>{candidate.catalogNumber ?? '—'}</dd>
          </dl>
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a href={candidate.canonicalUrl} target="_blank" rel="noreferrer">Data provided by Discogs.</a>
        {:else}
          <p>No candidate</p>
        {/if}
      </section>
    </main>

    <footer>
      <div><span>{message}</span><small>This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. “Discogs” is a trademark of Zink Media, LLC.</small></div>
      <button class="save" onclick={save} disabled={busy}>Save album</button>
    </footer>
  </div>
{/if}

<style>
  .album-editor{position:fixed;inset:0;z-index:1100;background:#0b0c0b;color:#f2f3ef;display:grid;grid-template-rows:auto 1fr auto;font-family:ui-monospace,SFMono-Regular,monospace}
  header,footer{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #30332e}footer{border-top:1px solid #30332e;border-bottom:0;gap:20px}footer>div{display:grid;gap:5px;max-width:760px}h1,h2{margin:0}h1{font-size:clamp(18px,3vw,32px);font-weight:500}h2{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9ba394;margin-bottom:14px}small{color:#7f867b}.close{font-size:36px;border:0;background:none;color:#fff}.album-editor>main{width:100%;min-height:0;margin:0;padding:0;overflow:auto;display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr)}section{padding:20px;border-right:1px solid #30332e;border-bottom:1px solid #30332e}.canonical,.tracks{grid-column:1}.cover-section,.discogs{grid-column:2}.discogs{background:#151a14}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.grid label{font-size:10px;color:#9ba394}.grid input{display:block;width:100%;box-sizing:border-box;margin-top:5px;background:#111310;color:#fff;border:1px solid #30332e;padding:11px;font:inherit}.dependencies{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.dependencies span{font-size:9px;color:#737a70;border:1px solid #30332e;padding:6px}.drop{min-height:260px;display:grid;place-items:center;border:1px dashed #596052;cursor:pointer;overflow:hidden}.drop img{width:100%;height:100%;max-height:420px;object-fit:contain}.drop input{display:none}.section-title{display:flex;justify-content:space-between;align-items:start}.section-title button,footer button{border:1px solid #4a5047;background:#111310;color:#fff;padding:9px 13px;font:inherit;font-size:10px}.tracks ol{list-style:none;padding:0;margin:0}.tracks li{display:grid;grid-template-columns:44px 1fr auto;gap:10px;padding:10px 0;border-bottom:1px solid #252823;font-size:11px}.tracks li>span,.tracks li>small{color:#7f867b}.tracks li>strong{font-weight:500}.discogs dl{display:grid;grid-template-columns:90px 1fr;gap:8px;font-size:11px}.discogs dt{color:#7f867b}.discogs dd{margin:0;overflow-wrap:anywhere}.discogs a{display:inline-block;margin-top:14px;color:#c8ff52;font-size:10px}.discogs p{font-size:11px;color:#7f867b}.save{background:#c8ff52!important;color:#10110f!important}footer span{font-size:10px;color:#c8ff52}footer small{font-size:8px;line-height:1.35}
  @media(max-width:720px){.album-editor>main{display:block}.grid{grid-template-columns:1fr}.album-editor header,.album-editor footer{padding:12px}.album-editor section{padding:14px;border-right:0}.drop{min-height:190px}footer>div{max-width:65%}footer small{display:none}}
</style>
