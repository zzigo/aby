<script lang="ts">
  import { onMount } from 'svelte';
  import { currentPlayback } from '$lib/player';

  let audio: HTMLAudioElement;

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
  <aside class="persistent-player" aria-label="Persistent media player">
    <div class="player-context">
      <span class="eyebrow">Now listening</span>
      <strong>{$currentPlayback.title}</strong>
      <small>{$currentPlayback.subtitle}</small>
    </div>
    <audio bind:this={audio} src={$currentPlayback.url} controls autoplay preload="metadata"></audio>
  </aside>
{/if}

