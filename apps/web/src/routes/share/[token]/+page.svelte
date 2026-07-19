<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  let media = $state<HTMLMediaElement | null>(null);
  let playing = $state(false);
  let currentMs = $state(0);

  function initialize() { if (!media) return; media.currentTime = data.capture.startTimeMs / 1000; currentMs = data.capture.startTimeMs; }
  function enforceBounds() {
    if (!media) return;
    const value = Math.round(media.currentTime * 1000);
    if (value < data.capture.startTimeMs - 100 || value >= data.capture.endTimeMs) {
      media.currentTime = data.capture.startTimeMs / 1000;
      if (value >= data.capture.endTimeMs) { media.pause(); playing = false; }
    }
    currentMs = Math.min(data.capture.endTimeMs, Math.max(data.capture.startTimeMs, Math.round(media.currentTime * 1000)));
  }
  async function toggle() { if (!media) return; if (media.paused) await media.play(); else media.pause(); }
  function activeAnnotations() { return data.capture.annotations.filter((annotation) => currentMs >= annotation.startTimeMs && currentMs < annotation.endTimeMs); }
</script>

<svelte:head><title>{data.title} · Aby Capture</title><meta name="robots" content="noindex,nofollow,noarchive" /></svelte:head>

<main class="share-shell">
  <figure>
    {#if data.capture.mediaKind === 'video'}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={media} src={data.mediaUrl} playsinline preload="auto" onloadedmetadata={initialize} ontimeupdate={enforceBounds} onseeked={enforceBounds} onplay={() => playing=true} onpause={() => playing=false}></video>
    {:else}
      <audio bind:this={media} src={data.mediaUrl} preload="metadata" onloadedmetadata={initialize} ontimeupdate={enforceBounds} onseeked={enforceBounds} onplay={() => playing=true} onpause={() => playing=false}></audio>
    {/if}
    {#each activeAnnotations() as annotation (`${annotation.startTimeMs}:${annotation.endTimeMs}:${annotation.label}`)}<div class="annotation" style={annotation.rect ? `left:${annotation.rect.x*100}%;top:${annotation.rect.y*100}%;width:${annotation.rect.width*100}%;height:${annotation.rect.height*100}%` : ''}><span>{annotation.label}</span></div>{/each}
    <button class="share-play" onclick={toggle} aria-label={playing?'Pause capture':'Play capture'}>{playing?'PAUSE':'PLAY'}</button>
    <figcaption><strong>{data.capture.label ?? data.title}</strong><span>{data.subtitle}</span><small>ABY CAPTURE · {Math.round((data.capture.endTimeMs-data.capture.startTimeMs)/100)/10}s</small></figcaption>
  </figure>
</main>

<style>
  :global(html),:global(body){margin:0;width:100%;height:100%;overflow:hidden;background:transparent}.share-shell{position:fixed;inset:0;width:100dvw;height:100dvh;background:#000;color:#fff;overflow:hidden}.share-shell figure{position:absolute;inset:0;margin:0;width:100%;height:100%;background:#000}.share-shell video{position:absolute;inset:0;width:100%;height:100%;display:block;object-fit:contain}.share-shell audio{position:absolute;width:1px;height:1px;opacity:0}.share-play{position:absolute;z-index:3;left:12px;bottom:58px;padding:9px 13px;border:1px solid #ffffff55;background:#080908b8;color:#fff;font:9px ui-monospace,monospace;letter-spacing:.1em}.annotation{position:absolute;z-index:2;pointer-events:none;border:1px solid #c6ff52;color:#fff}.annotation:not([style]){left:50%;bottom:14%;transform:translateX(-50%);border:0}.annotation span{display:inline-block;padding:5px 7px;background:#080908d9;font:11px ui-monospace,monospace}figcaption{position:absolute;z-index:2;left:0;right:0;bottom:0;padding:9px 12px;display:grid;grid-template-columns:1fr auto;gap:2px 18px;background:linear-gradient(transparent,#0b0c0bef 35%)}figcaption strong{font:italic 15px Georgia,serif}figcaption span{grid-row:2;color:#aeb2a8;font-size:10px}figcaption small{grid-row:1/3;grid-column:2;align-self:center;color:#7f837a;font:8px ui-monospace,monospace;letter-spacing:.1em}
</style>
