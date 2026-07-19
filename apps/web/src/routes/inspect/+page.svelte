<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import AudioInspect from '../+page.svelte';
  import AvInspect from '$lib/components/AvInspect.svelte';

  let { data } = $props();
  const medium = $derived(page.url.searchParams.get('media') === 'av' ? 'av' : 'audio');

  function setMedium(next: 'audio' | 'av') {
    const target = resolve('/inspect') + (next === 'av' ? '?media=av' : '');
    // eslint-disable-next-line svelte/no-navigation-without-resolve
    void goto(target, { replaceState: true, keepFocus: true, noScroll: true });
  }
</script>

<div class="media-switch" aria-label="Inspection medium">
  <span>INSPECT</span>
  <div role="tablist" aria-label="Media pipeline">
    <button role="tab" aria-selected={medium === 'audio'} class:active={medium === 'audio'} onclick={() => setMedium('audio')}>AUDIO</button>
    <button role="tab" aria-selected={medium === 'av'} class:active={medium === 'av'} onclick={() => setMedium('av')}>AV / VIDEO</button>
  </div>
  <small>{medium === 'audio' ? 'ref/ → preview → canonical audio metadata' : 'mov/ → inspect → canonical film metadata'}</small>
</div>

{#if medium === 'av'}<AvInspect {data} />{:else}<AudioInspect {data} />{/if}

<style>
  .media-switch{position:sticky;z-index:20;top:64px;height:48px;padding:0 24px;display:grid;grid-template-columns:auto auto 1fr;gap:18px;align-items:center;border-bottom:1px solid var(--line);background:#0c0d0cf2;backdrop-filter:blur(16px)}
  .media-switch>span{color:var(--signal);font:10.35px ui-monospace,monospace;letter-spacing:.12em}.media-switch>small{justify-self:end;color:var(--muted);font:10.35px ui-monospace,monospace}.media-switch [role="tablist"]{display:flex;height:30px;padding:2px;background:#181a17}.media-switch button{min-width:92px;border:0;background:transparent;color:var(--muted);font:10.35px ui-monospace,monospace;letter-spacing:.08em}.media-switch button.active{background:var(--signal);color:#0c0d0c}
  @media(max-width:760px){.media-switch{top:64px;padding:0 12px;grid-template-columns:auto 1fr}.media-switch>small{display:none}.media-switch [role="tablist"]{justify-self:end}}
</style>
