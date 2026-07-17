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

  $effect(() => {
    const assetId = asset.id;
    const checksum = asset.checksumSha256;
    const controller = new AbortController();
    payload = null;
    pending = true;
    failure = '';
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

  const descriptorLabels = {
    energy: 'Energy',
    brightness: 'Brightness',
    motion: 'Motion',
    gravity: 'Gravity',
    tension: 'Tension'
  } as const;
</script>

<div class="spectrogram-view">
  <button class="spectrogram-canvas" onclick={onplay} aria-label={`Play ${asset.canonicalMetadata.title} from spectrogram view`}>
    {#if payload}
      <img src={payload.url} alt={`Spectrogram for ${asset.canonicalMetadata.title}`} />
    {:else}
      <span class="spectral-grid" class:pending aria-label={failure === 'pending' ? 'Spectrogram queued' : 'Spectrogram unavailable'}></span>
    {/if}
    <span class="spectrogram-time start">0:00</span>
    <span class="spectrogram-time end">{formatDuration(asset.technicalMetadata.durationMs)}</span>
  </button>
  {#if payload}
    <div class="descriptor-strip">
      {#each Object.entries(descriptorLabels) as [key, label] (key)}
        <div style={`--value: ${payload.descriptors[key as keyof typeof descriptorLabels]}`}>
          <small>{label}</small>
          <strong>{Math.round(payload.descriptors[key as keyof typeof descriptorLabels] * 100)}</strong>
          <span></span>
        </div>
      {/each}
    </div>
  {:else if !pending && failure !== 'pending'}
    <div class="spectrogram-error">{failure}</div>
  {/if}
</div>
