<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import {
    advancePlayback,
    currentPlayback,
    currentPlaybackTimeMs,
    playbackMode,
    type PlaybackMode
  } from '$lib/player';
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

  function selectPlaybackMode(mode: PlaybackMode) {
    playbackMode.set(mode);
    localStorage.setItem('aby.playback-mode', mode);
  }

  async function handleEnded() {
    if (!audio) return;
    if ($playbackMode === 'loop-track') {
      seekToSegmentStart();
      await audio.play().catch(() => {});
      return;
    }
    isPlaying = false;
    const advanced = await advancePlayback().catch(() => false);
    if (advanced) {
      await tick();
      await audio.play().catch(() => {});
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

  function handleProgressPointerCancel(event: PointerEvent) {
    if (!isDragging || !progressBarElement) return;
    try { progressBarElement.releasePointerCapture(event.pointerId); } catch { /* pointer already released */ }
    isDragging = false;
  }

  function updateSeek(event: PointerEvent) {
    if (!audio || !progressBarElement || durationMs === 0) return;
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
    audio.currentTime = currentTimeMs / 1000;
  }

  onMount(() => {
    const storedMode = localStorage.getItem('aby.playback-mode');
    if (storedMode === 'continuous' || storedMode === 'loop-track' || storedMode === 'random') {
      playbackMode.set(storedMode);
    }
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
      onended={handleEnded}
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
      onpointercancel={handleProgressPointerCancel}
      role="slider"
      aria-label="Playback progress slider"
      aria-valuemin="0"
      aria-valuemax={durationMs}
      aria-valuenow={currentTimeMs}
      tabindex="0"
      style="position: absolute; inset: 0; cursor: ew-resize; display: flex; align-items: center; z-index: 1; touch-action: none;"
    >
      <!-- Progress Fill -->
      <div style="position: absolute; left: 0; top: 0; bottom: 0; width: {progressPercent}%; background: rgba(198, 255, 82, 0.16); pointer-events: none;"></div>
      
      <!-- Full Height Cursor Line -->
      <div style="position: absolute; left: {progressPercent}%; top: 0; bottom: 0; width: 2px; background: var(--signal); pointer-events: none; z-index: 5; box-shadow: 0 0 10px var(--signal);"></div>
    </div>

    <!-- Overprinted titles and Controls (pointer-events none except interactive controls) -->
    <div style="position: absolute; inset: 0; pointer-events: none; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; z-index: 2;">
      <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1;">
        <strong style="font-family: Georgia, serif; font-size: 13px; font-style: italic; font-weight: normal; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1px 4px #000;">
          {$currentPlayback.title}
        </strong>
        <small style="font-family: ui-sans-serif, system-ui, sans-serif; font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1px 4px #000;">
          {$currentPlayback.subtitle}
        </small>
      </div>

      <div style="display: flex; align-items: center; gap: 24px; pointer-events: auto;">
        <div class="playback-modes" role="toolbar" aria-label="Playback mode">
          <button class:active={$playbackMode === 'continuous'} onclick={() => selectPlaybackMode('continuous')} title="Continuous album" aria-label="Continuous album">≡→</button>
          <button class:active={$playbackMode === 'loop-track'} onclick={() => selectPlaybackMode('loop-track')} title="Loop track" aria-label="Loop track">↻1</button>
          <button class:active={$playbackMode === 'random'} onclick={() => selectPlaybackMode('random')} title="Random catalog" aria-label="Random catalog">⤨</button>
        </div>
        <button 
          onclick={togglePlay}
          style="background: rgba(16, 17, 16, 0.7); border: 1px solid var(--line); border-radius: 3px; padding: 6px 14px; color: #fff; cursor: pointer; font: 10px ui-monospace, monospace; letter-spacing: 0.08em; font-weight: bold; z-index: 10; transition: border-color 0.2s;"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? 'PAUSE' : 'PLAY'}
        </button>

        <span class="player-time-display">
          {formatDuration(currentTimeMs)} / -{formatDuration(Math.max(0, durationMs - currentTimeMs))}
        </span>
      </div>
    </div>
  </aside>
{/if}

<style>
  .player-time-display {
    font-family: ui-monospace, monospace;
    font-size: 1.1rem;
    line-height: 1;
    color: var(--signal);
    font-weight: 300;
    letter-spacing: -0.05em;
    padding-left: 12px;
  }

  .playback-modes {
    display: flex;
    gap: 2px;
  }

  .playback-modes button {
    width: 30px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    background: rgba(16, 17, 16, 0.7);
    color: var(--muted);
    cursor: pointer;
    font: 10px ui-monospace, monospace;
  }

  .playback-modes button.active {
    border-color: var(--signal);
    color: var(--signal);
  }

  @media (max-width: 600px) {
    .playback-modes button {
      width: 25px;
      height: 25px;
      font-size: 9px;
    }

    .player-time-display {
      font-size: 0.6rem;
      letter-spacing: -0.02em;
      padding-left: 4px;
    }
  }
</style>
