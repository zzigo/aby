<script lang="ts">
  import '../app.css';
  import { resolve } from '$app/paths';
  import PersistentPlayer from '$lib/components/PersistentPlayer.svelte';

  let { children } = $props();
</script>

<header class="site-header">
  <a class="wordmark" href={resolve('/')} aria-label="Aby home">Aby</a>
  <span>Temporal media intelligence</span>
  <nav aria-label="Primary navigation">
    <a class="active" href={resolve('/')}>Inspect</a>
    <span aria-disabled="true">Listen</span>
  </nav>
</header>

{@render children()}

<PersistentPlayer />
