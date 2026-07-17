<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { currentPlayback, currentPlaybackTimeMs } from '$lib/player';
  import { formatDuration } from '$lib/presentation';

  let audio = $state<HTMLAudioElement | null>(null);
  let progressBarElement = $state<HTMLElement | null>(null);

  let currentTimeMs = $state(0);
  let durationMs = $state(0);
  let isPlaying = $state(false);
  let isDragging = $state(false);

  const progressPercent = $derived(durationMs > 0 ? (currentTimeMs / durationMs) * 100 : 0);

  function seekToSegmentStart() {
    if (!audio) return;
    if ($currentPlayback?.startTimeMs !== undefined) {
      audio.currentTime = $currentPlayback.startTimeMs / 1000;
    } else {
      audio.currentTime = 0;
    }
    currentTimeMs = audio.currentTime * 1000;
    currentPlaybackTimeMs.set(currentTimeMs);
    isPlaying = !audio.paused;
  }

  function handleTimeUpdate() {
    if (!audio || isDragging) return;
    enforceSegmentEnd();
    currentTimeMs = audio.currentTime * 1000;
    currentPlaybackTimeMs.set(currentTimeMs);
  }

  function handleDurationChange() {
    if (!audio) return;
    durationMs = audio.duration * 1000;
  }

  function enforceSegmentEnd() {
    if (!audio || $currentPlayback?.endTimeMs === undefined) return;
    const endSeconds = $currentPlayback.endTimeMs / 1000;
    if (audio.currentTime >= endSeconds) {
      audio.pause();
      audio.currentTime = endSeconds;
      isPlaying = false;
    }
  }

  function togglePlay() {
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      if ($currentPlayback?.endTimeMs !== undefined && audio.currentTime >= $currentPlayback.endTimeMs / 1000) {
        seekToSegmentStart();
      }
      audio.play().catch(() => {});
    }
  }

  function handleProgressPointerDown(event: PointerEvent) {
    if (!audio || !progressBarElement) return;
    event.preventDefault();
    progressBarElement.setPointerCapture(event.pointerId);
    isDragging = true;
    updateSeek(event);
  }

  function handleProgressPointerMove(event: PointerEvent) {
    if (!isDragging) return;
    updateSeek(event);
  }

  function handleProgressPointerUp(event: PointerEvent) {
    if (!isDragging || !progressBarElement) return;
    try {
      progressBarElement.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore pointer capture release error
    }
    isDragging = false;
    if (audio) {
      audio.currentTime = currentTimeMs / 1000;
    }
  }

  function updateSeek(event: PointerEvent) {
    if (!progressBarElement || durationMs === 0) return;
    const rect = progressBarElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    
    let targetTimeMs = percent * durationMs;
    if ($currentPlayback?.startTimeMs !== undefined) {
      targetTimeMs = Math.max($currentPlayback.startTimeMs, targetTimeMs);
    }
    if ($currentPlayback?.endTimeMs !== undefined) {
      targetTimeMs = Math.min($currentPlayback.endTimeMs, targetTimeMs);
    }
    
    currentTimeMs = targetTimeMs;
    currentPlaybackTimeMs.set(currentTimeMs);
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
  <aside 
    class:instrument-mode={page.url.pathname.startsWith('/player')} 
    class="persistent-player" 
    aria-label="Persistent media player"
    style="position: fixed; z-index: 20; left: 0; right: 0; bottom: 0; height: 60px; background: rgba(16, 17, 16, 0.94); backdrop-filter: blur(16px); border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; padding: 0; overflow: hidden; user-select: none;"
  >
    <audio 
      bind:this={audio} 
      src={$currentPlayback.url} 
      autoplay 
      preload="metadata" 
      onloadedmetadata={seekToSegmentStart} 
      ontimeupdate={handleTimeUpdate}
      ondurationchange={handleDurationChange}
      onended={() => isPlaying = false}
      onpause={() => isPlaying = false}
      onplay={() => isPlaying = true}
      style="display: none;"
    ></audio>

    <!-- Interactive Progress & Drag Area -->
    <div 
      bind:this={progressBarElement}
      onpointerdown={handleProgressPointerDown}
      onpointermove={handleProgressPointerMove}
      onpointerup={handleProgressPointerUp}
      role="slider"
      aria-label="Playback progress slider"
      aria-valuemin="0"
      aria-valuemax={durationMs}
      aria-valuenow={currentTimeMs}
      tabindex="0"
      style="position: absolute; inset: 0; cursor: pointer; display: flex; align-items: center; z-index: 1;"
    >
      <!-- Progress Fill -->
      <div style="position: absolute; left: 0; top: 0; bottom: 0; width: {progressPercent}%; background: rgba(198, 255, 82, 0.16); pointer-events: none;"></div>
      
      <!-- Full Height Cursor Line -->
      <div style="position: absolute; left: {progressPercent}%; top: 0; bottom: 0; width: 2px; background: var(--signal); pointer-events: none; z-index: 5; display: flex; flex-direction: column; justify-content: space-between; align-items: center; box-shadow: 0 0 10px var(--signal);">
        <!-- Attached current/left time bubble -->
        <span style="font: 9px ui-monospace, monospace; color: #101110; background: var(--signal); padding: 2px 5px; border-radius: 2px; transform: translate(-50%, 6px); font-weight: bold; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.5);">
          {formatDuration(currentTimeMs)} / -{formatDuration(Math.max(0, durationMs - currentTimeMs))}
        </span>
        <span style="width: 6px; height: 6px; border-radius: 50%; background: var(--signal); transform: translateY(-4px);"></span>
      </div>
    </div>

    <!-- Overprinted titles and Controls (pointer-events none except interactive controls) -->
    <div style="position: absolute; inset: 0; pointer-events: none; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; z-index: 2;">
      <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
        <strong style="font-family: Georgia, serif; font-size: 13px; font-style: italic; font-weight: normal; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1px 4px #000;">
          {$currentPlayback.title}
        </strong>
        <small style="font-family: ui-sans-serif, system-ui, sans-serif; font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1px 4px #000;">
          {$currentPlayback.subtitle}
        </small>
      </div>

      <button 
        onclick={togglePlay}
        style="pointer-events: auto; background: rgba(16, 17, 16, 0.7); border: 1px solid var(--line); border-radius: 3px; padding: 6px 14px; color: #fff; cursor: pointer; font: 10px ui-monospace, monospace; letter-spacing: 0.08em; font-weight: bold; z-index: 10; transition: border-color 0.2s;"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? 'PAUSE' : 'PLAY'}
      </button>
    </div>
  </aside>
{/if}
