<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { AlbumRole, AlbumSet, CatalogItem } from '@zztt/aby-domain';
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
    tracklist?: Array<{ position?: string; title: string; duration?: string; externalId?: string }>;
    dataQuality?: string;
    durationMs?: number;
    notes?: string;
  }

  interface ArtistCandidate {
    id: string;
    name: string;
    sortName: string;
    disambiguation: string;
  }

  interface TrackNameEdit {
    assetId: string;
    recordingTitle: string;
    trackNumber: number | null;
    sourceTitle?: string;
  }

  interface SupplementalFile {
    objectKey: string;
    sizeBytes: number;
    contentType: string;
    modifiedAt?: string;
  }

  interface SupplementalEdit {
    role: 'none' | 'booklet' | 'score' | 'discarded';
    pageNumber: number;
    sourcePage?: number;
    cropEnabled: boolean;
    crop: { x: number; y: number; width: number; height: number };
    dirty: boolean;
  }

  let { items: initialItems, onclose, onsaved }: {
    items: CatalogItem[];
    onclose: () => void;
    onsaved: (items: CatalogItem[]) => void;
  } = $props();
  let albumItems = $state(untrack(() => initialItems));
  let trackEdits = $state<TrackNameEdit[]>(untrack(() => initialItems.map((item) => ({
    assetId: item.asset.id,
    recordingTitle: item.recordingTitle,
    trackNumber: item.trackNumber ?? null,
    sourceTitle: item.recordingTitle
  }))));
  let bulkNamesOpen = $state(false);
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
  const canonicalEntitySlug = $derived(first?.asset.objectKey.split('/')[3] ?? '');
  const relocationPending = $derived(albumItems.reduce((count, item) => count +
    (item.asset.canonicalMetadata.storageRetirementCandidates ?? []).filter((candidate) => candidate.state === 'candidate').length, 0));
  let title = $state(untrack(() => initialItems[0]?.albumTitle ?? ''));
  let creator = $state(untrack(() => initialItems[0]?.creator ?? ''));
  let albumArtist = $state(untrack(() => initialItems[0]?.albumArtist ?? ''));
  let entitySlug = $state(untrack(() => initialItems[0]?.asset.objectKey.split('/')[3] ?? ''));
  let entitySlugTouched = $state(false);
  let artistCandidates = $state<ArtistCandidate[]>([]);
  let releaseDate = $state(untrack(() => initialItems[0]?.releaseDate ?? ''));
  let label = $state(untrack(() => initialItems[0]?.label ?? ''));
  let catalogNumber = $state(untrack(() => initialItems[0]?.asset.canonicalMetadata.catalogNumber ?? ''));
  let albumDuration = $state(untrack(() => initialItems[0]?.asset.canonicalMetadata.albumDurationMs !== undefined
    ? formatDuration(initialItems[0].asset.canonicalMetadata.albumDurationMs).replace(/\.00$/, '') : ''));
  let albumTags = $state(untrack(() => initialItems[0]?.asset.canonicalMetadata.albumTags?.join(', ') ?? ''));
  let genres = $state<string[]>(untrack(() => [...(initialItems[0]?.asset.canonicalMetadata.genres ?? [])]));
  let styles = $state<string[]>(untrack(() => [...(initialItems[0]?.asset.canonicalMetadata.styles ?? [])]));
  const copyRoles = (values: AlbumRole[] = []) => values.map((role) => ({ ...role }));
  let roles = $state<AlbumRole[]>(untrack(() => copyRoles(initialItems[0]?.asset.canonicalMetadata.roles)));
  let notes = $state(untrack(() => initialItems[0]?.asset.canonicalMetadata.albumNotes ?? ''));
  let collectionCode = $state(untrack(() => initialItems[0]?.asset.canonicalMetadata.collectionCode ?? ''));
  let setTitle = $state(untrack(() => initialItems[0]?.asset.canonicalMetadata.albumSet?.title ?? ''));
  let setPosition = $state(untrack(() => initialItems[0]?.asset.canonicalMetadata.albumSet?.position ?? ''));
  let setTotalDiscs = $state(untrack(() => String(initialItems[0]?.asset.canonicalMetadata.albumSet?.totalDiscs ?? '')));
  let setIdentity = $state<AlbumSet | null>(untrack(() => initialItems[0]?.asset.canonicalMetadata.albumSet ?? null));
  let candidate = $state<DiscogsCandidate | null>(untrack(() => {
    const value = initialItems[0]?.asset.canonicalMetadata.discogs;
    return value && typeof value === 'object' ? value as unknown as DiscogsCandidate : null;
  }));
  let discogsRelease = $state(untrack(() => {
    const value = initialItems[0]?.asset.canonicalMetadata.discogs;
    if (!value || typeof value !== 'object' || !('id' in value)) return '';
    return String((value as { id?: unknown }).id ?? '');
  }));
  let discogsCreator = $state(untrack(() => initialItems[0]?.albumArtist ?? initialItems[0]?.creator ?? ''));
  let discogsTitle = $state(untrack(() => initialItems[0]?.asset.technicalMetadata.tags.album ?? initialItems[0]?.albumTitle ?? ''));
  let discogsYear = $state(untrack(() => initialItems[0]?.asset.technicalMetadata.tags.date ?? initialItems[0]?.releaseDate ?? ''));
  let discogsSetPosition = $state(untrack(() => initialItems[0]?.asset.canonicalMetadata.albumSet?.position ?? ''));
  let message = $state('');
  let busy = $state(false);
  let supplementalFiles = $state<SupplementalFile[]>([]);
  let supplementalEdits = $state<Record<string, SupplementalEdit>>({});
  let supplementalFolder = $state('');
  let supplementalLevel = $state(0);
  let supplementalPreview = $state<SupplementalFile | null>(null);
  let supplementalsLoading = $state(false);
  const discogsSetMembers = $derived(candidate?.tracklist?.filter((track) => /^CD\d+$/i.test(track.position ?? '')) ?? []);

  async function jsonRequest(path: string, options: Parameters<typeof fetch>[1]) {
    const response = await fetch(path, options);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? 'Request failed');
    return body;
  }

  function formatBytes(value: number) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let amount = value; let unit = 0;
    while (amount >= 1000 && unit < units.length - 1) { amount /= 1000; unit += 1; }
    return `${amount.toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
  }

  async function loadSupplementals(level = supplementalLevel) {
    if (!first) return;
    supplementalsLoading = true;
    try {
      const body = await jsonRequest(`/api/albums/${first.albumId}/supplementals?level=${level}`, {});
      supplementalLevel = body.level;
      supplementalFolder = body.directory;
      supplementalFiles = body.files ?? [];
      const decisions = new Map((body.decisions ?? []).map((decision: { sourceObjectKey: string }) => [decision.sourceObjectKey, decision]));
      const pages = new Map((body.bookletPages ?? []).map((page: { sourceObjectKey: string }) => [page.sourceObjectKey, page]));
      const next = { ...supplementalEdits };
      for (const [index, file] of supplementalFiles.entries()) {
        if (next[file.objectKey]) continue;
        const decision = decisions.get(file.objectKey) as { role?: SupplementalEdit['role']; pageNumber?: number } | undefined;
        const page = pages.get(file.objectKey) as { pageNumber?: number; sourcePage?: number; crop?: SupplementalEdit['crop'] } | undefined;
        next[file.objectKey] = {
          role: decision?.role ?? 'none',
          pageNumber: page?.pageNumber ?? decision?.pageNumber ?? index + 1,
          ...(page?.sourcePage ? { sourcePage: page.sourcePage } : {}),
          cropEnabled: Boolean(page?.crop),
          crop: page?.crop ?? { x: 0, y: 0, width: 100, height: 100 },
          dirty: false
        };
      }
      supplementalEdits = next;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Lateral files could not be listed';
    } finally { supplementalsLoading = false; }
  }

  function markSupplementalDirty(objectKey: string) {
    supplementalEdits[objectKey].dirty = true;
  }

  async function applySupplementals() {
    if (!first) return;
    const entries = Object.entries(supplementalEdits).filter(([, edit]) => edit.dirty && edit.role !== 'none').map(([sourceObjectKey, edit]) => ({
      sourceObjectKey, role: edit.role,
      ...(edit.role === 'booklet' ? {
        pageNumber: Number(edit.pageNumber),
        ...(edit.sourcePage ? { sourcePage: Number(edit.sourcePage) } : {}),
        ...(edit.cropEnabled ? { crop: {
          x: Number(edit.crop.x), y: Number(edit.crop.y), width: Number(edit.crop.width), height: Number(edit.crop.height)
        } } : {})
      } : {})
    }));
    if (!entries.length) { message = 'No lateral-file decisions changed'; return; }
    busy = true;
    message = 'Applying booklet and score decisions…';
    try {
      const body = await jsonRequest(`/api/albums/${first.albumId}/supplementals`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries })
      });
      acceptItems(body.items);
      for (const entry of entries) supplementalEdits[entry.sourceObjectKey].dirty = false;
      message = `${body.bookletPages.length} booklet page${body.bookletPages.length === 1 ? '' : 's'} · score copies remain under libros/scores`;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Lateral files could not be applied';
    } finally { busy = false; }
  }

  async function copyScoreRoot() {
    await navigator.clipboard.writeText('wasabi/libros/scores');
    message = 'wasabi/libros/scores copied';
  }

  onMount(() => { void loadSupplementals(0); });

  function acceptItems(updated: CatalogItem[], preserveTrackEdits = true) {
    const pending = preserveTrackEdits ? new Map(trackEdits.map((track) => [track.assetId, track])) : new Map<string, TrackNameEdit>();
    albumItems = updated;
    trackEdits = updated.map((item) => pending.get(item.asset.id) ?? {
      assetId: item.asset.id,
      recordingTitle: item.recordingTitle,
      trackNumber: item.trackNumber ?? null,
      sourceTitle: item.recordingTitle
    });
    onsaved(updated);
  }

  function resetTrackNames() {
    trackEdits = albumItems.map((item) => ({
      assetId: item.asset.id,
      recordingTitle: item.recordingTitle,
      trackNumber: item.trackNumber ?? null,
      sourceTitle: item.recordingTitle
    }));
  }

  async function autoCleanTrackNames() {
    if (!first) return;
    busy = true;
    message = 'Parsing album track names…';
    try {
      const body = await jsonRequest(`/api/albums/${first.albumId}/tracks`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ creator, albumTitle: title })
      });
      trackEdits = body.tracks;
      bulkNamesOpen = true;
      const changed = body.tracks.filter((track: { changed: boolean }) => track.changed).length;
      message = `${changed} of ${body.tracks.length} track names cleaned in preview`;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Track-name preview failed';
    } finally {
      busy = false;
    }
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

  function slug(value: string) {
    return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function suggestedPersonSlug(value: string) {
    const words = value.trim().split(/\s+/).filter(Boolean);
    return slug(words.at(-1) ?? value);
  }

  async function searchCreators() {
    if (!entitySlugTouched) entitySlug = suggestedPersonSlug(creator);
    if (creator.trim().length < 2) { artistCandidates = []; return; }
    try {
      const body = await jsonRequest(`/api/metadata/artists?q=${encodeURIComponent(creator)}`, {});
      artistCandidates = body.artists ?? [];
    } catch {
      artistCandidates = [];
    }
  }

  function selectCreator(candidate: ArtistCandidate) {
    creator = candidate.name;
    const entityName = candidate.sortName.includes(',') ? candidate.sortName.split(',')[0]! : candidate.sortName;
    entitySlug = slug(entityName);
    entitySlugTouched = false;
    artistCandidates = [];
  }

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
    const discNumber = setPosition.match(/\d+/)?.[0];
    const totalDiscs = setTotalDiscs.trim() && /^\d+$/.test(setTotalDiscs.trim()) ? Number(setTotalDiscs) : undefined;
    return {
      title,
      creator: creator || null,
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
      notes: notes || null,
      albumSet: setTitle.trim() && setPosition.trim() ? {
        title: setTitle.trim(),
        position: setPosition.trim(),
        ...(discNumber ? { discNumber: Number(discNumber) } : {}),
        ...(totalDiscs ? { totalDiscs } : {}),
        ...(setIdentity?.authority ? { authority: setIdentity.authority } : {}),
        ...(setIdentity?.externalId ? { externalId: setIdentity.externalId } : {}),
        ...(setIdentity?.canonicalUrl ? { canonicalUrl: setIdentity.canonicalUrl } : {}),
        ...(setIdentity?.memberExternalId ? { memberExternalId: setIdentity.memberExternalId } : {}),
        ...(setIdentity?.memberCanonicalUrl ? { memberCanonicalUrl: setIdentity.memberCanonicalUrl } : {})
      } : null,
      tracks: trackEdits.map((track) => ({
        assetId: track.assetId,
        recordingTitle: track.recordingTitle,
        trackNumber: track.trackNumber || null
      }))
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
      acceptItems(body.items, false);
      const relocated = await relocateCatalogPath();
      if (relocated === 0) message = 'Saved · canonical filenames already clean';
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
      acceptItems(saved.items, false);
      await relocateCatalogPath();
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

  async function relocateCatalogPath(): Promise<number | null> {
    if (!first || !collectionCode.trim() || !entitySlug.trim()) return 0;
    busy = true;
    message = 'Copying and verifying canonical track paths…';
    try {
      let remaining = 1;
      let copied = 0;
      while (remaining > 0) {
        const body = await jsonRequest(`/api/albums/${first.albumId}/relocate`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ collectionCode, entitySlug, limit: 3 })
        });
        copied += body.copied;
        remaining = body.remaining;
        acceptItems(body.items);
        message = `Verified ${copied} copies · ${remaining} remaining`;
      }
      message = copied
        ? `${copied} assets moved logically · old copies retained for reviewed deletion`
        : 'Canonical filenames already clean';
      return copied;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Relocation failed';
      return null;
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
    message = discogsRelease.trim() ? 'Loading exact Discogs release…' : 'Searching Discogs…';
    try {
      const body = await jsonRequest(`/api/albums/${first.albumId}/metadata`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          release: discogsRelease.trim() || undefined,
          creator: discogsCreator,
          albumTitle: discogsTitle,
          year: discogsYear
        })
      });
      candidate = body.candidate;
      discogsRelease = candidate?.id ?? discogsRelease;
      if (discogsSetMembers.length && !discogsSetMembers.some((member) => member.position === discogsSetPosition)) {
        const composerKey = creator.trim().split(/\s+/).at(-1)?.toLocaleLowerCase() ?? '';
        const suggested = composerKey.length > 2
          ? discogsSetMembers.find((member) => member.title.toLocaleLowerCase().includes(composerKey))
          : undefined;
        discogsSetPosition = suggested?.position ?? '';
      }
      message = body.match === 'exact'
        ? discogsSetMembers.length
          ? `Box set ready · choose a member${discogsSetPosition ? ` (${discogsSetPosition} suggested)` : ''}`
          : 'Exact Discogs release ready for review'
        : 'Discogs candidate ready for review';
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
        body: JSON.stringify({
          releaseId: candidate.id,
          setPosition: discogsSetPosition || undefined
        })
      });
      const applied = (body.appliedCandidate ?? body.candidate) as DiscogsCandidate;
      candidate = body.candidate as DiscogsCandidate;
      discogsRelease = candidate.id;
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
      roles = copyRoles(canonical?.roles);
      const appliedSet = body.albumSet as AlbumSet | undefined;
      setIdentity = appliedSet ?? null;
      setTitle = appliedSet?.title ?? '';
      setPosition = appliedSet?.position ?? '';
      setTotalDiscs = String(appliedSet?.totalDiscs ?? '');
      discogsSetPosition = appliedSet?.position ?? '';
      message = `${appliedSet ? `${appliedSet.position} added to ${appliedSet.title}` : 'Release applied'} · ${body.items.length} track${body.items.length === 1 ? '' : 's'}`;
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
          <label class="artist">Composer / entity<input bind:value={creator} oninput={searchCreators} autocomplete="off" />
            {#if artistCandidates.length}<div class="suggestions">{#each artistCandidates as artist (artist.id)}<button onclick={() => selectCreator(artist)}>{artist.name}<small>{artist.disambiguation}</small></button>{/each}</div>{/if}
          </label>
          <label>Album artist<input bind:value={albumArtist} /></label>
          <label>Release<input bind:value={releaseDate} /></label>
          <label>Label<input bind:value={label} /></label>
          <label>Catalog no.<input bind:value={catalogNumber} /></label>
          <label>Declared duration<input bind:value={albumDuration} placeholder="MM:SS or HH:MM:SS" /></label>
          <label class="wide-field">Album tags<input bind:value={albumTags} placeholder="opera, contemporary" /></label>
          <label>Set / box<input bind:value={setTitle} placeholder="The Symphony Edition" /></label>
          <label>Set member<input bind:value={setPosition} placeholder="CD25" /></label>
          <label>Set total<input bind:value={setTotalDiscs} inputmode="numeric" placeholder="60" /></label>
          <label>Collection<input bind:value={collectionCode} placeholder="18, 20E, 20L…" /></label>
          <label>Entity folder<input bind:value={entitySlug} oninput={() => entitySlugTouched = true} placeholder="schubert" /></label>
          <label class="wide-field">Notes<textarea bind:value={notes} placeholder="Manual notes · Ollama extraction will be available here"></textarea></label>
        </div>
        <div class="duration-compare"><span>DECLARED {albumDuration || '—'}</span><span>ASSETS {formatDuration(localDurationMs)}</span></div>
        <div class="relocation-actions">
          {#if collectionCode.trim() !== canonicalCollectionCode || entitySlug.trim() !== canonicalEntitySlug}
            <button onclick={relocateCatalogPath} disabled={busy}>COPY + VERIFY {canonicalCollectionCode}/{canonicalEntitySlug} → {collectionCode.trim()}/{entitySlug.trim()}</button>
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

      <section class="supplementals">
        <div class="section-title">
          <div><h2>Booklet / lateral files</h2><small>Source files remain untouched until an explicit role is applied.</small></div>
          <div class="supplemental-navigation"><button onclick={() => loadSupplementals(Math.max(0, supplementalLevel - 1))} disabled={supplementalsLoading || supplementalLevel === 0}>↓ CHILD</button><button onclick={() => loadSupplementals(supplementalLevel + 1)} disabled={supplementalsLoading}>↑ PARENT</button></div>
        </div>
        <div class="supplemental-path"><span>{supplementalFolder || 'source folder'}</span><button onclick={copyScoreRoot}>SCORES · wasabi/libros/scores</button></div>
        {#if supplementalFiles.length}
          <div class="supplemental-list">
            {#each supplementalFiles as file (file.objectKey)}
              <article>
                <button class="supplemental-preview-button" onclick={() => supplementalPreview = file}>PREVIEW</button>
                <div><strong>{file.objectKey.split('/').at(-1)}</strong><small>{file.contentType} · {formatBytes(file.sizeBytes)}</small></div>
                <select bind:value={supplementalEdits[file.objectKey].role} onchange={() => markSupplementalDirty(file.objectKey)} aria-label={`Role for ${file.objectKey}`}>
                  <option value="none">KEEP UNDECIDED</option><option value="booklet">BOOKLET PAGE</option><option value="score">SCORE → LIBROS</option><option value="discarded">DISCARD FROM ALBUM</option>
                </select>
                {#if supplementalEdits[file.objectKey].role === 'booklet'}
                  <div class="page-options">
                    <label>PAGE<input type="number" min="1" max="999" bind:value={supplementalEdits[file.objectKey].pageNumber} oninput={() => markSupplementalDirty(file.objectKey)} /></label>
                    {#if file.contentType === 'application/pdf' || file.contentType === 'application/postscript'}<label>SOURCE PAGE<input type="number" min="1" max="10000" bind:value={supplementalEdits[file.objectKey].sourcePage} oninput={() => markSupplementalDirty(file.objectKey)} placeholder="whole file" /></label>{/if}
                    <label class="crop-switch"><input type="checkbox" bind:checked={supplementalEdits[file.objectKey].cropEnabled} onchange={() => markSupplementalDirty(file.objectKey)} /> CROP</label>
                    {#if supplementalEdits[file.objectKey].cropEnabled}<div class="crop-values"><label>X %<input type="number" min="0" max="99" bind:value={supplementalEdits[file.objectKey].crop.x} oninput={() => markSupplementalDirty(file.objectKey)} /></label><label>Y %<input type="number" min="0" max="99" bind:value={supplementalEdits[file.objectKey].crop.y} oninput={() => markSupplementalDirty(file.objectKey)} /></label><label>W %<input type="number" min="1" max="100" bind:value={supplementalEdits[file.objectKey].crop.width} oninput={() => markSupplementalDirty(file.objectKey)} /></label><label>H %<input type="number" min="1" max="100" bind:value={supplementalEdits[file.objectKey].crop.height} oninput={() => markSupplementalDirty(file.objectKey)} /></label></div>{/if}
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        {:else}<p class="supplemental-empty">{supplementalsLoading ? 'Scanning folder…' : 'No JPG, PNG, TIFF, EPS or PDF files in this folder.'}</p>{/if}
        <button class="apply-supplementals" onclick={applySupplementals} disabled={busy || !Object.values(supplementalEdits).some((edit) => edit.dirty && edit.role !== 'none')}>APPLY LATERAL-FILE DECISIONS</button>
        {#if supplementalPreview}<div class="supplemental-lightbox"><header><strong>{supplementalPreview.objectKey}</strong><button onclick={() => supplementalPreview = null}>×</button></header>{#if supplementalPreview.contentType === 'application/pdf'}<iframe title={supplementalPreview.objectKey} src={`/api/albums/${first.albumId}/supplementals/preview?key=${encodeURIComponent(supplementalPreview.objectKey)}&type=${encodeURIComponent(supplementalPreview.contentType)}`}></iframe>{:else}<img src={`/api/albums/${first.albumId}/supplementals/preview?key=${encodeURIComponent(supplementalPreview.objectKey)}&type=${encodeURIComponent(supplementalPreview.contentType)}`} alt={supplementalPreview.objectKey} />{/if}</div>{/if}
      </section>

      <section class="tracks">
        <div class="section-title">
          <div><h2>Tracks</h2><small>Bulk changes are previewed here and saved atomically with the album</small></div>
          <div class="track-actions">
            {#if bulkNamesOpen}<button onclick={resetTrackNames} disabled={busy}>Reset</button>{/if}
            <button onclick={autoCleanTrackNames} disabled={busy}>Auto clean</button>
            <button onclick={() => bulkNamesOpen = !bulkNamesOpen}>{bulkNamesOpen ? 'Fold' : 'Bulk edit names'}</button>
          </div>
        </div>
        {#if bulkNamesOpen}
          <div class="track-name-editor">
            {#each trackEdits as track, index (track.assetId)}
              <div class="track-name-row">
                <input class="track-number" type="number" min="1" max="999" bind:value={track.trackNumber} aria-label={`Track ${index + 1} number`} />
                <input bind:value={track.recordingTitle} aria-label={`Track ${index + 1} title`} />
                <small>{albumItems.find((item) => item.asset.id === track.assetId)?.asset.technicalMetadata.formatName ?? '—'}</small>
              </div>
            {/each}
          </div>
        {:else}
          <ol>
            {#each albumItems as item (item.asset.id)}
              <li><span>{item.trackNumber ?? '—'}</span><strong>{item.recordingTitle.replace(/^track\s+/i, '')}</strong><small>{item.asset.technicalMetadata.formatName}</small></li>
            {/each}
          </ol>
        {/if}
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
        <label class="discogs-release">
          <span>Release ID or URL · exact</span>
          <input bind:value={discogsRelease} aria-label="Discogs release ID or URL" placeholder="2499992 or https://www.discogs.com/release/2499992-…" />
        </label>
        <small class="discogs-hint">When present, Refresh bypasses name matching. Apply remains explicit.</small>
        <div class="discogs-query">
          <input bind:value={discogsCreator} aria-label="Discogs album artist" placeholder="album artist" />
          <input bind:value={discogsTitle} aria-label="Discogs release title" placeholder="release" />
          <input bind:value={discogsYear} aria-label="Discogs release year" placeholder="year" />
        </div>
        {#if candidate}
          {#if discogsSetMembers.length}
            <label class="discogs-member">
              <span>Set member</span>
              <select bind:value={discogsSetPosition} aria-label="Discogs box set member">
                <option value="">Whole set — do not choose for one CD</option>
                {#each discogsSetMembers as member (member.position)}
                  <option value={member.position}>{member.position} · {member.title}{member.externalId ? ` · #${member.externalId}` : ''}</option>
                {/each}
              </select>
            </label>
          {/if}
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
            <dt>{discogsSetMembers.length ? 'Members' : 'Tracklist'}</dt><dd>{discogsSetMembers.length ? `${discogsSetMembers.length} discs · ${discogsSetPosition || 'choose one above'}` : candidate.tracklist?.map((track) => `${track.position || '—'} ${track.title}${track.duration ? ` ${track.duration}` : ''}`).join(' · ') || '—'}</dd>
          </dl>
          <button class="apply" onclick={applyDiscogs} disabled={busy || (discogsSetMembers.length > 0 && !discogsSetPosition)}>{discogsSetMembers.length ? `Apply ${discogsSetPosition || 'set member'} to album` : 'Apply release to album'} + {albumItems.length} tracks</button>
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
  header,footer{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #30332e}footer{border-top:1px solid #30332e;border-bottom:0;gap:20px}footer>div{display:grid;gap:5px;max-width:760px}h1,h2{margin:0}h1{font-size:clamp(18px,3vw,32px);font-weight:500}h2{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9ba394;margin-bottom:14px}small{color:#7f867b}.close{font-size:36px;border:0;background:none;color:#fff}.album-editor>main{width:100%;min-height:0;margin:0;padding:0;overflow:auto;display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr)}section{padding:20px;border-right:1px solid #30332e;border-bottom:1px solid #30332e}.canonical,.tracks,.embedded{grid-column:1}.cover-section,.discogs{grid-column:2}.discogs,.embedded{background:#151a14}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.grid label{font-size:10px;color:#9ba394}.grid input,.grid textarea{display:block;width:100%;box-sizing:border-box;margin-top:5px;background:#111310;color:#fff;border:1px solid #30332e;padding:11px;font:inherit}.grid textarea{min-height:110px;resize:vertical}.dependencies{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.dependencies span{font-size:9px;color:#737a70;border:1px solid #30332e;padding:6px}.drop{min-height:260px;display:grid;place-items:center;border:1px dashed #596052;cursor:pointer;overflow:hidden}.drop img{width:100%;height:100%;max-height:420px;object-fit:contain}.drop input{display:none}.section-title{display:flex;justify-content:space-between;align-items:start;gap:12px}.section-title button,footer button,.discogs .apply{border:1px solid #4a5047;background:#111310;color:#fff;padding:9px 13px;font:inherit;font-size:10px}.tracks ol{list-style:none;padding:0;margin:0}.tracks li{display:grid;grid-template-columns:44px 1fr auto;gap:10px;padding:10px 0;border-bottom:1px solid #252823;font-size:11px}.tracks li>span,.tracks li>small{color:#7f867b}.tracks li>strong{font-weight:500}.embedded dl,.discogs dl{display:grid;grid-template-columns:90px 1fr;gap:8px;font-size:11px}.embedded dt,.discogs dt{color:#7f867b}.embedded dd,.discogs dd{margin:0;overflow-wrap:anywhere}.embedded .conflict,.warning{color:#ff9b7a}.discogs-release,.discogs-member{display:grid;gap:5px;margin-bottom:5px;color:#9ba394;font-size:9px;letter-spacing:.08em;text-transform:uppercase}.discogs-release input,.discogs-query input,.discogs-member select{min-width:0;background:#0d0f0d;color:#fff;border:1px solid #353a32;padding:8px;font:9px ui-monospace,monospace}.discogs-release input,.discogs-member select{width:100%;box-sizing:border-box}.discogs-member{margin:14px 0}.discogs-hint{display:block;margin-bottom:10px;font-size:8px;line-height:1.4}.discogs-query{display:grid;grid-template-columns:1fr 1.4fr 64px;gap:6px;margin-bottom:14px}.discogs a{display:inline-block;margin-top:14px;color:#c8ff52;font-size:10px}.discogs p{font-size:11px;color:#7f867b}.discogs .apply{width:100%;margin-top:14px;background:#c8ff52;color:#10110f}.save{background:#c8ff52!important;color:#10110f!important}footer span{font-size:10px;color:#c8ff52}footer small{font-size:8px;line-height:1.35}
  .wide-field{grid-column:1/-1}.duration-compare{display:flex;gap:8px;margin-top:10px}.duration-compare span{font-size:9px;color:#7f867b}.roles-section{grid-column:1}.roles{display:grid;gap:6px}.role-row{display:grid;grid-template-columns:1.4fr 1fr .7fr 34px;gap:6px}.role-row input{min-width:0;background:#0d0f0d;color:#fff;border:1px solid #353a32;padding:8px;font:9px ui-monospace,monospace}.role-row button,.descriptors button{border:1px solid #4a5047;background:#111310;color:#fff;font:9px ui-monospace,monospace}.descriptors{grid-column:2;background:#151a14}.descriptors h3{margin:16px 0 7px;color:#7f867b;font-size:9px;text-transform:uppercase}.tag-list{display:flex;flex-wrap:wrap;gap:5px}.tag-list button{padding:6px 8px}.tag-list button.linked{border-color:#c8ff52;color:#c8ff52}.tag-list.legacy button{color:#9b9f98}.descriptors p{font-size:9px;color:#7f867b;line-height:1.5}.canonical-tags button{background:#c8ff52;color:#10110f}.footer-actions{display:flex!important;gap:8px;max-width:none!important}
  .relocation-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.relocation-actions button{border:1px solid var(--signal);background:transparent;color:var(--signal);padding:8px;font:9px ui-monospace,monospace}.relocation-actions .retire{border-color:#ff8e78;color:#ff8e78}
  .cover-actions{display:flex;gap:5px}
  .track-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:5px}.track-actions button{border:1px solid #4a5047;background:#111310;color:#fff;padding:7px 9px;font:9px ui-monospace,monospace}.track-name-editor{display:grid;margin-top:12px}.track-name-row{display:grid;grid-template-columns:64px minmax(0,1fr) 48px;gap:7px;padding:6px 0;border-bottom:1px solid #252823}.track-name-row input{min-width:0;background:#111310;color:#fff;border:1px solid #30332e;padding:9px;font:10px ui-monospace,monospace}.track-name-row small{align-self:center;text-align:right}.track-number{text-align:center}
  .artist{position:relative}.suggestions{position:absolute;z-index:8;left:0;right:0;top:100%;display:grid;background:#0b0c0b;border:1px solid #41463e}.suggestions button{display:flex;justify-content:space-between;gap:8px;padding:9px;border:0;border-bottom:1px solid #292c27;background:#111310;color:#fff;text-align:left;font:9px ui-monospace,monospace}.suggestions small{font-size:8px;text-align:right}
  .supplementals{grid-column:1/-1;position:relative}.supplemental-navigation{display:flex;gap:5px}.supplemental-navigation button,.supplemental-path button,.supplemental-preview-button,.apply-supplementals{border:1px solid #4a5047;background:#111310;color:#fff;padding:8px 10px;font:9px ui-monospace,monospace}.supplemental-path{margin:10px 0;display:flex;justify-content:space-between;align-items:center;gap:12px;color:#7f867b;font-size:9px;overflow-wrap:anywhere}.supplemental-list{display:grid;border:1px solid #30332e}.supplemental-list article{display:grid;grid-template-columns:auto minmax(180px,1fr) minmax(180px,240px);gap:8px;align-items:center;padding:8px;border-bottom:1px solid #30332e}.supplemental-list article>div{display:grid;gap:3px;min-width:0}.supplemental-list article strong{font-size:10px;overflow-wrap:anywhere}.supplemental-list select,.page-options input{min-width:0;padding:8px;border:1px solid #353a32;background:#0d0f0d;color:#fff;font:9px ui-monospace,monospace}.page-options{grid-column:2/-1!important;display:grid!important;grid-template-columns:90px 120px auto 1fr;align-items:end;gap:8px}.page-options label{display:grid;gap:4px;color:#7f867b;font-size:8px}.page-options .crop-switch{display:flex;align-items:center}.crop-values{display:grid!important;grid-template-columns:repeat(4,1fr);gap:5px}.apply-supplementals{margin-top:12px;border-color:#c8ff52;color:#c8ff52}.apply-supplementals:disabled{opacity:.35}.supplemental-empty{color:#7f867b;font-size:10px}.supplemental-lightbox{position:fixed;z-index:1200;inset:5vh 5vw;display:grid;grid-template-rows:auto 1fr;background:#090a09;border:1px solid #596052;box-shadow:0 20px 80px #000}.supplemental-lightbox header{padding:10px}.supplemental-lightbox header button{border:0;background:transparent;color:#fff;font-size:24px}.supplemental-lightbox img,.supplemental-lightbox iframe{width:100%;height:100%;min-height:0;object-fit:contain;border:0;background:#202020}
  @media(max-width:720px){.album-editor>main{display:block}.grid{grid-template-columns:1fr}.album-editor header,.album-editor footer{padding:12px}.album-editor section{padding:14px;border-right:0}.drop{min-height:190px}footer>div{max-width:65%}footer small{display:none}}
</style>
