<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import type { Asset, IngestPreview } from '@zztt/aby-domain';
  import { formatDuration, formatTechnicalFormat } from '$lib/presentation';

  type SharedPageData = { user: { id: string; name?: string | null; email?: string | null; picture?: string | null } | null };
  type RetirementFolder = {
    folder: string;
    objectCount: number;
    sizeBytes: number;
    sizeComplete: boolean;
    canonicalCount: number;
    state: 'candidate' | 'blocked' | 'verified';
    checkedAt?: string;
    detail?: string;
  };
  type RetirementSort = 'folder' | 'objectCount' | 'sizeBytes' | 'state' | 'checkedAt';
  type SurfSource = {
    objectKey: string;
    mediaKind: 'aud' | 'mov';
    collectionCode: string;
    entitySlug: string;
    creatorDisplay: string;
    workTitle: string;
    recordingTitle: string;
    sourceKind?: 'folder';
    folderKey?: string;
    trackCount?: number;
  };
  let { data }: { data: SharedPageData } = $props();

  let preview = $state<IngestPreview | null>(null);
  let asset = $state<Asset | null>(null);
  let workTitle = $state('');
  let recordingTitle = $state('');
  let albumTitle = $state('');
  let creator = $state('');
  let date = $state('');
  let releaseDate = $state('');
  let label = $state('');
  let catalogNumber = $state('');
  let trackEdits = $state<Array<{ objectKey: string; recordingTitle: string; trackNumber?: number }>>([]);
  let destinationFolder = $state('');
  let isDestFolderCustomized = $state(false);
  let directoryPattern = $state('aby/audio/{collection}/{author}/{album}');
  let status = $state('Ready for one bounded inspection.');
  let busy = $state(false);
  let autoSeparation = $state(true);
  let conversionCodec = $state<'libvorbis' | 'libopus'>('libvorbis');
  let conversionQuality = $state(6);
  let setupMessage = $state('');
  let retirementFolders = $state<RetirementFolder[]>([]);
  let retirementLoading = $state(false);
  let retirementBusy = $state('');
  let retirementNotice = $state('');
  let retirementMessages = $state<Record<string, string>>({});
  let retirementSort = $state<RetirementSort>('folder');
  let retirementDirection = $state<1 | -1>(1);

  onMount(async () => {
    const userId = data.user?.id ?? 'anonymous';
    autoSeparation = localStorage.getItem(`aby.config.auto-separation:${userId}`) !== 'false';
    directoryPattern = localStorage.getItem('aby.config.directory-pattern') || 'aby/audio/{collection}/{author}/{album}';
    if (data.user) {
      try {
        const response = await fetch('/api/settings');
        const body = await response.json();
        if (response.ok) {
          conversionCodec = body.conversion.codec;
          conversionQuality = body.conversion.quality;
        }
      } catch { /* setup keeps its documented defaults */ }
      await loadRetirementFolders();
    }
  });

  async function loadRetirementFolders() {
    retirementLoading = true;
    try {
      const response = await fetch('/api/retirement/folders');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Retirement queue could not be loaded');
      retirementFolders = body.folders ?? [];
    } catch (error) {
      retirementNotice = error instanceof Error ? error.message : 'Retirement queue could not be loaded';
    } finally {
      retirementLoading = false;
    }
  }

  function setRetirementSort(key: RetirementSort) {
    if (retirementSort === key) retirementDirection = retirementDirection === 1 ? -1 : 1;
    else { retirementSort = key; retirementDirection = 1; }
  }

  function sortedRetirementFolders() {
    const states = { verified: 0, candidate: 1, blocked: 2 };
    return [...retirementFolders].sort((left, right) => {
      let result = 0;
      if (retirementSort === 'state') result = states[left.state] - states[right.state];
      else if (retirementSort === 'folder') result = left.folder.localeCompare(right.folder);
      else if (retirementSort === 'checkedAt') result = (left.checkedAt ?? '').localeCompare(right.checkedAt ?? '');
      else result = left[retirementSort] - right[retirementSort];
      return result * retirementDirection;
    });
  }

  function formatBytes(value: number, complete = true) {
    if (!value && !complete) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let amount = value;
    let unit = 0;
    while (amount >= 1_000 && unit < units.length - 1) { amount /= 1_000; unit += 1; }
    return `${complete ? '' : '≥ '}${amount.toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
  }

  function verificationMessage(verification: any) {
    if (verification.verified) return `${verification.matchedCount} objects match. Deletion unlocked for 24 hours.`;
    const failures = [
      verification.untrackedObjects?.length ? `${verification.untrackedObjects.length} untracked in source` : '',
      verification.missingSourceObjects?.length ? `${verification.missingSourceObjects.length} missing in source` : '',
      verification.missingCanonicalObjects?.length ? `${verification.missingCanonicalObjects.length} missing in catalog` : '',
      verification.mismatchedObjects?.length ? `${verification.mismatchedObjects.length} hash/size mismatch` : ''
    ].filter(Boolean);
    return failures.join(' · ') || 'Folder did not pass the complete manifest check.';
  }

  async function checkRetirementFolder(folder: string) {
    retirementBusy = folder;
    retirementMessages = { ...retirementMessages, [folder]: 'rclone is comparing the mapped objects…' };
    try {
      const response = await fetch('/api/retirement/folders', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Folder check failed');
      retirementMessages = { ...retirementMessages, [folder]: verificationMessage(body.verification) };
      await loadRetirementFolders();
    } catch (error) {
      retirementMessages = { ...retirementMessages, [folder]: error instanceof Error ? error.message : 'Folder check failed' };
    } finally {
      retirementBusy = '';
    }
  }

  async function deleteRetirementFolder(folder: string) {
    retirementBusy = folder;
    retirementMessages = { ...retirementMessages, [folder]: 'Running a fresh rclone preflight before deletion…' };
    try {
      const response = await fetch('/api/retirement/folders', {
        method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Source folder could not be deleted');
      retirementNotice = `${body.deletion.folder}: ${body.deletion.deletedObjects} source objects deleted; canonical Aby copies remain.`;
      await loadRetirementFolders();
    } catch (error) {
      retirementMessages = { ...retirementMessages, [folder]: error instanceof Error ? error.message : 'Source folder could not be deleted' };
    } finally {
      retirementBusy = '';
    }
  }

  function toggleAutoSeparation() {
    autoSeparation = !autoSeparation;
    const userId = data.user?.id ?? 'anonymous';
    localStorage.setItem(`aby.config.auto-separation:${userId}`, String(autoSeparation));
  }

  async function saveSetup() {
    setupMessage = 'Saving…';
    try {
      localStorage.setItem('aby.config.directory-pattern', directoryPattern);
      const response = await fetch('/api/settings', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ container: 'ogg', codec: conversionCodec, quality: conversionQuality })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Setup could not be saved');
      setupMessage = 'Saved';
    } catch (error) { setupMessage = error instanceof Error ? error.message : 'Setup could not be saved'; }
  }

  function composerSurnameSlug(value: string): string {
    const primaryName = value.split(/\s*(?:;|&|\band\b|\by\b)\s*/iu)[0]?.trim() ?? '';
    const surname = primaryName.includes(',')
      ? primaryName.split(',')[0]!.trim()
      : primaryName.split(/\s+/).filter(Boolean).at(-1) ?? '';
    return surname.normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  function albumSlug(value: string): string {
    return value.normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '');
  }

  function formatDestinationFolder(pattern: string, collection: string, authorName: string, albumName: string) {
    const author = composerSurnameSlug(authorName || 'unknown');
    const albumFolder = albumSlug(albumName || 'unknown');
    return pattern
      .replace('{collection}', collection || 'unknown')
      .replace('{author}', author)
      .replace('{album}', albumFolder);
  }

  $effect(() => {
    if (!isDestFolderCustomized && preview) {
      destinationFolder = formatDestinationFolder(
        directoryPattern,
        preview.candidateMetadata.collectionCode || '',
        creator,
        albumTitle || workTitle
      );
    }
  });

  async function request(path: string, body: unknown) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error?.message ?? 'Request failed');
    return value;
  }

  function applyPreview(nextPreview: IngestPreview, preservedTracks: typeof trackEdits = []) {
    preview = nextPreview;
    workTitle = nextPreview.candidateMetadata.title;
    recordingTitle = nextPreview.candidateMetadata.recordingTitle;
    albumTitle = nextPreview.candidateMetadata.albumTitle || '';
    creator = nextPreview.candidateMetadata.creator || '';
    date = nextPreview.candidateMetadata.date || '';
    releaseDate = nextPreview.candidateMetadata.releaseDate || '';
    label = nextPreview.candidateMetadata.label || '';
    catalogNumber = nextPreview.candidateMetadata.catalogNumber || '';
    trackEdits = (nextPreview.candidateMetadata.tracks ?? []).map((track, index) => ({
      objectKey: track.objectKey,
      recordingTitle: preservedTracks[index]?.recordingTitle || track.recordingTitle,
      ...(track.trackNumber !== undefined ? { trackNumber: track.trackNumber } : {})
    }));
    asset = null;

    isDestFolderCustomized = false;
    const parentKey = nextPreview.candidateMetadata.canonicalObjectKey || '';
    destinationFolder = parentKey.substring(0, parentKey.lastIndexOf('/'));
  }

  async function surpriseMe() {
    busy = true;
    status = 'Checking Wasabi storage for untracked sources…';
    try {
      const response = await fetch('/api/ingest/sources?mode=random&media=aud');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Failed to load source list');
      
      const sources = body.sources;
      if (!sources || sources.length === 0) {
        status = 'No legacy sources found to catalog.';
        return;
      }
      
      const selectedSource = sources[0];
      
      status = `Picked: ${selectedSource.objectKey}. Inspecting...`;
      
      const result = await request('/api/ingest/preview', {
        sourceObjectKey: selectedSource.objectKey,
        mediaKind: selectedSource.mediaKind,
        collectionCode: selectedSource.collectionCode,
        entitySlug: selectedSource.entitySlug,
        creatorDisplay: selectedSource.creatorDisplay,
        workTitle: selectedSource.workTitle,
        recordingTitle: selectedSource.recordingTitle,
        analyze: false
      });
      
      applyPreview(result.preview);
      status = `Inspected: ${result.preview.objectKey}. Real candidate ready.`;
    } catch (error) {
      status = error instanceof Error ? error.message : 'Surprise discovery failed';
    } finally {
      busy = false;
    }
  }

  let surfSources = $state<SurfSource[]>([]);
  let showSurfList = $state(false);
  let loadingSurf = $state(false);
  let surfQuery = $state('');
  let surfTotal = $state(0);
  let surfView = $state<'folders' | 'tracks'>('folders');
  let surfSearchTimer: ReturnType<typeof setTimeout> | undefined;
  let discogsRelease = $state('');
  let discogsFolderQuery = $state('');
  let discogsFolderOptions = $state<SurfSource[]>([]);
  let selectedDiscogsFolder = $state<SurfSource | null>(null);
  let showDiscogsFolders = $state(false);
  let loadingDiscogsFolders = $state(false);
  let discogsFolderSearchTimer: ReturnType<typeof setTimeout> | undefined;

  async function loadSurfSources(query = surfQuery) {
    loadingSurf = true;
    try {
      const params = new SvelteURLSearchParams({ mode: 'surf', media: 'aud', limit: '150' });
      if (surfView === 'folders') params.set('view', 'folders');
      if (query.trim()) params.set('q', query.trim());
      const response = await fetch(`/api/ingest/sources?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Failed to load source list');
      surfSources = body.sources || [];
      surfTotal = body.total || 0;
    } catch (error) {
      status = error instanceof Error ? error.message : 'Failed to load source list';
      surfSources = [];
      surfTotal = 0;
    } finally {
      loadingSurf = false;
    }
  }

  function queueSurfSearch() {
    clearTimeout(surfSearchTimer);
    surfSearchTimer = setTimeout(() => loadSurfSources(), 300);
  }

  async function setSurfView(view: 'folders' | 'tracks') {
    surfView = view;
    surfSources = [];
    await loadSurfSources();
  }

  async function toggleSurf() {
    showSurfList = !showSurfList;
    if (showSurfList && surfSources.length === 0) {
      await loadSurfSources('');
    }
  }

  async function selectSurfSource(selectedSource: typeof surfSources[0]) {
    busy = true;
    status = `Inspecting: ${selectedSource.objectKey}...`;
    showSurfList = false;
    try {
      const result = await request('/api/ingest/preview', {
        sourceObjectKey: selectedSource.objectKey,
        mediaKind: selectedSource.mediaKind,
        collectionCode: selectedSource.collectionCode,
        entitySlug: selectedSource.entitySlug,
        creatorDisplay: selectedSource.creatorDisplay,
        workTitle: selectedSource.workTitle,
        recordingTitle: selectedSource.recordingTitle,
        analyze: false
      });
      applyPreview(result.preview);
      status = `Inspected: ${result.preview.objectKey}. Real candidate ready.`;
    } catch (error) {
      status = error instanceof Error ? error.message : 'Inspection failed';
    } finally {
      busy = false;
    }
  }

  async function loadDiscogsFolders(query = discogsFolderQuery) {
    loadingDiscogsFolders = true;
    showDiscogsFolders = true;
    try {
      const params = new SvelteURLSearchParams({ mode: 'surf', media: 'aud', view: 'folders', limit: '80' });
      if (query.trim()) params.set('q', query.trim());
      const response = await fetch(`/api/ingest/sources?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Wasabi album folders could not be loaded');
      discogsFolderOptions = body.sources ?? [];
    } catch (error) {
      status = error instanceof Error ? error.message : 'Wasabi album folders could not be loaded';
      discogsFolderOptions = [];
    } finally {
      loadingDiscogsFolders = false;
    }
  }

  function queueDiscogsFolderSearch() {
    selectedDiscogsFolder = null;
    clearTimeout(discogsFolderSearchTimer);
    discogsFolderSearchTimer = setTimeout(() => loadDiscogsFolders(), 300);
  }

  function selectDiscogsFolder(source: SurfSource) {
    selectedDiscogsFolder = source;
    discogsFolderQuery = source.folderKey ?? source.objectKey.slice(0, source.objectKey.lastIndexOf('/'));
    showDiscogsFolders = false;
  }

  async function addByDiscogs() {
    if (!selectedDiscogsFolder || !discogsRelease.trim()) return;
    busy = true;
    showDiscogsFolders = false;
    status = `Inspecting ${selectedDiscogsFolder.folderKey} and loading Discogs ${discogsRelease.trim()}…`;
    try {
      const result = await request('/api/ingest/preview/discogs', {
        release: discogsRelease.trim(),
        sourceObjectKey: selectedDiscogsFolder.objectKey,
        mediaKind: selectedDiscogsFolder.mediaKind,
        collectionCode: selectedDiscogsFolder.collectionCode,
        entitySlug: selectedDiscogsFolder.entitySlug,
        creatorDisplay: selectedDiscogsFolder.creatorDisplay,
        workTitle: selectedDiscogsFolder.workTitle,
        recordingTitle: selectedDiscogsFolder.recordingTitle,
        analyze: false
      });
      applyPreview(result.preview);
      status = `Discogs ${result.discogs.id} + ${selectedDiscogsFolder.trackCount ?? 1} Wasabi tracks ready for editable review.`;
    } catch (error) {
      status = error instanceof Error ? error.message : 'Discogs folder inspection failed';
    } finally {
      busy = false;
    }
  }

  async function addToCatalog() {
    if (!preview) return;
    busy = true;
    status = 'Copying, verifying and adding to the catalog…';
    try {
      const parentFilename = preview.candidateMetadata.canonicalObjectKey.split('/').at(-1)!;
      const finalCanonicalObjectKey = `${destinationFolder}/${parentFilename}`;
      const finalTracks = trackEdits.map((t, idx) => {
        const origTrack = preview!.candidateMetadata.tracks?.[idx];
        const filename = origTrack ? origTrack.canonicalObjectKey.split('/').at(-1)! : t.objectKey.split('/').at(-1)!;
        return {
          ...t,
          canonicalObjectKey: `${destinationFolder}/${filename}`
        };
      });

      const result = await request('/api/ingest/commit', {
        previewId: preview.id,
        workTitle,
        recordingTitle,
        albumTitle,
        creator,
        date,
        releaseDate,
        label,
        catalogNumber,
        canonicalObjectKey: finalCanonicalObjectKey,
        ...(trackEdits.length > 1 ? { tracks: finalTracks } : {})
      });
      if (result.preview) preview = result.preview;
      asset = result.asset;
      status = result.sourceRetirement
        ? 'Added to catalog. Canonical copy verified; the legacy source is marked as a future deletion candidate.'
        : 'Added to catalog.';
    } catch (error) {
      status = error instanceof Error ? error.message : 'Commit failed';
    } finally {
      busy = false;
    }
  }

</script>

<svelte:head>
  <title>Aby — Inspect temporal media</title>
  <meta name="description" content="Private temporal media inspection with explicit provenance." />
</svelte:head>

<main class="audio-inspect">
  <section class="intro">
    <div>
      <span class="eyebrow">AUDIO ADOPTION · PREVIEW BEFORE WRITE</span>
      <h1>Inspect the sound.<br />Commit the metadata.</h1>
    </div>
    <div class="intro-context">
      <p>Aby keeps the original file untouched and separates machine candidates from canonical metadata before the explicit catalog commit.</p>
      {#if data.user}
        <div class="identity"><span>{data.user.name || data.user.email || 'Logto user'}</span><small>Shared Logto identity</small><form method="POST" action="?/signOut"><button class="secondary">Sign out</button></form></div>
      {:else}
        <form method="POST" action="?/signIn"><button class="primary">Continue with Logto</button></form>
      {/if}
    </div>
  </section>

  <section class="workflow" aria-label="Ingest workflow">
    <article class:complete={Boolean(preview)}>
      <header><span>01</span><h2>Inspect</h2></header>
      <p>{data.user ? 'Scan legacy source pools and pick a random candidate to adopt.' : 'Authentication uses the same Logto identity as Seshat and Musiki.'}</p>
      {#if data.user}
        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <button class="secondary signal-outline" onclick={surpriseMe} disabled={busy} style="flex: 1;">SURPRISE ME · AUDIO</button>
          <button class="secondary" onclick={toggleSurf} disabled={busy} style="flex: 1;">Surf sources</button>
        </div>

        <div class="discogs-folder-adopt">
          <header>
            <span>DISCOGS + WASABI ALBUM</span>
            <small>Exact release metadata · current folder files</small>
          </header>
          <div class="discogs-folder-inputs">
            <input bind:value={discogsRelease} aria-label="Discogs release ID or URL" placeholder="Discogs ID or release URL" />
            <div class="folder-picker">
              <input
                bind:value={discogsFolderQuery}
                aria-label="Wasabi album folder"
                placeholder="Choose album folder in ref/…"
                onfocus={() => { showDiscogsFolders = true; if (!discogsFolderOptions.length) loadDiscogsFolders(); }}
                oninput={queueDiscogsFolderSearch}
              />
              {#if showDiscogsFolders}
                <div class="folder-options">
                  {#if loadingDiscogsFolders}
                    <small>Scanning Wasabi album folders…</small>
                  {:else if !discogsFolderOptions.length}
                    <small>No matching album folders.</small>
                  {:else}
                    {#each discogsFolderOptions as folder (folder.folderKey)}
                      <button onclick={() => selectDiscogsFolder(folder)}>
                        <strong>{folder.workTitle}</strong>
                        <span>{folder.trackCount ?? 1} tracks · {folder.folderKey}</span>
                      </button>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
            <button class="discogs-add" onclick={addByDiscogs} disabled={busy || !discogsRelease.trim() || !selectedDiscogsFolder}>
              ADD BY DISCOGS
            </button>
          </div>
        </div>

        {#if showSurfList}
          <div style="margin-top: 12px; border: 1px solid var(--line); padding: 12px; background: #131412; max-height: 280px; display: flex; flex-direction: column; gap: 8px; overflow: hidden; z-index: 10;">
            <div class="surf-modes">
              <button class:active={surfView === 'folders'} onclick={() => setSurfView('folders')}>ALBUM FOLDERS</button>
              <button class:active={surfView === 'tracks'} onclick={() => setSurfView('tracks')}>TRACKS</button>
            </div>
            <div class="surf-search">
              <input type="text" bind:value={surfQuery} oninput={queueSurfSearch} placeholder={surfView === 'folders' ? 'Search album folders in ref/…' : 'Search tracks in ref/…'} />
              <button onclick={() => loadSurfSources(surfQuery)} aria-label="Refresh source sample">↻</button>
            </div>
            <small class="surf-count">{surfQuery.trim() ? `${surfTotal} matches` : `${surfSources.length} sampled from ${surfTotal}`} · {surfView === 'folders' ? 'one row per album folder' : 'individual files'}</small>
            
            {#if loadingSurf}
              <div style="color: var(--muted); font-size: 11px; font-family: ui-monospace, monospace; padding: 8px 0;">Scanning Wasabi...</div>
            {:else if surfSources.length === 0}
              <div style="color: var(--muted); font-size: 11px; font-family: ui-monospace, monospace; padding: 8px 0;">No matching sources found.</div>
            {:else}
              <div style="overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 4px; padding-right: 4px;">
                {#each surfSources as src (src.objectKey)}
                  <button 
                    onclick={() => selectSurfSource(src)}
                    class="surf-item-btn"
                  >
                    <span style="font-size: 10px; color: var(--signal); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%;">
                      {src.creatorDisplay} — {src.workTitle}{#if src.sourceKind === 'folder'} · {src.trackCount} TRACKS{/if}
                    </span>
                    <span style="font-size: 9px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; direction: rtl; text-align: left;">
                      {src.folderKey ?? src.objectKey}
                    </span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {:else}
        <button class="secondary" disabled>Sign in first</button>
      {/if}
    </article>

    <article class:complete={Boolean(asset)}>
      <header><span>02</span><h2>Confirm</h2></header>
      {#if preview}
        <label>Work title<input bind:value={workTitle} /></label>
        <label>Album (optional)<input bind:value={albumTitle} placeholder="Direct track when empty" /></label>
        {#if trackEdits.length <= 1}<label>Track title<input bind:value={recordingTitle} /></label>{/if}
        <label>Artist/s<input bind:value={creator} /></label>
        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
          <label style="flex: 1; margin: 0;">Year (Composition)<input bind:value={date} style="width: 100%; box-sizing: border-box;" /></label>
          <label style="flex: 1; margin: 0;">Recording Year<input bind:value={releaseDate} style="width: 100%; box-sizing: border-box;" /></label>
        </div>
        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
          <label style="flex: 1; margin: 0;">Label<input bind:value={label} style="width: 100%; box-sizing: border-box;" /></label>
          <label style="flex: 1; margin: 0;">Catalog No.<input bind:value={catalogNumber} style="width: 100%; box-sizing: border-box;" /></label>
        </div>
        {#if preview.candidateMetadata.tracks && preview.candidateMetadata.tracks.length > 1}
          <div style="margin-top: 14px; margin-bottom: 14px; border: 1px solid var(--line); padding: 12px; background: #131412;">
            <header style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--signal); margin-bottom: 6px; letter-spacing: 0.05em;">
              Album folder detected ({preview.candidateMetadata.tracks.length} tracks)
            </header>
            <p style="font-size: 11px; color: var(--muted); margin: 0 0 10px 0; line-height: 1.4;">
              Tracks remain under the same Work and optional Album.
            </p>
            <div class="collective-tracks">
              {#each trackEdits as track, index (track.objectKey)}
                <label>
                  <span>{track.trackNumber ? String(track.trackNumber).padStart(2, '0') : String(index + 1).padStart(2, '0')}</span>
                  <input bind:value={track.recordingTitle} aria-label={`Track ${track.trackNumber ?? index + 1} title`} />
                </label>
              {/each}
            </div>
          </div>
        {/if}

        <label style="margin-top: 12px; display: block;">
          Destination Folder
          <input 
            bind:value={destinationFolder} 
            oninput={() => isDestFolderCustomized = true} 
            placeholder="aby/audio/..." 
            style="width: 100%; height: 32px; font-family: monospace; font-size: 11px; padding: 4px 8px; border: 1px solid var(--line); background: #000; color: #fff; box-sizing: border-box; margin-top: 4px;" 
          />
        </label>
        <div style="height: 12px;"></div>

        <button class="primary" onclick={addToCatalog} disabled={busy || Boolean(asset)}>Add to catalog</button>
      {:else}
        <p>Candidate metadata will appear here. It remains editable until explicit commit.</p>
      {/if}
    </article>

  </section>

  <section class="inspection" aria-live="polite">
    <div class="status-line"><span class:working={busy}></span>{status}</div>
    {#if preview}
      <dl>
        <div><dt>Source</dt><dd>{preview.provider} · {preview.originalFilename}</dd></div>
        <div><dt>Source key</dt><dd class="mono">{preview.objectKey}</dd></div>
        {#if preview.candidateMetadata.canonicalObjectKey}<div><dt>Proposed key</dt><dd class="mono">{preview.candidateMetadata.canonicalObjectKey}</dd></div>{/if}
        <div><dt>SHA-256</dt><dd class="mono">{preview.checksumSha256}</dd></div>
        <div><dt>Format</dt><dd>{formatTechnicalFormat(preview.technicalMetadata)}</dd></div>
        <div><dt>Length</dt><dd>{formatDuration(preview.technicalMetadata.durationMs)}</dd></div>
        <div><dt>Signal</dt><dd>{preview.technicalMetadata.sampleRate ?? '—'} Hz · {preview.technicalMetadata.channels ?? '—'} ch</dd></div>
        <div><dt>Review state</dt><dd>{asset ? 'accepted by human commit' : preview.status}</dd></div>
        {#if preview.candidateMetadata.identificationCandidates?.[0]}
          <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
          <div><dt>MusicBrainz</dt><dd><a href={preview.candidateMetadata.identificationCandidates[0].canonicalUrl} target="_blank" rel="noreferrer">{preview.candidateMetadata.identificationCandidates[0].title}</a> · {Math.round(preview.candidateMetadata.identificationCandidates[0].score * 100)}% candidate</dd></div>
        {/if}
        {#if preview.candidateMetadata.wikidata}
          <div>
            <dt>Wikidata</dt>
            <dd>
              <strong style="color: var(--signal);">{preview.candidateMetadata.wikidata.label}</strong> ({preview.candidateMetadata.wikidata.qid})
              {#if preview.candidateMetadata.wikidata.birthDate}
                <small style="display: block; color: var(--muted); margin-top: 2px;">Born: {preview.candidateMetadata.wikidata.birthDate}</small>
              {/if}
              <p style="margin: 6px 0 0; font-size: 12px; line-height: 1.4; color: var(--muted);">{preview.candidateMetadata.wikidata.description}</p>
              {#if preview.candidateMetadata.wikidata.imageUrl}
                <img src={preview.candidateMetadata.wikidata.imageUrl} alt={preview.candidateMetadata.wikidata.label} style="display: block; max-width: 140px; margin-top: 8px; border: 1px solid var(--line);" />
              {/if}
            </dd>
          </div>
        {/if}
        {#if preview.candidateMetadata.imageCandidates?.[0]}
          <div>
            <dt>Feature image</dt>
            <dd>
              <img class="feature-candidate" src={preview.candidateMetadata.imageCandidates[0].url} alt="Candidate feature art" />
              <small style="display: block; margin-top: 4px;">
                {preview.candidateMetadata.imageCandidates[0].authority === 'wikidata' 
                  ? 'Wikidata author portrait fallback' 
                  : (preview.candidateMetadata.imageCandidates[0].exactRelease ? 'Exact release cover' : 'Release-group fallback; requires confirmation')}
              </small>
            </dd>
          </div>
        {/if}
      </dl>
    {/if}
  </section>

  {#if data.user}
    <section class="retirement-section" aria-label="Source retirement queue">
      <header>
        <div><span>RETIREMENT</span><h2>Copied source folders</h2></div>
        <button class="retirement-refresh" onclick={loadRetirementFolders} disabled={retirementLoading || Boolean(retirementBusy)} aria-label="Refresh retirement queue">↻</button>
      </header>
      <p class="retirement-intro">Only complete folders can be removed. Check compares every current source object with its renamed canonical Aby target through rclone; unexpected files block deletion.</p>
      {#if retirementNotice}<div class="retirement-notice">{retirementNotice}</div>{/if}
      <div class="retirement-table-wrap">
        <table>
          <thead><tr>
            <th><button onclick={() => setRetirementSort('folder')}>SOURCE FOLDER {retirementSort === 'folder' ? (retirementDirection === 1 ? '↑' : '↓') : ''}</button></th>
            <th><button onclick={() => setRetirementSort('objectCount')}>FILES {retirementSort === 'objectCount' ? (retirementDirection === 1 ? '↑' : '↓') : ''}</button></th>
            <th><button onclick={() => setRetirementSort('sizeBytes')}>SIZE {retirementSort === 'sizeBytes' ? (retirementDirection === 1 ? '↑' : '↓') : ''}</button></th>
            <th><button onclick={() => setRetirementSort('state')}>STATE {retirementSort === 'state' ? (retirementDirection === 1 ? '↑' : '↓') : ''}</button></th>
            <th><button onclick={() => setRetirementSort('checkedAt')}>CHECKED {retirementSort === 'checkedAt' ? (retirementDirection === 1 ? '↑' : '↓') : ''}</button></th>
            <th><span class="visually-hidden">Actions</span></th>
          </tr></thead>
          <tbody>
            {#if retirementLoading && retirementFolders.length === 0}
              <tr><td colspan="6" class="empty-retirement">Loading candidates…</td></tr>
            {:else if retirementFolders.length === 0}
              <tr><td colspan="6" class="empty-retirement">No copied source folders are waiting for retirement.</td></tr>
            {:else}
              {#each sortedRetirementFolders() as folder (folder.folder)}
                <tr>
                  <td class="retirement-folder"><strong>{folder.folder}</strong>{#if folder.detail}<small>{folder.detail}</small>{/if}{#if retirementMessages[folder.folder]}<small class="retirement-result">{retirementMessages[folder.folder]}</small>{/if}</td>
                  <td>{folder.objectCount}<small>{folder.canonicalCount} catalogued</small></td>
                  <td>{formatBytes(folder.sizeBytes, folder.sizeComplete)}</td>
                  <td><span class:verified={folder.state === 'verified'} class:blocked={folder.state === 'blocked'} class="retirement-state">{folder.state}</span></td>
                  <td>{folder.checkedAt ? new Date(folder.checkedAt).toLocaleString() : '—'}</td>
                  <td><div class="retirement-actions"><button onclick={() => checkRetirementFolder(folder.folder)} disabled={retirementBusy === folder.folder}>CHECK</button><button class="delete-source" onclick={() => deleteRetirementFolder(folder.folder)} disabled={folder.state !== 'verified' || retirementBusy === folder.folder}>DELETE</button></div></td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </section>

    <section class="setup-section" aria-label="Setup">
      <header><span>SETUP</span><h2>Processing defaults</h2></header>
      <div class="setup-grid">
        <div><strong>Source separation</strong><small>BS-Roformer</small></div>
        <button class:active={autoSeparation} onclick={toggleAutoSeparation}>{autoSeparation ? 'ON' : 'OFF'}</button>
        <label>Ogg codec<select bind:value={conversionCodec}><option value="libvorbis">Vorbis</option><option value="libopus">Opus</option></select></label>
        <label>Quality {conversionQuality}<input type="range" min="0" max="10" step="1" bind:value={conversionQuality} /></label>
        <label style="grid-column: span 2; display: flex; flex-direction: column; gap: 4px; margin-top: 8px;">
          <span>Directory Naming Pattern</span>
          <input bind:value={directoryPattern} placeholder={'aby/audio/{collection}/{author}/{album}'} style="width: 100%; height: 32px; font-family: monospace; font-size: 11px; padding: 4px 8px; border: 1px solid var(--line); background: #000; color: #fff; box-sizing: border-box;" />
        </label>
        <button class="save-setup" onclick={saveSetup}>Save Setup</button>
        <small class="setup-message">{setupMessage}</small>
      </div>
    </section>
  {/if}
</main>

<style>
  .surf-item-btn {
    text-align: left;
    background: none;
    border: 0;
    padding: 8px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 3px;
    border-bottom: 1px dashed #30322f;
    width: 100%;
    font-family: ui-monospace, monospace;
    box-sizing: border-box;
    transition: background 0.15s;
  }
  .surf-item-btn:hover, .surf-item-btn:focus {
    background-color: rgba(198, 255, 82, 0.08);
    outline: none;
  }
  .surf-search{display:grid;grid-template-columns:1fr auto}.surf-search input{width:100%;font-size:11px;padding:8px;background:#0c0d0c;border:1px solid var(--line);color:#fff;font-family:ui-monospace,monospace;box-sizing:border-box}.surf-search button{border:1px solid var(--line);border-left:0;background:#0c0d0c;color:var(--signal);padding:0 12px}.surf-count{font:9px ui-monospace,monospace;color:var(--muted)}
  .surf-modes{display:flex;gap:5px}.surf-modes button{padding:6px 9px;border:1px solid var(--line);background:transparent;color:var(--muted);font:8px ui-monospace,monospace}.surf-modes button.active{border-color:var(--signal);color:var(--signal)}
  .discogs-folder-adopt{position:relative;margin-top:10px;padding:10px;border:1px solid #30342d;background:#10120f}.discogs-folder-adopt>header{display:flex;justify-content:space-between;gap:10px;margin-bottom:8px}.discogs-folder-adopt>header span{color:var(--signal);font:9px ui-monospace,monospace}.discogs-folder-adopt>header small{color:var(--muted);font:8px ui-monospace,monospace}.discogs-folder-inputs{display:grid;grid-template-columns:minmax(120px,.8fr) minmax(180px,1.4fr) auto;gap:6px}.discogs-folder-inputs input{min-width:0;width:100%;height:34px;box-sizing:border-box;padding:0 8px;border:1px solid var(--line);background:#090a09;color:#fff;font:9px ui-monospace,monospace}.folder-picker{position:relative}.folder-options{position:absolute;z-index:25;top:38px;right:0;left:0;max-height:260px;padding:4px;overflow:auto;border:1px solid #3b4037;background:#0b0d0b;box-shadow:0 16px 35px #000b}.folder-options>small{display:block;padding:10px;color:var(--muted);font:9px ui-monospace,monospace}.folder-options button{width:100%;padding:8px;display:grid;gap:3px;border:0;border-bottom:1px dashed #30342d;background:transparent;color:#fff;text-align:left}.folder-options button:hover{background:#c6ff5210}.folder-options strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:10px Georgia,serif;font-weight:400}.folder-options span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font:8px ui-monospace,monospace}.discogs-add{height:34px;padding:0 10px;border:1px solid var(--signal);background:transparent;color:var(--signal);font:8px ui-monospace,monospace}.discogs-add:disabled{opacity:.35}
  .collective-tracks{max-height:240px;overflow-y:auto;display:grid;gap:5px;padding-right:4px}.collective-tracks label{display:grid;grid-template-columns:30px 1fr;align-items:center;margin:0}.collective-tracks label span{font:10px ui-monospace,monospace;color:var(--signal)}.collective-tracks input{margin:0!important;padding:7px!important;font-size:11px!important}
  .setup-section{margin-top:72px;border:1px solid var(--line);background:var(--surface)}
  .setup-section>header{display:flex;gap:18px;align-items:baseline;padding:18px 22px;border-bottom:1px solid var(--line)}
  .setup-section>header span{font:10px ui-monospace,monospace;color:var(--signal)}.setup-section h2{margin:0;font-size:18px;font-weight:500}
  .setup-grid{display:grid;grid-template-columns:1.2fr auto 1fr 1fr auto;gap:18px;align-items:end;padding:22px}.setup-grid>div{display:grid}.setup-grid small{color:var(--muted)}
  .setup-grid label{display:grid;gap:7px;font:10px ui-monospace,monospace;color:var(--muted)}.setup-grid select{background:#111310;color:#fff;border:1px solid var(--line);padding:9px}.setup-grid button{border:1px solid var(--line);background:transparent;color:#fff;padding:9px 14px}.setup-grid button.active,.save-setup{background:var(--signal)!important;color:#101110!important}.setup-message{align-self:center}
  .retirement-section{margin-top:72px;background:var(--surface);border:1px solid var(--line)}
  .retirement-section>header{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--line)}
  .retirement-section>header>div{display:flex;gap:18px;align-items:baseline}.retirement-section>header span{font:10px ui-monospace,monospace;color:var(--signal)}.retirement-section h2{margin:0;font-size:18px;font-weight:500}
  .retirement-intro{max-width:850px;margin:0;padding:16px 22px;color:var(--muted);font-size:12px;line-height:1.5}.retirement-notice{padding:12px 22px;color:var(--signal);font:11px ui-monospace,monospace;border-top:1px solid var(--line)}
  .retirement-refresh{border:0;background:transparent;color:var(--signal);font-size:18px;cursor:pointer}.retirement-table-wrap{overflow-x:auto;border-top:1px solid var(--line)}
  .retirement-section table{width:100%;border-collapse:collapse;min-width:900px}.retirement-section th,.retirement-section td{padding:12px 14px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top;font:10px ui-monospace,monospace}.retirement-section th{padding-block:8px;color:var(--muted);font-weight:400}.retirement-section th button{border:0;background:transparent;color:inherit;font:inherit;padding:0;cursor:pointer}.retirement-section tbody tr:last-child td{border-bottom:0}
  .retirement-folder{max-width:480px}.retirement-folder strong{display:block;color:#fff;font-weight:500;overflow-wrap:anywhere}.retirement-section td small{display:block;margin-top:4px;color:var(--muted)}.retirement-result{color:var(--signal)!important}.retirement-state{text-transform:uppercase;color:var(--muted)}.retirement-state.verified{color:var(--signal)}.retirement-state.blocked{color:#ff8b70}
  .retirement-actions{display:flex;gap:6px;justify-content:flex-end}.retirement-actions button{border:1px solid var(--line);background:transparent;color:#fff;padding:7px 10px;font:9px ui-monospace,monospace;cursor:pointer}.retirement-actions button:disabled{opacity:.28;cursor:not-allowed}.retirement-actions .delete-source:not(:disabled){border-color:#ff765f;color:#ff8b70}.empty-retirement{padding:30px!important;text-align:center!important;color:var(--muted)}.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(max-width:760px){.discogs-folder-inputs{grid-template-columns:1fr}.discogs-folder-adopt>header{display:grid}.setup-grid{grid-template-columns:1fr auto}.setup-grid label{grid-column:span 2}.save-setup{grid-column:span 2}.retirement-section{margin-top:42px}.retirement-section>header{padding:15px}.retirement-intro{padding:14px 15px}}
  .audio-inspect{max-width:1500px;padding-top:64px}.audio-inspect .intro{margin-bottom:54px}.audio-inspect .workflow article{background:var(--surface);border-color:var(--line)}.audio-inspect .workflow article header span{color:var(--signal)}.audio-inspect .signal-outline{border-color:var(--signal);color:var(--signal);background:transparent;font:700 11.5px ui-monospace,monospace;letter-spacing:.04em}.audio-inspect .signal-outline:hover:not(:disabled){background:#c6ff5212}.audio-inspect label{font-size:12.65px}.audio-inspect .status-line{font-size:14.95px}.audio-inspect .surf-item-btn span{font-size:11.5px!important}.audio-inspect .surf-count{font-size:10.35px}
</style>
