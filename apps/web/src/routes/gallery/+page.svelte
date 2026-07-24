<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import type { CatalogItem } from '@zztt/aby-domain';
  import GalleryView from '$lib/components/GalleryView.svelte';

  let items = $state<CatalogItem[]>([]);
  let loading = $state(true);
  let message = $state('');

  onMount(async () => {
    try {
      const response = await fetch('/api/catalog');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Gallery could not be loaded');
      items = body.items;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Gallery could not be loaded';
    } finally {
      loading = false;
    }
  });

  function openItem(item: CatalogItem) {
    void goto(resolve('/player'), { state: { assetId: item.asset.id } });
  }

  async function deleteAlbum(targetItem: CatalogItem) {
    const groupKey = targetItem.albumId ?? `work:${targetItem.asset.workId}`;
    const matchingItems = items.filter(item => {
      const key = item.albumId ?? `work:${item.asset.workId}`;
      return key === groupKey;
    });

    items = items.filter(item => {
      const key = item.albumId ?? `work:${item.asset.workId}`;
      return key !== groupKey;
    });

    try {
      await Promise.all(matchingItems.map(item =>
        fetch(`/api/assets/${item.asset.id}`, { method: 'DELETE' }).then(res => {
          if (!res.ok) throw new Error(`Failed to delete asset ${item.asset.id}`);
        })
      ));
    } catch (error) {
      console.error('Delete failed:', error);
      const response = await fetch('/api/catalog');
      const body = await response.json();
      if (response.ok) items = body.items;
      message = error instanceof Error ? error.message : 'Deletion failed';
    }
  }
</script>

<svelte:head>
  <title>Aby — Gallery</title>
  <meta name="description" content="Aby album gallery." />
</svelte:head>

<main class="gallery-page">
  {#if loading}<p class="gallery-state">…</p>
  {:else if message}<p class="gallery-state failure">{message}</p>
  {:else}<GalleryView {items} onselect={openItem} ondelete={deleteAlbum} />{/if}
</main>

<style>
  .gallery-page{position:relative;width:100%;height:calc(100svh - 64px);margin:0;padding:0;overflow:hidden;background:#0b0c0b}.gallery-state{margin:0;padding:24px;color:var(--muted);font:10px ui-monospace,monospace}.failure{color:#ff8e78}
</style>
