<script lang="ts">
  import type { Asset } from '@zztt/aby-domain';
  import { currentPlayback, currentPlaybackTimeMs } from '$lib/player';
  import { formatDuration } from '$lib/presentation';

  let { asset }: { asset: Asset } = $props();
  let waveformUrl = $state('');
  let pending = $state(true);
  let failure = $state('');
  let container = $state<HTMLElement | null>(null);
  let inMs = $state<number | null>(null);
  let outMs = $state<number | null>(null);
  let regionStartMs = $state<number | null>(null);
  let regionDrawing = $state(false);
  let drag = $state<null | { kind: 'in' | 'out' | 'range'; anchorMs: number; startMs: number; endMs: number }>(null);
  let seekDragging = $state(false);
  let cursorMs = $state(0);
  let feedback = $state('');
  const durationMs = $derived(asset.technicalMetadata.durationMs);
  const inPercent = $derived(inMs === null || durationMs <= 0 ? 0 : inMs / durationMs * 100);
  const outPercent = $derived(outMs === null || durationMs <= 0 ? 0 : outMs / durationMs * 100);
  const playheadMs = $derived($currentPlayback?.assetId === asset.id ? $currentPlaybackTimeMs : cursorMs);
  const playheadPercent = $derived(durationMs > 0 ? playheadMs / durationMs * 100 : 0);

  $effect(() => {
    const assetId = asset.id;
    const checksum = asset.checksumSha256;
    const controller = new AbortController();
    waveformUrl = '';
    pending = true;
    failure = '';
    inMs = null;
    outMs = null;
    cursorMs = 0;
    void fetch(`/api/assets/${assetId}/waveform`, { method: 'POST', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? 'Waveform unavailable');
        if (body.sourceChecksumSha256 !== checksum) throw new Error('Waveform checksum mismatch');
        waveformUrl = body.url;
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        failure = error instanceof Error ? error.message : 'Waveform unavailable';
      })
      .finally(() => { if (!controller.signal.aborted) pending = false; });
    return () => controller.abort();
  });

  function timeAt(clientX: number) {
    if (!container || durationMs <= 0) return 0;
    const rect = container.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * durationMs);
  }

  function applyRegion(start: number, end: number) {
    inMs = Math.max(0, Math.min(start, end - 100));
    outMs = Math.min(durationMs, Math.max(end, inMs + 100));
  }

  function clearSelection() {
    inMs = null;
    outMs = null;
    regionStartMs = null;
    regionDrawing = false;
  }

  function startRegion(event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const value = timeAt(event.clientX);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    regionStartMs = value;
    regionDrawing = true;
    inMs = value;
    outMs = null;
  }

  function moveRegion(event: PointerEvent) {
    if (drag) {
      moveDrag(event);
      return;
    }
    if (!regionDrawing || regionStartMs === null) return;
    const value = timeAt(event.clientX);
    if (Math.abs(value - regionStartMs) < 100) return;
    applyRegion(Math.min(regionStartMs, value), Math.max(regionStartMs, value));
  }

  function endRegion(event: PointerEvent) {
    if (drag) {
      endDrag(event);
      return;
    }
    if (!regionDrawing) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    const value = timeAt(event.clientX);
    const start = regionStartMs;
    regionDrawing = false;
    regionStartMs = null;
    if (start === null || Math.abs(value - start) < 100) {
      inMs = null;
      outMs = null;
      return;
    }
    applyRegion(Math.min(start, value), Math.max(start, value));
  }

  function startDrag(event: PointerEvent, kind: 'in' | 'out' | 'range') {
    if (inMs === null || outMs === null) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { kind, anchorMs: timeAt(event.clientX), startMs: inMs, endMs: outMs };
  }

  function moveDrag(event: PointerEvent) {
    if (!drag) return;
    const value = timeAt(event.clientX);
    if (drag.kind === 'in') applyRegion(Math.min(value, drag.endMs - 100), drag.endMs);
    else if (drag.kind === 'out') applyRegion(drag.startMs, Math.max(value, drag.startMs + 100));
    else {
      const length = drag.endMs - drag.startMs;
      const nextStart = Math.max(0, Math.min(durationMs - length, drag.startMs + value - drag.anchorMs));
      applyRegion(nextStart, nextStart + length);
    }
  }

  function endDrag(event: PointerEvent) {
    if (!drag) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    drag = null;
  }

  function seekTo(clientX: number) {
    const value = timeAt(clientX);
    cursorMs = value;
    if ($currentPlayback?.assetId !== asset.id) return;
    const audio = document.querySelector<HTMLAudioElement>('.persistent-player audio');
    if (!audio) return;
    audio.currentTime = value / 1000;
    currentPlaybackTimeMs.set(value);
  }

  function startSeek(event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    seekDragging = true;
    seekTo(event.clientX);
  }

  function moveSeek(event: PointerEvent) {
    if (seekDragging) seekTo(event.clientX);
  }

  function endSeek(event: PointerEvent) {
    if (!seekDragging) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    seekDragging = false;
  }

  async function saveSegment() {
    if (inMs === null || outMs === null) return;
    const response = await fetch('/api/segments', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: asset.id, startTimeMs: inMs, endTimeMs: outMs, sourceContext: 'manual_selection', label: 'Waveform Selection' })
    });
    const body = await response.json();
    feedback = response.ok ? 'SAVED' : body.error?.message ?? 'SAVE FAILED';
  }
