<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { currentPlayback } from '$lib/player';

  let audio: HTMLAudioElement;

  function seekToSegmentStart() {
    if (!audio || $currentPlayback?.startTimeMs === undefined) return;
    audio.currentTime = $currentPlayback.startTimeMs / 1000;
  }

  function enforceSegmentEnd() {
    if (!audio || $currentPlayback?.endTimeMs === undefined) return;
    const endSeconds = $currentPlayback.endTimeMs / 1000;
    if (audio.currentTime >= endSeconds) {
      audio.pause();
      audio.currentTime = endSeconds;
    }
  }

  onMount(() => {
    const unsubscribe = currentPlayback.subscribe((item) => {
      if (!item || !('mediaSession' in navigator)) return;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.title,
        artist: item.subtitle,
        album: 'Aby'
      });
    });
    return unsubscribe;
  });
</script>

{#if $currentPlayback}
  <aside class:instrument-mode={page.url.pathname.startsWith('/player')} class="persistent-player" aria-label="Persistent media player">
    <div class="player-context">
      <strong>{$currentPlayback.title}</strong>
      <small>{$currentPlayback.subtitle}</small>
    </div>
    <audio bind:this={audio} src={$currentPlayback.url} controls autoplay preload="metadata" onloadedmetadata={seekToSegmentStart} ontimeupdate={enforceSegmentEnd}></audio>
  </aside>
{/if}
