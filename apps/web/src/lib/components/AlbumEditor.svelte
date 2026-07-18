<script lang="ts">
  import { untrack } from 'svelte';
  import type { AlbumRole, CatalogItem } from '@zztt/aby-domain';
  import { formatDuration } from '$lib/presentation';
  import MetadataQueryLab from './MetadataQueryLab.svelte';

  interface DiscogsCandidate {
    id: string;
    title: string;
    creator: string;
    year?: string;
    label?: string;
    catalogNumber?: string;
    coverUrl?: string;
    canonicalUrl: string;
    releaseDate?: string;
    country?: string;
    labels?: Array<{ name: string; catalogNumber?: string }>;
    companies?: Array<{ name: string; role?: string }>;
    credits?: Array<{ name: string; role: string; tracks?: string }>;
    genres?: string[];
    styles?: string[];
    formats?: Array<{ name: string; quantity?: string; descriptions?: string[] }>;
    tracklist?: Array<{ position?: string; title: string; duration?: string }>;
    dataQuality?: string;
    durationMs?: number;
    notes?: string;
  }

  let { items: initialItems, onclose, onsaved }: {
    items: CatalogItem[];
    onclose: () => void;
    onsaved: (items: CatalogItem[]) => void;
  } = $props();
  let albumItems = $state(untrack(() => initialItems));
  const first = $derived(albumItems[0]);
  const sourceTags = $derived(first?.asset.technicalMetadata.tags ?? {});
  const sourceTag = (...names: string[]) => {
    const wanted = new Set(names.map((name) => name.toLowerCase()));
    return Object.entries(sourceTags).find(([name]) => wanted.has(name.toLowerCase()))?.[1]?.trim() ?? '';
  };
  const embeddedAlbum = $derived(sourceTag('album'));
  const embeddedArtist = $derived(sourceTag('album_artist', 'albumartist', 'artist'));
  const embeddedDate = $derived(sourceTag('date', 'year'));
  const localDurationMs = $derived(albumItems.reduce((total, item) => total + item.asset.technicalMetadata.durationMs, 0));
  const canonicalCollectionCode = $derived(first?.asset.canonicalMetadata.collectionCode ?? '');
  const relocationPending = $derived(albumItems.reduce((count, item) => count +
    (item.asset.canonicalMetadata.storageRetirementCandidates ?? []).filter((candidate) => candidate.state === 'candidate').length, 0));
  let title = $state(untrack(() => initialItems[0]?.albumTitle ?? ''));
  let albumArtist = $state(untrack(() => initialItems[0]?.albumArtist ?? initialItems[0]?.creator ?? ''));
  let releaseDate = $state(untrack(() => initialItems[0]?.releaseDate ?? ''));
  let label = $state(untrack(() => initialItems[0]?.label ?? ''));
  let catalogNumber = $state(untrack(() => initialItems[0]?.asset.canonicalMetadata.catalogNumber ?? ''));
  let albumDuration = $state(untrack(() => initialItems[0]?.asset.canonicalMetadata.albumDurationMs !== undefined
    ? formatDuration(initialItems[0].asset.canonicalMetadata.albumDurationMs).replace(/\.00$/, '') : ''));
  let albumTags = $state(untrack(() => initialItems[0]?.asset.canonicalMetadata.albumTags?.join(', ') ?? ''));
  let genres = $state<string[]>(untrack(() => [...(initialItems[0]?.asset.canonicalMetadata.genres ?? [])]));
  let styles = $state<string[]>(untrack(() => [...(initialItems[0]?.asset.canonicalMetadata.styles ?? [])]));
  let roles = $state<AlbumRole[]>(untrack(() => structuredClone(initialItems[0]?.asset.canonicalMetadata.roles ?? [])));
  let notes = $state(untrack(() => initialItems[0]?.asset.canonicalMetadata.albumNotes ?? ''));
  let collectionCode = $state(untrack(() => initialItems[0]?.asset.canonicalMetadata.collectionCode ?? ''));
  let candidate = $state<DiscogsCandidate | null>(untrack(() => {
    const value = initialItems[0]?.asset.canonicalMetadata.discogs;
    return value && typeof value === 'object' ? value as unknown as DiscogsCandidate : null;
  }));
  let discogsCreator = $state(untrack(() => initialItems[0]?.albumArtist ?? initialItems[0]?.creator ?? ''));
  let discogsTitle = $state(untrack(() => initialItems[0]?.asset.technicalMetadata.tags.album ?? initialItems[0]?.albumTitle ?? ''));
  let discogsYear = $state(untrack(() => initialItems[0]?.asset.technicalMetadata.tags.date ?? initialItems[0]?.releaseDate ?? ''));
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

  function parseDuration(value: string): number | null {
    const clean = value.trim();
    if (!clean) return null;
    const parts = clean.split(':').map(Number);
    if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isFinite(part) || part < 0)) {
      throw new Error('Use MM:SS or HH:MM:SS for album duration');
    }
    const seconds = parts.at(-1)!;
    const minutes = parts.at(-2)!;
    if (seconds >= 60 || (parts.length === 3 && minutes >= 60)) throw new Error('Album duration has an invalid clock value');
    const hours = parts.length === 3 ? parts[0]! : 0;
    return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
  }

  const csv = (value: string) => [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))];

  function addAlbumTag(value: string) {
    const current = csv(albumTags);
    if (!current.some((tag) => tag.toLocaleLowerCase() === value.toLocaleLowerCase())) current.push(value);
    albumTags = current.join(', ');
  }

  function removeAlbumTag(value: string) {
    albumTags = csv(albumTags).filter((tag) => tag.toLocaleLowerCase() !== value.toLocaleLowerCase()).join(', ');
  }

  function addRole() {
    roles = [...roles, { name: '', role: '', tracks: '' }];
  }

  function removeRole(index: number) {
    roles = roles.filter((_, roleIndex) => roleIndex !== index);
  }

  function albumPayload() {
    return {
      title,
      albumArtist: albumArtist || null,
      releaseDate: releaseDate || null,
      label: label || null,
      catalogNumber: catalogNumber || null,
      albumDurationMs: parseDuration(albumDuration),
      albumTags: csv(albumTags),
      genres,
      styles,
      roles: roles.filter((role) => role.name.trim() && role.role.trim()).map((role) => ({
        ...role, name: role.name.trim(), role: role.role.trim(),
        ...(role.tracks?.trim() ? { tracks: role.tracks.trim() } : { tracks: undefined })
      })),
      notes: notes || null
    };
  }

  async function save() {
    if (!first) return;
    busy = true;
    message = 'Saving…';
    try {
      const body = await jsonRequest(`/api/albums/${first.albumId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(albumPayload())
      });
      acceptItems(body.items);
      message = 'Saved';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Save failed';
    } finally {
      busy = false;
    }
  }

  async function writeId3() {
    if (!first) return;
    busy = true;
    message = 'Saving album and writing ID3 copies…';
    try {
      const saved = await jsonRequest(`/api/albums/${first.albumId}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(albumPayload())
      });
      acceptItems(saved.items);
      let offset = 0;
      let total = albumItems.filter((item) => item.asset.objectKey.toLowerCase().endsWith('.mp3')).length;
      do {
        const body = await jsonRequest(`/api/albums/${first.albumId}/id3`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ offset, limit: 5 })
        });
        total = body.total;
        offset = body.nextOffset ?? body.processed;
        message = `ID3 ${body.processed}/${body.total} · audio streams unchanged`;
      } while (offset < total);
      message = `${total} ID3 ${total === 1 ? 'copy' : 'copies'} ready · audio streams unchanged`;
    } catch (error) {
      message = error instanceof Error ? error.message : 'ID3 write failed';
    } finally {
      busy = false;
    }
  }

  async function relocateCollection() {
    if (!first || !collectionCode.trim()) return;
    busy = true;
    message = `Copying ${canonicalCollectionCode} → ${collectionCode.toUpperCase()}…`;
    try {
      let remaining = 1;
      let copied = 0;
      while (remaining > 0) {
        const body = await jsonRequest(`/api/albums/${first.albumId}/relocate`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ collectionCode, limit: 3 })
        });
        copied += body.copied;
        remaining = body.remaining;
        acceptItems(body.items);
        message = `Verified ${copied} copies · ${remaining} remaining`;
      }
      message = `${copied} assets moved logically · old copies retained`;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Relocation failed';
    } finally {
      busy = false;
    }
  }

  async function retireOldCopies() {
    if (!first || !relocationPending) return;
    busy = true;
    message = `Deleting ${relocationPending} verified old copies…`;
    try {
      let remaining = relocationPending;
      let retired = 0;
      while (remaining > 0) {
        const body = await jsonRequest(`/api/albums/${first.albumId}/relocate`, {
          method: 'DELETE', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ limit: 5 })
        });
        retired += body.retired;
        remaining = body.remaining;
        acceptItems(body.items);
        message = `Deleted ${retired} old copies · ${remaining} remaining`;
        if (!body.retired && remaining) throw new Error('Old copies could not be retired safely');
      }
      message = `${retired} verified old copies deleted`;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Old-copy cleanup failed';
    } finally {
      busy = false;
    }
  }

  async function refreshDiscogs() {
    if (!first) return;
    busy = true;
    message = 'Searching Discogs…';
    try {
      const body = await jsonRequest(`/api/albums/${first.albumId}/metadata`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ creator: discogsCreator, albumTitle: discogsTitle, year: discogsYear })
      });
      candidate = body.candidate;
      message = 'Discogs candidate ready for review';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Discogs search failed';
    } finally {
      busy = false;
    }
  }

  async function applyDiscogs() {
    if (!first || !candidate) return;
    busy = true;
    message = 'Applying release metadata…';
    try {
      const body = await jsonRequest(`/api/albums/${first.albumId}/metadata`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ releaseId: candidate.id })
      });
      const applied = body.candidate as DiscogsCandidate;
      candidate = applied;
      title = applied.title;
      albumArtist = applied.creator;
      if (applied.notes && !notes.trim()) notes = applied.notes;
      releaseDate = applied.releaseDate || applied.year || '';
      label = applied.label || '';
      catalogNumber = applied.catalogNumber || '';
      acceptItems(body.items);
      const canonical = (body.items as CatalogItem[])[0]?.asset.canonicalMetadata;
      albumDuration = canonical?.albumDurationMs !== undefined ? formatDuration(canonical.albumDurationMs).replace(/\.00$/, '') : '';
      albumTags = canonical?.albumTags?.join(', ') ?? '';
      genres = [...(canonical?.genres ?? [])];
      styles = [...(canonical?.styles ?? [])];
      roles = structuredClone(canonical?.roles ?? []);
      message = `Applied to ${body.items.length} track${body.items.length === 1 ? '' : 's'}`;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Discogs apply failed';
    } finally {
      busy = false;
    }
  }

  function useEmbedded() {
    if (embeddedAlbum) title = embeddedAlbum;
    if (embeddedArtist) albumArtist = embeddedArtist;
    if (embeddedDate) releaseDate = embeddedDate;
    discogsCreator = albumArtist;
    discogsTitle = title;
    discogsYear = releaseDate;
    message = 'Embedded tags loaded for review';
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

  async function pasteCover() {
    if (!navigator.clipboard?.read) { message = 'Clipboard images are not available in this browser'; return; }
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const clipboardItem of clipboardItems) {
        const imageType = clipboardItem.types.find((type) => ['image/jpeg', 'image/png', 'image/webp'].includes(type));
        if (!imageType) continue;
        const blob = await clipboardItem.getType(imageType);
        const extension = imageType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
        await uploadCover(new File([blob], `clipboard-cover.${extension}`, { type: imageType }));
        return;
      }
      message = 'Clipboard does not contain a JPEG, PNG or WebP image';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Clipboard image could not be read';
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
          <label>Album artist<input bind:value={albumArtist} /></label>
          <label>Release<input bind:value={releaseDate} /></label>
          <label>Label<input bind:value={label} /></label>
          <label>Catalog no.<input bind:value={catalogNumber} /></label>
          <label>Declared duration<input bind:value={albumDuration} placeholder="MM:SS or HH:MM:SS" /></label>
          <label class="wide-field">Album tags<input bind:value={albumTags} placeholder="opera, contemporary" /></label>
          <label>Collection<input bind:value={collectionCode} placeholder="18, 20E, 20L…" /></label>
          <label class="wide-field">Notes<textarea bind:value={notes} placeholder="Manual notes · Ollama extraction will be available here"></textarea></label>
        </div>
        <div class="duration-compare"><span>DECLARED {albumDuration || '—'}</span><span>ASSETS {formatDuration(localDurationMs)}</span></div>
        <div class="relocation-actions">
          {#if collectionCode.trim().toUpperCase() !== canonicalCollectionCode}
            <button onclick={relocateCollection} disabled={busy}>COPY + VERIFY {canonicalCollectionCode} → {collectionCode.trim().toUpperCase()}</button>
          {/if}
          {#if relocationPending}<button class="retire" onclick={retireOldCopies} disabled={busy}>DELETE {relocationPending} VERIFIED OLD COPIES</button>{/if}
        </div>
        <div class="dependencies"><span>WORK {first.asset.workId}</span><span>ALBUM {first.albumId}</span><span>{albumItems.length} TRACKS INHERIT RELEASE FIELDS</span></div>
      </section>

      <section class="cover-section">
        <div class="section-title"><h2>Cover</h2><div class="cover-actions"><button onclick={pasteCover} disabled={busy}>Paste image</button><button onclick={refreshDiscogs} disabled={busy}>↻ Discogs</button></div></div>
        <label class="drop" ondragover={(event) => event.preventDefault()} ondrop={(event) => { event.preventDefault(); uploadCover(event.dataTransfer?.files[0]); }}>
          {#if first.coverUrl}<img src={first.coverUrl} alt={`Cover for ${title}`} />{:else}<span>DROP IMAGE</span>{/if}
          <input type="file" accept="image/jpeg,image/png,image/webp" onchange={(event) => uploadCover(event.currentTarget.files?.[0])} />
        </label>
      </section>

      <section class="tracks">
        <div class="section-title"><h2>Tracks</h2><small>Title, number and technical data remain track-specific</small></div>
        <ol>
          {#each albumItems as item (item.asset.id)}
            <li><span>{item.trackNumber ?? '—'}</span><strong>{item.recordingTitle.replace(/^track\s+/i, '')}</strong><small>{item.asset.technicalMetadata.formatName}</small></li>
          {/each}
        </ol>
      </section>

      <section class="roles-section">
        <div class="section-title"><h2>Roles</h2><button onclick={addRole}>+ role</button></div>
        <div class="roles">
          {#each roles as credit, index (`${credit.externalId ?? 'manual'}:${index}`)}
            <div class="role-row">
              <input bind:value={credit.name} aria-label={`Role ${index + 1} person`} placeholder="person / entity" />
              <input bind:value={credit.role} aria-label={`Role ${index + 1} function`} placeholder="role" />
              <input bind:value={credit.tracks} aria-label={`Role ${index + 1} scope`} placeholder="all or 1-4" />
              <button onclick={() => removeRole(index)} aria-label={`Remove ${credit.name || 'role'}`}>−</button>
            </div>
          {/each}
        </div>
      </section>

      <section class="embedded">
        <div class="section-title"><h2>Embedded source tags</h2><button onclick={useEmbedded} disabled={busy || (!embeddedAlbum && !embeddedArtist && !embeddedDate)}>Use fields</button></div>
        <dl>
          <dt>Album</dt><dd>{embeddedAlbum || '—'}</dd>
          <dt>Artist</dt><dd class:conflict={embeddedArtist.includes('�')}>{embeddedArtist || '—'}</dd>
          <dt>Date</dt><dd>{embeddedDate || '—'}</dd>
        </dl>
        {#if embeddedArtist.includes('�')}<p class="warning">The source artist contains a damaged character. Review it before applying.</p>{/if}
      </section>

      <section class="descriptors">
        <h2>Descriptors → Aby tags</h2>
        <div class="tag-list canonical-tags">
          {#each csv(albumTags) as tag (tag)}<button onclick={() => removeAlbumTag(tag)} title="Remove from album tags">{tag} −</button>{/each}
        </div>
        <h3>Styles</h3>
        <div class="tag-list">
          {#each styles as style (style)}<button onclick={() => addAlbumTag(style)} class:linked={csv(albumTags).some((tag) => tag.toLocaleLowerCase() === style.toLocaleLowerCase())}>+ {style}</button>{/each}
        </div>
        <h3>Legacy genres</h3>
        <div class="tag-list legacy">
          {#each genres as genre (genre)}<button onclick={() => addAlbumTag(genre)} class:linked={csv(albumTags).some((tag) => tag.toLocaleLowerCase() === genre.toLocaleLowerCase())}>+ {genre}</button>{/each}
        </div>
        <p>Styles seed album tags. Genres remain imported descriptors until explicitly bridged.</p>
      </section>

      <section class="discogs">
        <div class="section-title"><h2>Discogs</h2><button onclick={refreshDiscogs} disabled={busy}>↻ Refresh</button></div>
        <div class="discogs-query">
          <input bind:value={discogsCreator} aria-label="Discogs album artist" placeholder="album artist" />
          <input bind:value={discogsTitle} aria-label="Discogs release title" placeholder="release" />
          <input bind:value={discogsYear} aria-label="Discogs release year" placeholder="year" />
        </div>
        {#if candidate}
          <dl>
            <dt>Release</dt><dd>{candidate.title}</dd>
            <dt>Artist</dt><dd>{candidate.creator}</dd>
            <dt>Year</dt><dd>{candidate.year ?? '—'}</dd>
            <dt>Label</dt><dd>{candidate.label ?? '—'}</dd>
            <dt>Catalog</dt><dd>{candidate.catalogNumber ?? '—'}</dd>
            <dt>Country</dt><dd>{candidate.country ?? '—'}</dd>
            <dt>Duration</dt><dd>{candidate.durationMs !== undefined ? formatDuration(candidate.durationMs) : '—'}</dd>
            <dt>Genres</dt><dd>{[...(candidate.genres ?? []), ...(candidate.styles ?? [])].join(' · ') || '—'}</dd>
            <dt>Companies</dt><dd>{candidate.companies?.map((company) => `${company.name}${company.role ? ` (${company.role})` : ''}`).join(' · ') || '—'}</dd>
            <dt>Credits</dt><dd>{candidate.credits?.map((credit) => `${credit.role}: ${credit.name}${credit.tracks ? ` [${credit.tracks}]` : ''}`).join(' · ') || '—'}</dd>
            <dt>Tracklist</dt><dd>{candidate.tracklist?.map((track) => `${track.position || '—'} ${track.title}${track.duration ? ` ${track.duration}` : ''}`).join(' · ') || '—'}</dd>
          </dl>
          <button class="apply" onclick={applyDiscogs} disabled={busy}>Apply release to album + {albumItems.length} tracks</button>
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <a href={candidate.canonicalUrl} target="_blank" rel="noreferrer">Data provided by Discogs.</a>
        {:else}
          <p>No candidate</p>
        {/if}
      </section>
      <section class="queries" style="grid-column:1">
        <h2>Service queries</h2>
        <MetadataQueryLab assetId={first.asset.id} creator={albumArtist} trackTitle={first.recordingTitle} albumTitle={title} year={releaseDate} durationMs={first.asset.technicalMetadata.durationMs} />
      </section>
    </main>

    <footer>
      <div><span>{message}</span><small>This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. “Discogs” is a trademark of Zink Media, LLC.</small></div>
      <div class="footer-actions"><button onclick={writeId3} disabled={busy}>Write ID3 copies</button><button class="save" onclick={save} disabled={busy}>Save album</button></div>
    </footer>
  </div>
{/if}

<style>
  .album-editor{position:fixed;inset:0;z-index:1100;background:#0b0c0b;color:#f2f3ef;display:grid;grid-template-rows:auto 1fr auto;font-family:ui-monospace,SFMono-Regular,monospace}
  header,footer{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #30332e}footer{border-top:1px solid #30332e;border-bottom:0;gap:20px}footer>div{display:grid;gap:5px;max-width:760px}h1,h2{margin:0}h1{font-size:clamp(18px,3vw,32px);font-weight:500}h2{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9ba394;margin-bottom:14px}small{color:#7f867b}.close{font-size:36px;border:0;background:none;color:#fff}.album-editor>main{width:100%;min-height:0;margin:0;padding:0;overflow:auto;display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr)}section{padding:20px;border-right:1px solid #30332e;border-bottom:1px solid #30332e}.canonical,.tracks,.embedded{grid-column:1}.cover-section,.discogs{grid-column:2}.discogs,.embedded{background:#151a14}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.grid label{font-size:10px;color:#9ba394}.grid input,.grid textarea{display:block;width:100%;box-sizing:border-box;margin-top:5px;background:#111310;color:#fff;border:1px solid #30332e;padding:11px;font:inherit}.grid textarea{min-height:110px;resize:vertical}.dependencies{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.dependencies span{font-size:9px;color:#737a70;border:1px solid #30332e;padding:6px}.drop{min-height:260px;display:grid;place-items:center;border:1px dashed #596052;cursor:pointer;overflow:hidden}.drop img{width:100%;height:100%;max-height:420px;object-fit:contain}.drop input{display:none}.section-title{display:flex;justify-content:space-between;align-items:start;gap:12px}.section-title button,footer button,.discogs .apply{border:1px solid #4a5047;background:#111310;color:#fff;padding:9px 13px;font:inherit;font-size:10px}.tracks ol{list-style:none;padding:0;margin:0}.tracks li{display:grid;grid-template-columns:44px 1fr auto;gap:10px;padding:10px 0;border-bottom:1px solid #252823;font-size:11px}.tracks li>span,.tracks li>small{color:#7f867b}.tracks li>strong{font-weight:500}.embedded dl,.discogs dl{display:grid;grid-template-columns:90px 1fr;gap:8px;font-size:11px}.embedded dt,.discogs dt{color:#7f867b}.embedded dd,.discogs dd{margin:0;overflow-wrap:anywhere}.embedded .conflict,.warning{color:#ff9b7a}.discogs-query{display:grid;grid-template-columns:1fr 1.4fr 64px;gap:6px;margin-bottom:14px}.discogs-query input{min-width:0;background:#0d0f0d;color:#fff;border:1px solid #353a32;padding:8px;font:9px ui-monospace,monospace}.discogs a{display:inline-block;margin-top:14px;color:#c8ff52;font-size:10px}.discogs p{font-size:11px;color:#7f867b}.discogs .apply{width:100%;margin-top:14px;background:#c8ff52;color:#10110f}.save{background:#c8ff52!important;color:#10110f!important}footer span{font-size:10px;color:#c8ff52}footer small{font-size:8px;line-height:1.35}
  .wide-field{grid-column:1/-1}.duration-compare{display:flex;gap:8px;margin-top:10px}.duration-compare span{font-size:9px;color:#7f867b}.roles-section{grid-column:1}.roles{display:grid;gap:6px}.role-row{display:grid;grid-template-columns:1.4fr 1fr .7fr 34px;gap:6px}.role-row input{min-width:0;background:#0d0f0d;color:#fff;border:1px solid #353a32;padding:8px;font:9px ui-monospace,monospace}.role-row button,.descriptors button{border:1px solid #4a5047;background:#111310;color:#fff;font:9px ui-monospace,monospace}.descriptors{grid-column:2;background:#151a14}.descriptors h3{margin:16px 0 7px;color:#7f867b;font-size:9px;text-transform:uppercase}.tag-list{display:flex;flex-wrap:wrap;gap:5px}.tag-list button{padding:6px 8px}.tag-list button.linked{border-color:#c8ff52;color:#c8ff52}.tag-list.legacy button{color:#9b9f98}.descriptors p{font-size:9px;color:#7f867b;line-height:1.5}.canonical-tags button{background:#c8ff52;color:#10110f}.footer-actions{display:flex!important;gap:8px;max-width:none!important}
  .relocation-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.relocation-actions button{border:1px solid var(--signal);background:transparent;color:var(--signal);padding:8px;font:9px ui-monospace,monospace}.relocation-actions .retire{border-color:#ff8e78;color:#ff8e78}
  .cover-actions{display:flex;gap:5px}
  @media(max-width:720px){.album-editor>main{display:block}.grid{grid-template-columns:1fr}.album-editor header,.album-editor footer{padding:12px}.album-editor section{padding:14px;border-right:0}.drop{min-height:190px}footer>div{max-width:65%}footer small{display:none}}
</style>
