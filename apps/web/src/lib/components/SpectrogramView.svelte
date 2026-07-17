<script lang="ts">
  import type { Asset } from '@zztt/aby-domain';
  import { formatDuration } from '$lib/presentation';

  type SpectrogramPayload = {
    url: string;
    checksumSha256: string;
    reviewState: 'candidate' | 'accepted' | 'rejected';
    descriptors: Record<'energy' | 'brightness' | 'motion' | 'gravity' | 'tension', number>;
    observationCount: number;
  };

  let { asset, onplay }: { asset: Asset; onplay: () => void } = $props();
  let payload = $state<SpectrogramPayload | null>(null);
  let pending = $state(true);
  let failure = $state('');

  // Segment editor states
  let editStartMs = $state(0);
  let editEndMs = $state(0);
  let busy = $state(false);
  let feedbackMessage = $state('');
  
  let activeDragSide = $state<'left' | 'right' | null>(null);
  let containerElement = $state<HTMLElement | null>(null);
  const durationMs = $derived(asset.technicalMetadata.durationMs);

  const leftPercent = $derived(durationMs > 0 ? (editStartMs / durationMs) * 100 : 0);
  const rightPercent = $derived(durationMs > 0 ? (editEndMs / durationMs) * 100 : 0);

  $effect(() => {
    const assetId = asset.id;
    const checksum = asset.checksumSha256;
    const controller = new AbortController();
    payload = null;
    pending = true;
    failure = '';
    // Reset editor bounds
    editStartMs = 0;
    editEndMs = asset.technicalMetadata.durationMs;
    feedbackMessage = '';

    void fetch(`/api/assets/${assetId}/spectrogram`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.code === 'spectrogram_pending' ? 'pending' : body.error?.message ?? 'unavailable');
        if (body.checksumSha256 !== checksum) throw new Error('checksum mismatch');
        payload = body;
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        failure = error instanceof Error ? error.message : 'unavailable';
      })
      .finally(() => { if (!controller.signal.aborted) pending = false; });
    return () => controller.abort();
  });

  function startDrag(event: PointerEvent, side: 'left' | 'right') {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    activeDragSide = side;
  }

  function handlePointerMove(event: PointerEvent) {
    if (!activeDragSide || !containerElement) return;
    const rect = containerElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    const targetTimeMs = Math.round((percent / 100) * durationMs);

    if (activeDragSide === 'left') {
      editStartMs = Math.min(targetTimeMs, editEndMs - 100);
    } else {
      editEndMs = Math.max(targetTimeMs, editStartMs + 100);
    }
  }

  function endDrag(event: PointerEvent) {
    if (!activeDragSide) return;
    const target = event.currentTarget as HTMLElement;
    try {
      target.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore if pointer capture release fails
    }
    activeDragSide = null;
  }

  async function saveSegment() {
    busy = true;
    feedbackMessage = '';
    try {
      const response = await fetch('/api/segments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assetId: asset.id,
          startTimeMs: Math.round(editStartMs),
          endTimeMs: Math.round(editEndMs),
          sourceContext: 'studio_validated',
          label: 'Studio Selection'
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Failed to save segment');
      feedbackMessage = 'Saved!';
      setTimeout(() => { if (feedbackMessage === 'Saved!') feedbackMessage = ''; }, 3000);
    } catch (error) {
      feedbackMessage = error instanceof Error ? error.message : 'Error';
    } finally {
      busy = false;
    }
  }

  const descriptorLabels = {
    energy: 'Energy',
    brightness: 'Brightness',
    motion: 'Motion',
    gravity: 'Gravity',
    tension: 'Tension'
  } as const;
</script>

<div class="spectrogram-view" style="display: flex; flex-direction: column; gap: 12px; height: 100%; width: 100%;">
  <div 
    bind:this={containerElement}
    onpointermove={handlePointerMove}
    class="spectrogram-container" 
    style="position: relative; flex: 1; min-height: 0; user-select: none;"
    role="region"
    aria-label="Editor de segmento espectrograma"
  >
    <button class="spectrogram-canvas" onclick={onplay} style="width: 100%; height: 100%; border: 0; padding: 0; background: #090a09; display: block; overflow: hidden; position: relative;" aria-label={`Play ${asset.canonicalMetadata.title} from spectrogram view`}>
      {#if payload}
        <img src={payload.url} alt={`Spectrogram for ${asset.canonicalMetadata.title}`} style="width: 100%; height: 100%; object-fit: fill; display: block; filter: saturate(.7) contrast(1.18);" />
      {:else}
        <span class="spectral-grid" class:pending aria-label={failure === 'pending' ? 'Spectrogram queued' : 'Spectrogram unavailable'} style="position: absolute; inset: 0; opacity: .42; background-image: linear-gradient(#30322f 1px, transparent 1px),linear-gradient(90deg,#30322f 1px,transparent 1px); background-size: 100% 12.5%, 8.333% 100%;"></span>
      {/if}
      <span class="spectrogram-time start" style="position: absolute; bottom: 7px; left: 8px; color: #d7d9d2; font: 10px ui-monospace,monospace; text-shadow: 0 1px 4px #000;">{formatDuration(editStartMs)}</span>
      <span class="spectrogram-time end" style="position: absolute; bottom: 7px; right: 8px; color: #d7d9d2; font: 10px ui-monospace,monospace; text-shadow: 0 1px 4px #000;">{formatDuration(editEndMs)}</span>
    </button>

    {#if payload}
      <!-- Selection Highlight Overlay -->
      <div 
        class="selection-highlight" 
        style="position: absolute; top: 0; bottom: 0; left: {leftPercent}%; width: {rightPercent - leftPercent}%; background: rgba(198, 255, 82, 0.15); border-left: 2px solid var(--signal); border-right: 2px solid var(--signal); pointer-events: none; z-index: 5;"
      ></div>

      <!-- Drag Handles -->
      <div 
        class="drag-handle left-handle" 
        onpointerdown={(e) => startDrag(e, 'left')}
        onpointerup={endDrag}
        onpointercancel={endDrag}
        style="position: absolute; left: calc({leftPercent}% - 12px); top: 0; bottom: 0; width: 24px; cursor: col-resize; z-index: 10; display: grid; place-items: center;"
        role="slider"
        aria-label="Ajustar inicio del segmento"
        aria-valuemin="0"
        aria-valuemax={editEndMs}
        aria-valuenow={editStartMs}
        tabindex="0"
      >
        <span style="width: 4px; height: 40px; border-radius: 2px; background: var(--signal); box-shadow: 0 0 8px var(--signal);"></span>
      </div>
      <div 
        class="drag-handle right-handle" 
        onpointerdown={(e) => startDrag(e, 'right')}
        onpointerup={endDrag}
        onpointercancel={endDrag}
        style="position: absolute; left: calc({rightPercent}% - 12px); top: 0; bottom: 0; width: 24px; cursor: col-resize; z-index: 10; display: grid; place-items: center;"
        role="slider"
        aria-label="Ajustar fin del segmento"
        aria-valuemin={editStartMs}
        aria-valuemax={durationMs}
        aria-valuenow={editEndMs}
        tabindex="0"
      >
        <span style="width: 4px; height: 40px; border-radius: 2px; background: var(--signal); box-shadow: 0 0 8px var(--signal);"></span>
      </div>
    {/if}
  </div>

  {#if payload}
    <!-- Actions Bar -->
    <div style="display: flex; gap: 16px; align-items: center; background: var(--surface); padding: 12px 18px; border: 1px solid var(--line); min-height: 58px;">
      <button 
        class="primary" 
        onclick={saveSegment} 
        disabled={busy || editEndMs <= editStartMs} 
        style="font-size: 11px; padding: 8px 16px; font-family: ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.08em;"
      >
        {busy ? 'Saving...' : 'Save Segment'}
      </button>
      <span style="color: var(--muted); font-size: 11px; font-family: ui-monospace, monospace;">
        Interval: {formatDuration(editStartMs)} – {formatDuration(editEndMs)} (Duration: {formatDuration(editEndMs - editStartMs)})
      </span>
      {#if feedbackMessage}
        <span style="color: var(--signal); font-size: 11px; font-family: ui-monospace, monospace; margin-left: auto; animation: pulse 0.5s infinite alternate;">
          {feedbackMessage}
        </span>
      {/if}
    </div>

    <!-- Descriptors Strip -->
    <div class="descriptor-strip" style="display: grid; grid-template-columns: repeat(5, 1fr); border-top: 1px solid var(--line);">
      {#each Object.entries(descriptorLabels) as [key, label] (key)}
        <div style={`--value: ${payload.descriptors[key as keyof typeof descriptorLabels]}; position: relative; min-height: 56px; padding: 10px 12px; display: grid; grid-template-columns: 1fr auto; align-content: center; gap: 4px; background: linear-gradient(90deg,#c6ff5218 calc(var(--value) * 100%),transparent 0);`}>
          <small style="color: var(--muted); text-transform: uppercase; letter-spacing: .1em; font-size: 8px;">{label}</small>
          <strong style="color: var(--signal); font: 11px ui-monospace,monospace; font-weight: 500;">{Math.round(payload.descriptors[key as keyof typeof descriptorLabels] * 100)}</strong>
          <span style="display: none;"></span>
        </div>
      {/each}
    </div>
  {:else if !pending && failure !== 'pending'}
    <div class="spectrogram-error" style="color: #ff8e78; font: 11px ui-monospace,monospace;">{failure}</div>
  {/if}
</div>
