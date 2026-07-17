<script lang="ts">
  import type { Asset, IngestPreview, Segment } from '@zztt/aby-domain';
  import type { PageData } from './$types';
  import { loadPlayback } from '$lib/player';
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
  let requiresPromotion = $derived(Boolean(preview?.candidateMetadata.canonicalObjectKey && preview.candidateMetadata.canonicalObjectKey !== preview.objectKey));

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

  async function inspectFirstWork() {
    busy = true;
    status = 'Reading one Wasabi object, calculating SHA-256 and consulting MusicBrainz…';
    try {
      const result = await request('/api/ingest/preview', {
        sourceObjectKey: 'ref/20 late/Gavin Bryars/The Sinking of the Titanic/Sinking of the Titanic.mp3',
        mediaKind: 'aud',
        collectionCode: '20L',
        entitySlug: 'bryars',
        creatorDisplay: 'Gavin Bryars',
        workTitle: 'The Sinking of the Titanic',
        analyze: false
      });
      preview = result.preview;
      workTitle = preview!.candidateMetadata.title;
      recordingTitle = preview!.candidateMetadata.recordingTitle;
      asset = null;
      segment = null;
      status = 'Real candidate ready. Wasabi remains unchanged until reviewed promotion.';
    } catch (error) {
      status = error instanceof Error ? error.message : 'Inspection failed';
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
      {:else}
        <form method="POST" action="?/signIn"><button class="primary">Continue with Logto</button></form>
      {/if}
    </div>
  </section>

  <section class="workflow" aria-label="Ingest workflow">
    <article class:complete={Boolean(preview)}>
      <header><span>01</span><h2>Inspect</h2></header>
      <p>{data.user ? 'Inspect the selected Gavin Bryars object without scanning the rest of ref/.' : 'Authentication uses the same Logto identity as Seshat and Musiki.'}</p>
      {#if data.user}
        <button class="primary" onclick={inspectFirstWork} disabled={busy}>Inspect first Wasabi work</button>
      {:else}
        <button class="secondary" disabled>Sign in first</button>
      {/if}
    </article>

    <article class:complete={Boolean(asset)}>
      <header><span>02</span><h2>Confirm</h2></header>
      {#if preview}
        <label>Work title<input bind:value={workTitle} /></label>
        <label>Recording title<input bind:value={recordingTitle} /></label>
        <button class="primary" onclick={commitCandidate} disabled={busy || Boolean(asset) || requiresPromotion}>{requiresPromotion ? 'Promotion requires review' : 'Commit canonical metadata'}</button>
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
        {#if preview.candidateMetadata.imageCandidates?.[0]}
          <div><dt>Feature image</dt><dd><img class="feature-candidate" src={preview.candidateMetadata.imageCandidates[0].url} alt="Candidate feature art" /><small>{preview.candidateMetadata.imageCandidates[0].exactRelease ? 'Exact release cover' : 'Release-group fallback; requires confirmation'}</small></dd></div>
        {/if}
        {#if segment}<div><dt>Segment</dt><dd>{segment.startTimeMs}–{segment.endTimeMs} ms · logical interval</dd></div>{/if}
      </dl>
    {/if}
  </section>
</main>
