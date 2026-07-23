<script lang="ts">
  import '../app.css';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import PersistentPlayer from '$lib/components/PersistentPlayer.svelte';

  let { children } = $props();
</script>

{#if !page.url.pathname.startsWith('/share/')}
  <header class="site-header">
    <a class="wordmark" href={resolve('/player')} aria-label="Aby home">Aby</a>
    <span>Temporal media intelligence</span>
    <nav aria-label="Primary navigation">
      <a class:active={page.url.pathname.startsWith('/player')} href={resolve('/player')}>Listen</a>
      <a class:active={page.url.pathname.startsWith('/view')} href={resolve('/view')}>View</a>
      <a class:active={page.url.pathname.startsWith('/gallery')} href={resolve('/gallery')}>Gallery</a>
      <a class:active={page.url.pathname.startsWith('/workspace')} href={resolve('/workspace')}>Workspace</a>
      <a class:active={page.url.pathname.startsWith('/storage')} href={resolve('/storage')}>Storage</a>
      <a class:active={page.url.pathname.startsWith('/inspect')} href={resolve('/inspect')}>Inspect</a>
    </nav>
  </header>
{/if}

{@render children()}

{#if !page.url.pathname.startsWith('/share/')}<PersistentPlayer />{/if}
