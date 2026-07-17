<script lang="ts">
  import '../app.css';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import PersistentPlayer from '$lib/components/PersistentPlayer.svelte';

  let { children } = $props();
</script>

<header class="site-header">
  <a class="wordmark" href={resolve('/')} aria-label="Aby home">Aby</a>
  <span>Temporal media intelligence</span>
  <nav aria-label="Primary navigation">
    <a class:active={page.url.pathname === '/'} href={resolve('/')}>Inspect</a>
    <a class:active={page.url.pathname.startsWith('/player')} href={resolve('/player')}>Listen</a>
  </nav>
</header>

{@render children()}

<PersistentPlayer />
