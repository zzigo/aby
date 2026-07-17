<script lang="ts">
  import { onMount } from 'svelte';
  import type { Asset, IngestPreview, Segment } from '@zztt/aby-domain';
  import type { PageData } from './$types';
  import { loadPlayback, loadSegmentPlayback } from '$lib/player';
  import { formatDuration, formatTechnicalFormat } from '$lib/presentation';

  let { data }: { data: PageData } = $props();

  let preview = $state<IngestPreview | null>(null);
  let asset = $state<Asset | null>(null);
  let segment = $state<Segment | null>(null);
  let workTitle = $state('');
  let recordingTitle = $state('');
  let startTimeMs = $state(100);
  let endTimeMs = $state(700);
  let status = $state('Ready for one bounded inspection.');
  let busy = $state(false);
  let autoSeparation = $state(true);
  let requiresPromotion = $derived(Boolean(preview?.candidateMetadata.canonicalObjectKey && preview.candidateMetadata.canonicalObjectKey !== preview.objectKey));

  onMount(() => {
    const userId = data.user?.id ?? 'anonymous';
    autoSeparation = localStorage.getItem(`aby.config.auto-separation:${userId}`) !== 'false';
  });

  function toggleAutoSeparation() {
    autoSeparation = !autoSeparation;
    const userId = data.user?.id ?? 'anonymous';
    localStorage.setItem(`aby.config.auto-separation:${userId}`, String(autoSeparation));
  }

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

  async function surpriseMe() {
    busy = true;
    status = 'Checking Wasabi storage for untracked sources…';
    try {
      const response = await fetch('/api/ingest/sources');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Failed to load source list');
      
      const sources = body.sources;
      if (!sources || sources.length === 0) {
        status = 'No legacy sources found to catalog.';
        return;
      }
      
      // Pick a random source
      const randomIndex = Math.floor(Math.random() * sources.length);
      const selectedSource = sources[randomIndex];
      
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
      
      preview = result.preview;
      workTitle = preview!.candidateMetadata.title;
      recordingTitle = preview!.candidateMetadata.recordingTitle;
      asset = null;
      segment = null;
      status = `Inspected: ${preview!.objectKey}. Real candidate ready.`;
    } catch (error) {
      status = error instanceof Error ? error.message : 'Surprise discovery failed';
    } finally {
      busy = false;
    }
  }

  async function commitCandidate() {
    if (!preview) return;
    busy = true;
    try {
      const result = await request('/api/ingest/commit', {
        previewId: preview.id,
        workTitle,
        recordingTitle
      });
      asset = result.asset;
      status = 'Work, recording and asset committed explicitly.';
    } catch (error) {
      status = error instanceof Error ? error.message : 'Commit failed';
    } finally {
      busy = false;
    }
  }

  async function promoteCandidate() {
    if (!preview) return;
    busy = true;
    status = 'Copying one object to Aby and verifying its SHA-256…';
    try {
      const result = await request('/api/ingest/promote', { previewId: preview.id });
      preview = result.preview;
      status = `Canonical copy verified. ${result.sourceRetirement.objectKey} is now a deletion candidate; the source remains intact.`;
    } catch (error) {
      status = error instanceof Error ? error.message : 'Promotion failed';
    } finally {
      busy = false;
    }
  }

  async function createSegment() {
    if (!asset) return;
    busy = true;
    try {
      const result = await request('/api/segments', {
        assetId: asset.id,
        startTimeMs,
        endTimeMs,
        label: 'Manual Phase 0 selection'
      });
      segment = result.segment;
      status = 'Logical segment saved with human provenance; no clip was materialized.';
    } catch (error) {
      status = error instanceof Error ? error.message : 'Segment creation failed';
    } finally {
      busy = false;
    }
  }

  async function play() {
    if (!asset) return;
    try {
      await loadPlayback(asset.id, workTitle, recordingTitle);
      status = 'Temporary playback URL issued.';
    } catch (error) {
      status = error instanceof Error ? error.message : 'Playback failed';
    }
  }

  async function playSegment() {
    if (!asset || !segment) return;
    try {
      await loadSegmentPlayback(asset.id, `${workTitle} · segment`, recordingTitle, segment.startTimeMs, segment.endTimeMs);
      status = `Playing segment ${segment.startTimeMs}–${segment.endTimeMs} ms.`;
    } catch (error) {
      status = error instanceof Error ? error.message : 'Segment playback failed';
    }
  }
