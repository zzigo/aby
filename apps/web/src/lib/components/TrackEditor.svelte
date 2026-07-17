<script lang="ts">
  import { untrack } from 'svelte';
  import type { CatalogItem } from '@zztt/aby-domain';

  let { item, onclose, onsaved }: { item: CatalogItem; onclose: () => void; onsaved: (item: CatalogItem) => void } = $props();
  let workTitle = $state(untrack(() => item.workTitle));
  let albumTitle = $state(untrack(() => item.albumTitle ?? ''));
  let recordingTitle = $state(untrack(() => item.recordingTitle));
  let trackNumber = $state<number | undefined>(untrack(() => item.trackNumber));
  let creator = $state(untrack(() => item.creator ?? ''));
  let date = $state(untrack(() => item.asset.canonicalMetadata.date ?? ''));
  let releaseDate = $state(untrack(() => item.releaseDate ?? ''));
  let label = $state(untrack(() => item.label ?? ''));
  let catalogNumber = $state(untrack(() => item.asset.canonicalMetadata.catalogNumber ?? ''));
  let artists = $state<Array<{ id: string; name: string; disambiguation: string }>>([]);
  let message = $state('');
  let busy = $state(false);
  let artistTimer: ReturnType<typeof setTimeout> | undefined;

  async function jsonRequest(path: string, options: Parameters<typeof fetch>[1]) {
    const response = await fetch(path, options);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? 'Request failed');
    return body;
  }

  function searchArtists() {
    clearTimeout(artistTimer);
    if (creator.trim().length < 2) { artists = []; return; }
    artistTimer = setTimeout(async () => {
      try {
        const body = await jsonRequest(`/api/metadata/artists?q=${encodeURIComponent(creator)}`, {});
        artists = body.artists;
      } catch { artists = []; }
    }, 280);
  }

  async function save() {
    busy = true; message = 'Saving…';
    try {
      const body = await jsonRequest(`/api/assets/${item.asset.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workTitle, albumTitle: albumTitle || null, recordingTitle,
          trackNumber: trackNumber || null, creator: creator || null, date: date || null,
          releaseDate: releaseDate || null, label: label || null, catalogNumber: catalogNumber || null
        })
      });
      onsaved(body.item); message = 'Saved';
    } catch (error) { message = error instanceof Error ? error.message : 'Save failed'; }
    finally { busy = false; }
  }

  async function regenerate() {
    busy = true; message = 'Refreshing MusicBrainz, AcoustID and cover candidates…';
    try {
      const body = await jsonRequest(`/api/assets/${item.asset.id}/metadata`, { method: 'POST' });
      onsaved(body.item); message = 'Metadata regenerated';
    } catch (error) { message = error instanceof Error ? error.message : 'Metadata refresh failed'; }
    finally { busy = false; }
  }

  async function convert() {
    busy = true; message = 'Rendering Ogg derivative…';
    try {
      const body = await jsonRequest(`/api/assets/${item.asset.id}/convert`, { method: 'POST' });
      onsaved(body.item); message = `${body.derivative.codec} Ogg ready`;
    } catch (error) { message = error instanceof Error ? error.message : 'Conversion failed'; }
    finally { busy = false; }
  }

  async function uploadCover(file: File | undefined) {
    if (!file) return;
    busy = true; message = 'Uploading cover…';
    try {
      const form = new FormData(); form.set('cover', file);
      const body = await jsonRequest(`/api/assets/${item.asset.id}/cover`, { method: 'POST', body: form });
      onsaved(body.item); message = 'Cover updated';
    } catch (error) { message = error instanceof Error ? error.message : 'Cover upload failed'; }
    finally { busy = false; }
  }
</script>

<div class="editor" role="dialog" aria-modal="true" aria-label={`Edit ${item.recordingTitle}`}>
  <header>
    <div><small>TRACK / {item.asset.id}</small><h1>{recordingTitle}</h1></div>
    <button class="close" onclick={onclose} aria-label="Close editor">×</button>
  </header>

  <main>
    <section class="canonical">
      <h2>Canonical</h2>
      <div class="grid">
        <label>Work<input bind:value={workTitle} /></label>
        <label>Album <small>optional</small><input bind:value={albumTitle} placeholder="Direct track when empty" /></label>
        <label>Track<input bind:value={recordingTitle} /></label>
        <label>Track no.<input type="number" min="1" bind:value={trackNumber} /></label>
        <label class="artist">Creator<input bind:value={creator} oninput={searchArtists} autocomplete="off" />
          {#if artists.length}<div class="suggestions">{#each artists as artist (artist.id)}<button onclick={() => { creator = artist.name; artists = []; }}>{artist.name}<small>{artist.disambiguation}</small></button>{/each}</div>{/if}
        </label>
        <label>Composition<input bind:value={date} /></label>
        <label>Release<input bind:value={releaseDate} /></label>
        <label>Label<input bind:value={label} /></label>
        <label>Catalog no.<input bind:value={catalogNumber} /></label>
      </div>
      <div class="dependencies"><span>WORK {item.asset.workId}</span><span>ALBUM {item.albumId ?? '—'}</span><span>TRACK {item.asset.recordingId}</span></div>
    </section>

    <section class="cover-section">
      <h2>Cover</h2>
      <label class="drop" ondragover={(event) => event.preventDefault()} ondrop={(event) => { event.preventDefault(); uploadCover(event.dataTransfer?.files[0]); }}>
        {#if item.coverUrl}<img src={item.coverUrl} alt="Current cover" />{:else}<span>DROP IMAGE</span>{/if}
        <input type="file" accept="image/jpeg,image/png,image/webp" onchange={(event) => uploadCover(event.currentTarget.files?.[0])} />
      </label>
    </section>

    <section class="emergent">
      <div class="section-title"><h2>Emergent / services</h2><button onclick={regenerate} disabled={busy}>↻ Refresh</button></div>
      <dl>
        <dt>MusicBrainz</dt><dd>{item.asset.canonicalMetadata.identificationCandidates?.[0]?.title ?? 'No candidate'}</dd>
        <dt>Wikidata</dt><dd>{item.asset.canonicalMetadata.wikidata?.label ?? 'No entity'}</dd>
        <dt>Artwork</dt><dd>{item.asset.canonicalMetadata.imageCandidates?.[0]?.authority ?? 'No candidate'}</dd>
      </dl>
      <pre>{JSON.stringify({ identification: item.asset.canonicalMetadata.identificationCandidates, wikidata: item.asset.canonicalMetadata.wikidata, images: item.asset.canonicalMetadata.imageCandidates }, null, 2)}</pre>
    </section>

    <section class="technical">
      <h2>Technical</h2>
      <dl>
        <dt>Source</dt><dd>{item.asset.objectKey}</dd><dt>SHA-256</dt><dd>{item.asset.checksumSha256}</dd>
        <dt>Format</dt><dd>{item.asset.technicalMetadata.formatName}</dd><dt>Duration</dt><dd>{item.asset.technicalMetadata.durationMs} ms</dd>
        <dt>Audio</dt><dd>{item.asset.technicalMetadata.audioCodec ?? '—'} · {item.asset.technicalMetadata.sampleRate ?? '—'} Hz · {item.asset.technicalMetadata.channels ?? '—'} ch</dd>
        <dt>Video</dt><dd>{item.asset.technicalMetadata.videoCodec ?? '—'} · {item.asset.technicalMetadata.width ?? '—'}×{item.asset.technicalMetadata.height ?? '—'}</dd>
      </dl>
      <pre>{JSON.stringify(item.asset.technicalMetadata, null, 2)}</pre>
    </section>
  </main>

  <footer><span>{message}</span><div><button onclick={convert} disabled={busy}>Convert Ogg</button><button class="save" onclick={save} disabled={busy}>Save</button></div></footer>
</div>

<style>
  .editor{position:fixed;inset:0;z-index:1000;background:#0b0c0b;color:#f2f3ef;display:grid;grid-template-rows:auto 1fr auto;font-family:ui-monospace,SFMono-Regular,monospace}
  header,footer{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #30332e}footer{border-top:1px solid #30332e;border-bottom:0}h1,h2{margin:0}h1{font-size:clamp(18px,3vw,32px);font-weight:500}h2{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9ba394;margin-bottom:14px}small{color:#7f867b}.close{font-size:36px;border:0;background:none;color:#fff}.editor>main{width:100%;min-height:0;margin:0;padding:0;overflow:auto;display:grid;grid-template-columns:minmax(0,2fr) minmax(220px,1fr)}section{padding:20px;border-right:1px solid #30332e;border-bottom:1px solid #30332e}.canonical,.technical{grid-column:1}.cover-section,.emergent{grid-column:2}.emergent{background:#151a14}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.grid label{font-size:10px;color:#9ba394;position:relative}.grid input{display:block;width:100%;box-sizing:border-box;margin-top:5px;background:#111310;color:#fff;border:1px solid #30332e;padding:11px;font:inherit}.artist{grid-column:span 2}.suggestions{position:absolute;z-index:2;left:0;right:0;background:#111310;border:1px solid #4c5348}.suggestions button{display:flex;justify-content:space-between;width:100%;padding:9px;border:0;border-bottom:1px solid #30332e;background:none;color:#fff}.dependencies{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.dependencies span{font-size:9px;color:#737a70;border:1px solid #30332e;padding:6px}.drop{min-height:220px;display:grid;place-items:center;border:1px dashed #596052;cursor:pointer;overflow:hidden}.drop img{width:100%;height:100%;max-height:360px;object-fit:contain}.drop input{display:none}.section-title{display:flex;justify-content:space-between;align-items:start}.section-title button,footer button{border:1px solid #4a5047;background:#111310;color:#fff;padding:9px 13px;font:inherit;font-size:10px}.save{background:#c8ff52!important;color:#10110f!important}.technical dl,.emergent dl{display:grid;grid-template-columns:110px 1fr;gap:8px;font-size:11px}.technical dt,.emergent dt{color:#7f867b}.technical dd,.emergent dd{margin:0;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:9px;color:#878e83;background:#090a09;padding:12px;max-height:240px;overflow:auto}footer>div{display:flex;gap:8px}footer>span{font-size:10px;color:#c8ff52}
  @media(max-width:720px){.editor>main{display:block}.grid{grid-template-columns:1fr}.artist{grid-column:auto}.editor header,.editor footer{padding:12px}.editor section{padding:14px;border-right:0}.drop{min-height:180px}footer span{max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
</style>
