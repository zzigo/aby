<script lang="ts">
  import type { Asset, IngestPreview, Segment } from '@zztt/aby-domain';
  import { loadPlayback } from '$lib/player';

  let preview = $state<IngestPreview | null>(null);
  let asset = $state<Asset | null>(null);
  let segment = $state<Segment | null>(null);
  let workTitle = $state('');
  let recordingTitle = $state('');
  let startTimeMs = $state(100);
  let endTimeMs = $state(700);
  let status = $state('Ready for a bounded local inspection.');
  let busy = $state(false);

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

  async function inspectFixture() {
    busy = true;
    status = 'Calculating SHA-256 and reading ffprobe metadata…';
    try {
      const result = await request('/api/ingest/preview', { fixture: true });
      preview = result.preview;
      workTitle = preview!.candidateMetadata.title;
      recordingTitle = preview!.candidateMetadata.recordingTitle;
      asset = null;
      segment = null;
      status = 'Candidate ready. Nothing canonical has been written.';
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
      <span class="eyebrow">Phase 0 · local fixture</span>
      <h1>Listen closely.<br />Commit deliberately.</h1>
    </div>
    <p>Aby keeps the original file untouched, separates machine candidates from canonical metadata, and treats segments as temporal references before they become files.</p>
  </section>

  <section class="workflow" aria-label="Ingest workflow">
    <article class:complete={Boolean(preview)}>
      <header><span>01</span><h2>Inspect</h2></header>
      <p>Calculate a checksum and extract technical metadata from one bundled PCM fixture.</p>
      <button class="primary" onclick={inspectFixture} disabled={busy}>Inspect fixture</button>
    </article>

    <article class:complete={Boolean(asset)}>
      <header><span>02</span><h2>Confirm</h2></header>
      {#if preview}
        <label>Work title<input bind:value={workTitle} /></label>
        <label>Recording title<input bind:value={recordingTitle} /></label>
        <button class="primary" onclick={commitCandidate} disabled={busy || Boolean(asset)}>Commit canonical metadata</button>
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
        <div><dt>SHA-256</dt><dd class="mono">{preview.checksumSha256}</dd></div>
        <div><dt>Format</dt><dd>{preview.technicalMetadata.formatName} · {preview.technicalMetadata.audioCodec ?? 'unknown codec'}</dd></div>
        <div><dt>Signal</dt><dd>{preview.technicalMetadata.sampleRate ?? '—'} Hz · {preview.technicalMetadata.channels ?? '—'} ch · {preview.technicalMetadata.durationMs} ms</dd></div>
        <div><dt>Review state</dt><dd>{asset ? 'accepted by human commit' : preview.status}</dd></div>
        {#if segment}<div><dt>Segment</dt><dd>{segment.startTimeMs}–{segment.endTimeMs} ms · logical interval</dd></div>{/if}
      </dl>
    {/if}
  </section>
</main>