</script>

<div class="waveform-view" ontouchstart={(event) => event.stopPropagation()} ontouchend={(event) => event.stopPropagation()} role="region" aria-label="Waveform">
  <div bind:this={container} class="waveform">
    {#if waveformUrl}<img src={waveformUrl} alt={`Waveform for ${asset.canonicalMetadata.recordingTitle}`} />
    {:else}<div class:pending class="waveform-grid"></div>{/if}
    <div class="region-lane" onpointerdown={startRegion} onpointermove={moveRegion} onpointerup={endRegion} onpointercancel={endRegion} ondblclick={clearSelection} onkeydown={(event) => { if (event.key === 'Escape') clearSelection(); }} role="button" tabindex="0" aria-label="Drag to select waveform region">
      {#if inMs !== null}<span class="marker in" style={`left:${inPercent}%`}>IN</span>{/if}
      {#if outMs !== null}<span class="marker out" style={`left:${outPercent}%`}>OUT</span>{/if}
      {#if inMs !== null && outMs !== null}
        <button class="selection" style={`left:${inPercent}%;width:${outPercent - inPercent}%`} onpointerdown={(event) => startDrag(event, 'range')} onclick={(event) => event.stopPropagation()} aria-label="Drag loop selection"></button>
        <button class="handle in-handle" style={`left:${inPercent}%`} onpointerdown={(event) => startDrag(event, 'in')} onclick={(event) => event.stopPropagation()} aria-label="Move loop in point"></button>
        <button class="handle out-handle" style={`left:${outPercent}%`} onpointerdown={(event) => startDrag(event, 'out')} onclick={(event) => event.stopPropagation()} aria-label="Move loop out point"></button>
      {/if}
    </div>
    <div class="transport-lane" onpointerdown={startSeek} onpointermove={moveSeek} onpointerup={endSeek} onpointercancel={endSeek} role="slider" tabindex="0" aria-label="Waveform playback cursor" aria-valuemin="0" aria-valuemax={durationMs} aria-valuenow={playheadMs}></div>
    <span class="midline"></span>
    <span class="playhead" style={`left:${playheadPercent}%`}></span>
    <span class="clock start">00:00</span><span class="clock end">{formatDuration(durationMs)}</span>
  </div>
  <div class="waveform-footer">
    <span>{inMs === null ? 'IN —' : `IN ${formatDuration(inMs)}`} · {outMs === null ? 'OUT —' : `OUT ${formatDuration(outMs)}`}</span>
    {#if inMs !== null && outMs !== null}<button onclick={saveSegment}>SAVE</button>{/if}
    {#if feedback}<span>{feedback}</span>{/if}
    {#if failure}<span class="failure">{failure}</span>{/if}
  </div>
</div>

<style>
  .waveform-view{width:100%;height:100%;display:grid;grid-template-rows:1fr 34px;background:#090a09}.waveform{position:relative;min-height:0;overflow:hidden;touch-action:none;user-select:none}.waveform img{width:100%;height:100%;display:block;object-fit:fill;opacity:.88}.waveform-grid{position:absolute;inset:0;background:repeating-linear-gradient(90deg,#1b1d1a 0 1px,transparent 1px 8.333%),linear-gradient(#171916,#0a0b0a)}.waveform-grid.pending{animation:pulse 1.2s ease-in-out infinite alternate}.region-lane,.transport-lane{position:absolute;z-index:2;left:0;right:0}.region-lane{top:0;height:50%;cursor:crosshair}.transport-lane{bottom:0;height:50%;cursor:ew-resize}.midline{position:absolute;z-index:1;top:50%;right:0;left:0;height:1px;background:#ffffff16;pointer-events:none}.selection{position:absolute;top:0;bottom:0;border:0;border-left:1px solid var(--signal);border-right:1px solid var(--signal);background:#c6ff5224;cursor:grab}.handle{position:absolute;top:0;bottom:0;width:28px;transform:translateX(-50%);border:0;background:transparent;cursor:ew-resize;z-index:3}.marker{position:absolute;top:10px;transform:translateX(-50%);z-index:4;color:var(--signal);font:8px ui-monospace,monospace}.playhead{position:absolute;top:0;bottom:0;width:1px;background:#fff;box-shadow:0 0 8px #fff;pointer-events:none;z-index:5}.playhead::after{content:'';position:absolute;top:calc(50% - 4px);left:50%;width:7px;height:7px;border-radius:50%;background:#fff;transform:translate(-50%,-50%)}.clock{position:absolute;z-index:4;bottom:8px;color:var(--muted);font:9px ui-monospace,monospace;pointer-events:none}.clock.start{left:9px}.clock.end{right:9px}.waveform-footer{display:flex;align-items:center;gap:12px;padding:0 12px;border-top:1px solid var(--line);color:var(--muted);font:9px ui-monospace,monospace}.waveform-footer button{margin-left:auto;border:0;background:transparent;color:var(--signal);font:inherit}.failure{color:#ff8e78}@keyframes pulse{to{opacity:.45}}
</style>
