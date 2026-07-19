<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import type { AvCatalogItem, AvCredit, AvMetadataCandidate, AvTreeStrategy, Capture, StorageOperation } from '@zztt/aby-domain';

  type Source = { objectKey: string; mediaKind: string; workTitle: string; creatorDisplay: string };
  let items = $state<AvCatalogItem[]>([]);
  let operations = $state<StorageOperation[]>([]);
  let sources = $state<Source[]>([]);
  let selected = $state<AvCatalogItem | null>(null);
  let video = $state<HTMLVideoElement | null>(null);
  let videoUrl = $state('');
  let sourceQuery = $state('');
  let selectedSource = $state('');
  let title = $state('');
  let originalTitle = $state('');
  let year = $state<number | undefined>();
  let director = $state('');
  let entity = $state('');
  let saga = $state('');
  let summary = $state('');
  let posterUrl = $state('');
  let externalIds = $state<Record<string, string>>({});
  let credits = $state<AvCredit[]>([]);
  let country = $state('');
  let languages = $state<string[]>([]);
  let metadataSources = $state<Array<{ authority: string; externalId: string; canonicalUrl: string; fetchedAt: string }>>([]);
  let metadataCandidates = $state<AvMetadataCandidate[]>([]);
  let metadataServices = $state<Record<string, string>>({});
  let treeStrategy = $state<AvTreeStrategy>('author');
  let treeValue = $state('');
  let busy = $state(false);
  let message = $state('');
  let speed = $state(1);
  let subtitlesOn = $state(true);
  let doubleSubtitles = $state(false);
  let primaryLanguage = $state('und');
  let secondaryLanguage = $state('none');
  let subtitleSize = $state(100);
  let captureIn = $state<number | null>(null);
  let captureOut = $state<number | null>(null);
  let captureLabel = $state('');
  let lastCapture = $state<Capture | null>(null);
  let operationTimer: ReturnType<typeof setInterval> | undefined;

  const filteredSources = $derived(sources.filter((source) => source.mediaKind === 'mov' && (!sourceQuery.trim() || source.objectKey.toLocaleLowerCase().includes(sourceQuery.trim().toLocaleLowerCase()))));

  function formatBytes(value: number) {
    const units = ['B','KB','MB','GB','TB']; let amount = value; let unit = 0;
    while (amount >= 1_000 && unit < units.length - 1) { amount /= 1_000; unit += 1; }
    return `${amount.toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
  }
  function formatTime(ms: number) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function progress(operation: StorageOperation) { return operation.sizeBytes ? Math.min(100, operation.transferredBytes / operation.sizeBytes * 100) : 0; }

  async function loadCatalog() {
    const [itemsResponse, operationsResponse] = await Promise.all([fetch('/api/av/items'), fetch('/api/av/operations')]);
    const itemsBody = await itemsResponse.json(); const operationsBody = await operationsResponse.json();
    if (!itemsResponse.ok) throw new Error(itemsBody.error?.message ?? 'AV catalog could not be loaded');
    if (!operationsResponse.ok) throw new Error(operationsBody.error?.message ?? 'Operation thread could not be loaded');
    items = itemsBody.items ?? []; operations = operationsBody.operations ?? [];
    if (!selected && items[0]) await selectItem(items[0]);
  }

  async function loadSources() {
    const response = await fetch('/api/ingest/sources?mode=surf&limit=250');
    const body = await response.json();
    if (response.ok) sources = (body.sources ?? []).filter((source: Source) => source.mediaKind === 'mov');
  }

  onMount(() => {
    Promise.all([loadCatalog(), loadSources()]).catch((error) => message = error instanceof Error ? error.message : 'VIEW could not be loaded');
    operationTimer = setInterval(() => loadCatalog().catch(() => {}), 2_000);
    return () => clearInterval(operationTimer);
  });

  function chooseSource(source: Source) {
    selectedSource = source.objectKey;
    title = source.workTitle || source.objectKey.split('/').at(-1)?.replace(/\.[^.]+$/, '') || '';
    if (!treeValue) treeValue = source.creatorDisplay === 'Unknown Artist' ? 'unknown' : source.creatorDisplay;
  }

  async function searchMetadata() {
    if (!title.trim()) return;
    busy = true; message = 'Querying TMDB, Wikidata and Internet Archive…';
    try {
      const params = new SvelteURLSearchParams({ q: title.trim() });
      if (year) params.set('year', String(year));
      const response = await fetch(`/api/av/metadata?${params}`); const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Metadata search failed');
      metadataCandidates = body.candidates ?? []; metadataServices = body.services ?? {};
      message = metadataCandidates.length ? `${metadataCandidates.length} candidates. Choose one; nothing is written yet.` : 'No candidates found.';
    } catch (error) { message = error instanceof Error ? error.message : 'Metadata search failed'; }
    finally { busy = false; }
  }

  async function useCandidate(candidate: AvMetadataCandidate) {
    title = candidate.title; originalTitle = candidate.originalTitle ?? '';
    year = candidate.year; summary = candidate.summary ?? ''; posterUrl = candidate.posterUrl ?? '';
    externalIds = { ...externalIds, ...candidate.externalIds };
    metadataSources = [{ authority: candidate.authority, externalId: candidate.externalId, canonicalUrl: candidate.canonicalUrl, fetchedAt: new Date().toISOString() }];
    if (candidate.authority === 'tmdb') {
      const response = await fetch(`/api/av/metadata?tmdbId=${encodeURIComponent(candidate.externalId)}`);
      const body = await response.json();
      if (response.ok && body.details) {
        director = body.details.director || director; credits = body.details.credits ?? [];
        country = body.details.country ?? ''; languages = body.details.languages ?? [];
        externalIds = { ...externalIds, ...(body.details.externalIds ?? {}) };
      }
    }
    if (treeStrategy === 'author' && !treeValue) treeValue = director || 'unknown';
    metadataCandidates = [];
  }

  function strategyValue() {
    if (treeStrategy === 'author') return director || treeValue;
    if (treeStrategy === 'entity') return entity || treeValue;
    if (treeStrategy === 'saga') return saga || treeValue;
    if (treeStrategy === 'decade') return year ? `${Math.floor(year / 10) * 10}s` : treeValue;
    return treeValue;
  }

  async function addToCatalog() {
    if (!selectedSource || !title.trim() || !strategyValue().trim()) { message = 'Choose a source, title and tree value.'; return; }
    busy = true; message = 'Saving metadata and queuing the future copy. No bytes are moving…';
    try {
      const response = await fetch('/api/av/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        sourceObjectKey: selectedSource, title: title.trim(), ...(originalTitle.trim() ? { originalTitle: originalTitle.trim() } : {}), kind: 'film',
        ...(year ? { year } : {}), ...(director.trim() ? { director: director.trim() } : {}), ...(entity.trim() ? { entity: entity.trim() } : {}),
        ...(saga.trim() ? { saga: saga.trim() } : {}), ...(summary.trim() ? { summary: summary.trim() } : {}), ...(posterUrl ? { posterUrl } : {}),
        languages, credits, ...(country ? { country } : {}), externalIds, metadataSources, treeStrategy, treeValue: strategyValue().trim(), destinationObjectKey: 'server-proposed'
      }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? 'AV item could not be cataloged');
      message = body.message; await loadCatalog(); selected = body.item; await selectItem(body.item);
    } catch (error) { message = error instanceof Error ? error.message : 'AV item could not be cataloged'; }
    finally { busy = false; }
  }

  async function selectItem(item: AvCatalogItem) {
    selected = item; lastCapture = null; captureIn = null; captureOut = null;
    const response = await fetch(`/api/av/items/${item.id}/playback`); const body = await response.json();
    if (!response.ok) { message = body.error?.message ?? 'Playback could not be issued'; return; }
    videoUrl = body.url; message = '';
  }

  function updateSpeed() { if (video) video.playbackRate = speed; }
  function setCapturePoint(kind: 'in' | 'out') {
    const value = Math.round((video?.currentTime ?? 0) * 1000);
    if (kind === 'in') captureIn = value; else captureOut = value;
  }
  async function saveCapture() {
    if (!selected || captureIn === null || captureOut === null || captureOut <= captureIn) { message = 'Set an IN and an OUT after it.'; return; }
    const response = await fetch('/api/captures', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      mediaKind: 'video', avItemId: selected.id, startTimeMs: captureIn, endTimeMs: captureOut,
      ...(captureLabel.trim() ? { label: captureLabel.trim() } : {}), annotations: []
    }) });
    const body = await response.json(); if (!response.ok) { message = body.error?.message ?? 'Capture could not be saved'; return; }
    lastCapture = body.capture; message = 'Capture saved to WORKSPACE with a closed share URL.';
  }
  async function execute(operation: StorageOperation) {
    const response = await fetch(`/api/av/operations/${operation.id}/execute`, { method: 'POST' }); const body = await response.json();
    message = response.ok ? 'EXECUTE accepted. The operation thread now follows rclone.' : body.error?.message ?? 'Operation could not start';
    await loadCatalog();
  }
</script>

<svelte:head><title>VIEW · Aby</title><meta name="description" content="Aby audiovisual catalog and temporal viewing instrument." /></svelte:head>

<main class="view-shell" class:has-selection={Boolean(selected)}>
  <section class="view-stage">
    {#if selected}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} src={videoUrl} poster={selected.posterUrl} controls playsinline onratechange={() => speed = video?.playbackRate ?? 1}></video>
      <div class="view-title"><span>{selected.year ?? '—'} · {selected.state}</span><h1>{selected.title}</h1><p>{selected.director ?? selected.entity ?? selected.treeValue}</p>{#if selected.credits.length}<details class="view-credits"><summary>CREDITS · {selected.credits.length}</summary><div>{#each selected.credits.slice(0, 80) as credit (`${credit.role}:${credit.name}:${credit.character ?? ''}`)}<p><strong>{credit.name}</strong><span>{credit.role}{credit.character ? ` · ${credit.character}` : ''}</span></p>{/each}</div></details>{/if}</div>
      <div class="subtitle-layer" class:hidden={!subtitlesOn} style={`--subtitle-size:${subtitleSize}%`} aria-live="polite"></div>
      <aside class="view-controls" aria-label="VIEW controls">
        <div><strong>SUBTITLES</strong><button class:active={subtitlesOn} onclick={() => subtitlesOn = !subtitlesOn}>{subtitlesOn ? 'ON' : 'OFF'}</button><select bind:value={primaryLanguage} aria-label="Primary subtitle language"><option value="und">NO TRACK</option></select><button onclick={() => message = 'OpenSubtitles / Podnapisi download becomes available after a provider key and subtitle attachment worker are configured.'}>DOWNLOAD OTHER</button></div>
        <div><strong>DOUBLE</strong><button class:active={doubleSubtitles} onclick={() => doubleSubtitles = !doubleSubtitles}>{doubleSubtitles ? 'ON' : 'OFF'}</button><select bind:value={secondaryLanguage} disabled={!doubleSubtitles} aria-label="Second subtitle language"><option value="none">NO TRACK</option></select><label>SIZE <input bind:value={subtitleSize} type="range" min="70" max="180" /></label></div>
        <div><strong>SPEED</strong><select bind:value={speed} onchange={updateSpeed} aria-label="Playback speed">{#each [.25,.5,.75,1,1.25,1.5,2] as value (value)}<option value={value}>{value}×</option>{/each}</select></div>
        <div class="capture-controls"><strong>CAPTURE</strong><button onclick={() => setCapturePoint('in')}>IN {captureIn === null ? '—' : formatTime(captureIn)}</button><button onclick={() => setCapturePoint('out')}>OUT {captureOut === null ? '—' : formatTime(captureOut)}</button><input bind:value={captureLabel} placeholder="Annotation / label" aria-label="Capture label" /><button class="signal" onclick={saveCapture}>SAVE + SHARE</button>{#if lastCapture}<a href={resolve('/share/[token]', { token: lastCapture.shareToken })} target="_blank">OPEN URL ↗</a>{/if}</div>
      </aside>
    {:else}<p class="view-empty">Catalog a video from <code>wasabi:zzttuntref/mov</code> without moving it.</p>{/if}
  </section>

  <aside class="av-catalog">
    <header><div><span>VIEW / CATALOG</span><strong>{items.length} items · {operations.filter((operation) => operation.state === 'pending').length} pending</strong></div></header>
    <div class="catalog-list">{#each items as item (item.id)}<button class:active={selected?.id === item.id} onclick={() => selectItem(item)}>{#if item.posterUrl}<img src={item.posterUrl} alt="" />{:else}<span class="poster-fallback">V</span>{/if}<span><strong>{item.title}</strong><small>{item.year ?? '—'} · {item.director ?? item.treeValue}</small><small>{item.state} · {formatBytes(item.technicalMetadata.sizeBytes)}</small></span></button>{/each}</div>
    <details class="add-panel" open={items.length === 0}>
      <summary>ADD FROM mov/ · METADATA ONLY</summary>
      <label>Source search<input bind:value={sourceQuery} type="search" placeholder="SEARCH mov/" /></label>
      <div class="source-list">{#each filteredSources.slice(0, 80) as source (source.objectKey)}<button class:active={selectedSource === source.objectKey} onclick={() => chooseSource(source)}>{source.objectKey.replace(/^mov\//, '')}</button>{/each}</div>
      <label>Title<input bind:value={title} /></label><label>Original title<input bind:value={originalTitle} /></label>
      <div class="form-grid"><label>Year<input bind:value={year} type="number" min="1800" max="2200" /></label><label>Director<input bind:value={director} /></label></div>
      {#if credits.length}<p class="credit-count">{credits.length} TMDB credits · IMDb {externalIds.imdb ?? '—'}</p>{/if}
      <div class="actions"><button onclick={searchMetadata} disabled={busy || !title}>QUERY METADATA</button></div>
      {#if Object.keys(metadataServices).length}<p class="service-line">{#each Object.entries(metadataServices) as [name,state] (name)}<span>{name}: {state}</span>{/each}</p>{/if}
      {#if metadataCandidates.length}<div class="metadata-results">{#each metadataCandidates as candidate (`${candidate.authority}:${candidate.externalId}`)}<button onclick={() => useCandidate(candidate)}><strong>{candidate.title}</strong><small>{candidate.authority} · {candidate.year ?? '—'}</small><p>{candidate.summary ?? ''}</p></button>{/each}</div>{/if}
      <label>Summary<textarea bind:value={summary} rows="3"></textarea></label>
      <div class="form-grid"><label>Tree<select bind:value={treeStrategy}><option value="author">AUTHOR</option><option value="decade">DECADE</option><option value="entity">ENTITY</option><option value="saga">SAGA</option><option value="custom">CUSTOM</option></select></label><label>Tree value<input bind:value={treeValue} placeholder={treeStrategy === 'author' ? 'Andrei Tarkovsky' : 'Value'} /></label></div>
      <button class="add-submit" onclick={addToCatalog} disabled={busy}>ADD TO CATALOG · NO COPY</button>
    </details>
    <section class="operation-thread"><header><span>STORAGE THREAD</span><small>origin · destination · state · size · progress · speed · ETA</small></header>{#each operations as operation (operation.id)}<article><div><strong>{operation.sourceObjectKey}</strong><small>→ {operation.destinationObjectKey}</small></div><div class="operation-meta"><span>{operation.state}</span><span>{formatBytes(operation.sizeBytes)}</span><span>{progress(operation).toFixed(1)}%</span><span>{formatBytes(operation.speedBytesPerSecond)}/s</span><span>ETA {operation.etaSeconds === undefined ? '—' : `${operation.etaSeconds}s`}</span></div><div class="progress"><i style={`width:${progress(operation)}%`}></i></div><footer><small>{operation.beaconAt ? `beacon ${new Date(operation.beaconAt).toLocaleTimeString()}` : 'not started'}</small><button onclick={() => execute(operation)} disabled={operation.state === 'running' || operation.state === 'succeeded'}>EXECUTE</button></footer></article>{/each}</section>
  </aside>
  {#if message}<div class="view-message">{message}</div>{/if}
</main>

<style>
  .view-shell{min-height:calc(100svh - 64px);display:grid;grid-template-columns:minmax(0,1fr) minmax(340px,430px);background:#090a09}.view-stage{position:sticky;top:64px;height:calc(100svh - 64px);display:grid;place-items:center;overflow:hidden;background:#050605}.view-stage video{width:100%;height:100%;object-fit:contain;background:#000}.view-title{position:absolute;left:22px;top:20px;max-width:min(70%,720px);text-shadow:0 2px 10px #000}.view-title>span{color:var(--signal);font:10px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}.view-title h1{margin:5px 0 0;font:400 clamp(30px,5vw,72px)/.95 Georgia,serif}.view-title>p{margin:8px 0;color:#c4c7c0}.view-credits{width:min(440px,60vw);max-height:34svh;margin-top:10px;padding:0 9px;background:#090a09d9;overflow:auto}.view-credits summary{padding:8px 0;cursor:pointer;color:var(--signal);font:9px ui-monospace,monospace}.view-credits p{margin:0;padding:6px 0;display:grid;grid-template-columns:1fr 1fr;gap:12px;border-top:1px solid #2c2f29;font:10px ui-monospace,monospace}.view-credits p span{color:var(--muted)}.view-empty{max-width:520px;padding:28px;color:var(--muted);font:32px/1.15 Georgia,serif}.view-controls{position:absolute;left:16px;right:16px;bottom:16px;display:grid;grid-template-columns:1.4fr 1.4fr .55fr 2fr;background:#0d0e0deF;border:1px solid #363934;backdrop-filter:blur(16px)}.view-controls>div{min-height:68px;padding:10px 12px;border-right:1px solid #30332e;display:flex;align-items:center;gap:7px;flex-wrap:wrap}.view-controls strong{width:100%;color:var(--muted);font:9px ui-monospace,monospace;letter-spacing:.12em}.view-controls button,.view-controls select,.view-controls input{min-height:30px;border:1px solid #343730;background:#171916;color:#dfe2da;font:9px ui-monospace,monospace}.view-controls button.active,.view-controls .signal{border-color:var(--signal);color:var(--signal)}.view-controls label{margin:0;font:9px ui-monospace,monospace}.capture-controls input{flex:1;min-width:110px;padding:0 8px}.capture-controls a{color:var(--signal);font:9px ui-monospace,monospace}.subtitle-layer.hidden{display:none}.av-catalog{min-height:calc(100svh - 64px);border-left:1px solid var(--line);background:#111210;overflow:hidden}.av-catalog>header{height:64px;padding:0 16px;display:flex;align-items:center;border-bottom:1px solid var(--line)}.av-catalog>header div{display:grid;gap:4px}.av-catalog header span,.operation-thread header span{color:var(--signal);font:9px ui-monospace,monospace;letter-spacing:.12em}.av-catalog header strong{font-size:13px}.catalog-list{max-height:280px;overflow:auto}.catalog-list>button{width:100%;padding:9px 14px;display:grid;grid-template-columns:52px 1fr;gap:12px;border:0;border-bottom:1px solid var(--line);background:transparent;color:#fff;text-align:left}.catalog-list>button.active{box-shadow:inset 3px 0 var(--signal);background:#1a1c18}.catalog-list img,.poster-fallback{width:52px;height:70px;object-fit:cover;background:#22251f;display:grid;place-items:center;color:var(--signal);font:28px Georgia,serif}.catalog-list button>span:last-child{display:grid;align-content:center;gap:4px;min-width:0}.catalog-list strong,.catalog-list small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.catalog-list small{color:var(--muted);font-size:9px}.add-panel{border-bottom:1px solid var(--line);padding:0 14px 18px}.add-panel summary{padding:14px 0;cursor:pointer;color:var(--signal);font:10px ui-monospace,monospace;letter-spacing:.08em}.add-panel label{margin:0 0 10px;color:var(--muted);font:9px ui-monospace,monospace}.add-panel input,.add-panel textarea,.add-panel select{width:100%;box-sizing:border-box;margin-top:5px;padding:8px;border:1px solid var(--line);background:#090a09;color:#fff}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.credit-count{margin:0 0 9px;color:var(--muted);font:8px ui-monospace,monospace}.source-list{max-height:130px;margin:-4px 0 12px;overflow:auto;border:1px solid var(--line)}.source-list button{width:100%;padding:7px 8px;border:0;border-bottom:1px solid #22241f;background:transparent;color:#9da198;text-align:left;font:9px ui-monospace,monospace}.source-list button.active{color:var(--signal);background:#1a1c18}.actions{display:flex;gap:6px}.actions button,.add-submit{padding:9px 10px;border:1px solid var(--line);background:#151714;color:#fff;font:9px ui-monospace,monospace}.add-submit{width:100%;border-color:var(--signal);color:var(--signal)}.service-line{display:flex;flex-wrap:wrap;gap:5px}.service-line span{padding:4px 6px;background:#1b1d19;color:var(--muted);font:8px ui-monospace,monospace}.metadata-results{max-height:220px;overflow:auto}.metadata-results button{width:100%;padding:9px;border:0;border-bottom:1px solid var(--line);background:#0b0c0b;color:#fff;text-align:left}.metadata-results small{display:block;color:var(--signal);font-size:8px}.metadata-results p{margin:5px 0 0;color:var(--muted);font-size:10px;line-height:1.35}.operation-thread{padding-bottom:80px}.operation-thread>header{padding:14px;display:grid;gap:4px;border-bottom:1px solid var(--line)}.operation-thread header small{color:var(--muted);font-size:8px}.operation-thread article{padding:12px 14px;border-bottom:1px solid var(--line)}.operation-thread article>div:first-child{display:grid;gap:3px}.operation-thread article strong,.operation-thread article small{overflow-wrap:anywhere;font:9px ui-monospace,monospace}.operation-thread article small{color:var(--muted)}.operation-meta{margin-top:8px;display:grid;grid-template-columns:repeat(5,1fr);gap:4px;color:#c9ccc4;font:8px ui-monospace,monospace}.progress{height:2px;margin:8px 0;background:#2c2f29}.progress i{display:block;height:100%;background:var(--signal)}.operation-thread footer{display:flex;justify-content:space-between;align-items:center}.operation-thread footer button{padding:7px 10px;border:1px solid var(--signal);background:transparent;color:var(--signal);font:9px ui-monospace,monospace}.view-message{position:fixed;z-index:30;left:18px;bottom:76px;max-width:min(640px,calc(100vw - 36px));padding:10px 12px;background:#111310eF;border-left:3px solid var(--signal);color:#e5e7e1;font:10px ui-monospace,monospace}.subtitle-layer{font-size:var(--subtitle-size)}
  @media(max-width:900px){.view-shell{grid-template-columns:1fr}.view-stage{position:relative;top:0;height:calc(76svh - 64px)}.av-catalog{border-left:0;border-top:1px solid var(--line)}.view-controls{grid-template-columns:1fr 1fr;max-height:40%;overflow:auto}.view-title h1{font-size:34px}}
</style>