</script>

<svelte:head>
  <title>Aby — Inspect temporal media</title>
  <meta name="description" content="Private temporal media inspection with explicit provenance." />
</svelte:head>

<main>
  <section class="intro">
    <div>
      <span class="eyebrow">Phase 1 · one work at a time</span>
      <h1>Listen closely.<br />Commit deliberately.</h1>
    </div>
    <div class="intro-context">
      <p>Aby keeps the original file untouched, separates machine candidates from canonical metadata, and treats segments as temporal references before they become files.</p>
      {#if data.user}
        <div class="identity"><span>{data.user.name || data.user.email || 'Logto user'}</span><small>Shared Logto identity</small><form method="POST" action="?/signOut"><button class="secondary">Sign out</button></form></div>
        <div class="config-panel" style="margin-top: 12px; padding: 12px; border: 1px solid var(--line); background: var(--surface); display: flex; align-items: center; justify-content: space-between; font-size: 13px;">
          <span style="color: var(--muted);">Separación automática (BS-Roformer)</span>
          <button class="config-toggle" class:active={autoSeparation} onclick={toggleAutoSeparation} style="padding: 6px 12px; font-size: 11px; font-family: ui-monospace, monospace; border: 1px solid var(--line); background: {autoSeparation ? 'var(--signal)' : 'transparent'}; color: {autoSeparation ? '#101110' : '#fff'}; font-weight: {autoSeparation ? '700' : '400'}; transition: 0.15s;">
            {autoSeparation ? 'ACTIVADA' : 'DESACTIVADA'}
          </button>
        </div>
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
        <button class="primary" onclick={surpriseMe} disabled={busy}>Surprise me!</button>
      {:else}
        <button class="secondary" disabled>Sign in first</button>
      {/if}
    </article>

    <article class:complete={Boolean(asset)}>
      <header><span>02</span><h2>Confirm</h2></header>
      {#if preview}
        <label>Work title<input bind:value={workTitle} /></label>
        <label>Recording title<input bind:value={recordingTitle} /></label>
        {#if requiresPromotion}
          <button class="primary" onclick={promoteCandidate} disabled={busy || Boolean(asset)}>Promote to Aby</button>
        {:else}
          <button class="primary" onclick={commitCandidate} disabled={busy || Boolean(asset)}>Commit canonical metadata</button>
        {/if}
      {:else}
        <p>Candidate metadata will appear here. It remains editable until explicit commit.</p>
      {/if}
    </article>

    <article class:complete={Boolean(segment)}>
      <header><span>03</span><h2>Segment</h2></header>
      {#if asset}
        <div class="time-fields">
          <label>Start ms<input type="number" bind:value={startTimeMs} min="0" /></label>
          <label>End ms<input type="number" bind:value={endTimeMs} min="1" /></label>
        </div>
        <div class="actions">
          <button class="secondary" onclick={play}>Play asset</button>
          {#if segment}<button class="secondary" onclick={playSegment}>Play segment</button>{/if}
          <button class="primary" onclick={createSegment} disabled={busy}>Save interval</button>
        </div>
      {:else}
        <p>Playback and interval tools unlock only after canonical confirmation.</p>
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
          <div><dt>Feature image</dt><dd><img class="feature-candidate" src={preview.candidateMetadata.imageCandidates[0].url} alt="Candidate feature art" /><small>{preview.candidateMetadata.imageCandidates[0].exactRelease ? 'Exact release cover' : 'Release-group fallback; requires confirmation'}</small></dd></div>
        {/if}
        {#if segment}<div><dt>Segment</dt><dd>{segment.startTimeMs}–{segment.endTimeMs} ms · logical interval</dd></div>{/if}
      </dl>
    {/if}
  </section>
</main>
