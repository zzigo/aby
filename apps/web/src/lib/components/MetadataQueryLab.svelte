<script lang="ts">
  import { untrack } from 'svelte';

  let { assetId, creator: initialCreator, trackTitle: initialTrackTitle, albumTitle: initialAlbumTitle, year: initialYear, durationMs }: {
    assetId: string;
    creator: string;
    trackTitle: string;
    albumTitle: string;
    year: string;
    durationMs: number;
  } = $props();

  let musicBrainzCreator = $state(untrack(() => initialCreator));
  let musicBrainzTitle = $state(untrack(() => initialTrackTitle));
  let wikidataQuery = $state(untrack(() => initialCreator));
  let artworkCreator = $state(untrack(() => initialCreator));
  let artworkAlbum = $state(untrack(() => initialAlbumTitle || initialTrackTitle));
  let discogsCreator = $state(untrack(() => initialCreator));
  let discogsAlbum = $state(untrack(() => initialAlbumTitle || initialTrackTitle));
  let discogsYear = $state(untrack(() => initialYear));
  let busy = $state<string | null>(null);
  let results = $state<Record<string, unknown>>({});
  let errors = $state<Record<string, string>>({});

  async function query(service: string, body: Record<string, unknown>) {
    busy = service;
    errors = { ...errors, [service]: '' };
    try {
      const response = await fetch('/api/metadata/query', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ service, ...body })
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error?.message ?? 'Query failed');
      results = { ...results, [service]: value.result };
    } catch (error) {
      errors = { ...errors, [service]: error instanceof Error ? error.message : 'Query failed' };
    } finally {
      busy = null;
    }
  }
</script>

<div class="query-lab">
  <div class="service-row">
    <strong>MusicBrainz</strong>
    <input bind:value={musicBrainzCreator} aria-label="MusicBrainz artist query" placeholder="artist" />
    <input bind:value={musicBrainzTitle} aria-label="MusicBrainz recording query" placeholder="recording" />
    <button onclick={() => query('musicbrainz', { creator: musicBrainzCreator, title: musicBrainzTitle, durationMs })} disabled={busy !== null} title="Query MusicBrainz">↻</button>
    {#if errors.musicbrainz}<small>{errors.musicbrainz}</small>{:else if 'musicbrainz' in results}<pre>{JSON.stringify(results.musicbrainz, null, 2)}</pre>{/if}
  </div>
  <div class="service-row">
    <strong>Wikidata</strong>
    <input class="wide" bind:value={wikidataQuery} aria-label="Wikidata entity query" placeholder="entity" />
    <button onclick={() => query('wikidata', { query: wikidataQuery })} disabled={busy !== null} title="Query Wikidata">↻</button>
    {#if errors.wikidata}<small>{errors.wikidata}</small>{:else if 'wikidata' in results}<pre>{JSON.stringify(results.wikidata, null, 2)}</pre>{/if}
  </div>
  <div class="service-row">
    <strong>Cover Art</strong>
    <input bind:value={artworkCreator} aria-label="Cover Art artist query" placeholder="artist" />
    <input bind:value={artworkAlbum} aria-label="Cover Art album query" placeholder="album" />
    <button onclick={() => query('cover-art', { creator: artworkCreator, albumTitle: artworkAlbum })} disabled={busy !== null} title="Query Cover Art Archive">↻</button>
    {#if errors['cover-art']}<small>{errors['cover-art']}</small>{:else if 'cover-art' in results}<pre>{JSON.stringify(results['cover-art'], null, 2)}</pre>{/if}
  </div>
  <div class="service-row">
    <strong>Discogs</strong>
    <input bind:value={discogsCreator} aria-label="Discogs artist query" placeholder="artist" />
    <input bind:value={discogsAlbum} aria-label="Discogs release query" placeholder="release" />
    <input class="year" bind:value={discogsYear} aria-label="Discogs year query" placeholder="year" />
    <button onclick={() => query('discogs', { creator: discogsCreator, albumTitle: discogsAlbum, year: discogsYear })} disabled={busy !== null} title="Query Discogs">↻</button>
    {#if errors.discogs}<small>{errors.discogs}</small>{:else if 'discogs' in results}<pre>{JSON.stringify(results.discogs, null, 2)}</pre>{/if}
  </div>
  <div class="service-row compact">
    <strong>AcoustID</strong>
    <span>current audio fingerprint</span>
    <button onclick={() => query('acoustid', { assetId })} disabled={busy !== null} title="Fingerprint and query AcoustID">↻</button>
    {#if errors.acoustid}<small>{errors.acoustid}</small>{:else if 'acoustid' in results}<pre>{JSON.stringify(results.acoustid, null, 2)}</pre>{/if}
  </div>
</div>

<style>
  .query-lab{display:grid}.service-row{display:grid;grid-template-columns:92px minmax(90px,1fr) minmax(90px,1fr) 34px;gap:6px;align-items:center;padding:9px 0;border-bottom:1px solid #2d312b}.service-row:has(.year){grid-template-columns:92px minmax(80px,1fr) minmax(80px,1fr) 62px 34px}.service-row.compact{grid-template-columns:92px 1fr 34px}.service-row strong{font-size:9px;color:#c8ff52}.service-row span{font-size:9px;color:#7f867b}.service-row input{min-width:0;width:100%;background:#0d0f0d;color:#fff;border:1px solid #353a32;padding:7px;font:9px ui-monospace,monospace}.service-row button{height:30px;border:1px solid #4a5047;background:#111310;color:#fff}.service-row small,.service-row pre{grid-column:2/-1;margin:0}.service-row small{font-size:9px;color:#ff8f76}.service-row pre{max-height:150px;overflow:auto;white-space:pre-wrap;background:#090a09;color:#9ca394;padding:8px;font-size:8px}.wide{grid-column:2/4}
  @media(max-width:720px){.service-row,.service-row:has(.year){grid-template-columns:74px 1fr 34px}.service-row input{grid-column:2}.service-row button{grid-column:3;grid-row:1}.service-row strong{grid-row:1}.service-row .year{grid-column:2}.service-row small,.service-row pre{grid-column:1/-1}}
</style>
