<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';

  type WorkspaceRow = Record<string, any> & { id: string; type: string; media: string; title: string };
  const labels: Record<string,string> = { type:'TYPE',media:'MEDIA',title:'TITLE',work:'WORK',creator:'CREATOR',year:'YEAR',state:'STATE',source:'SOURCE',destination:'DESTINATION',sizeBytes:'SIZE',durationMs:'DURATION',tags:'TAGS',externalIds:'EXTERNAL IDS',createdAt:'CREATED',operation:'PROCESS' };
  let rows = $state<WorkspaceRow[]>([]);
  let columns = $state<string[]>([]);
  let visibleColumns = $state<string[]>([]);
  let query = $state('');
  let selectedIds = $state<string[]>([]);
  let showColumns = $state(false);
  let snapshotName = $state('');
  let snapshots = $state<Array<{ name: string; columns: string[] }>>([]);
  let bulkField = $state<'title'|'creator'|'tags'>('tags');
  let bulkValue = $state('');
  let message = $state('');
  let loading = $state(true);

  const filteredRows = $derived.by(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => Object.values(row).some((value) => JSON.stringify(value).toLocaleLowerCase().includes(needle)));
  });
  const allVisibleSelected = $derived(filteredRows.length > 0 && filteredRows.every((row) => selectedIds.includes(row.id)));

  function formatBytes(value: number) {
    if (!value) return '—'; const units=['B','KB','MB','GB','TB']; let amount=value; let unit=0;
    while(amount>=1000&&unit<units.length-1){amount/=1000;unit+=1} return `${amount.toFixed(unit?1:0)} ${units[unit]}`;
  }
  function formatDuration(value: number) { if (!value) return '—'; const seconds=Math.round(value/1000); return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`; }
  function display(row: WorkspaceRow, column: string) {
    const value = row[column];
    if (column === 'sizeBytes') return formatBytes(Number(value));
    if (column === 'durationMs') return formatDuration(Number(value));
    if (column === 'createdAt') return value ? new Date(value).toLocaleDateString() : '—';
    if (column === 'tags') return Array.isArray(value) ? value.join(' · ') : '';
    if (column === 'externalIds') return value ? Object.entries(value).map(([key,id]) => `${key}:${id}`).join(' · ') : '';
    if (column === 'operation') return value ? `${value.state} ${value.transferredBytes ? formatBytes(value.transferredBytes) : ''}` : '';
    return value === null || value === undefined || value === '' ? '—' : String(value);
  }

  async function loadWorkspace() {
    loading = true;
    try {
      const response = await fetch('/api/workspace'); const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Workspace could not be loaded');
      rows = body.rows ?? []; columns = body.columns ?? [];
      if (!visibleColumns.length) visibleColumns = columns.filter((column: string) => !['externalIds','createdAt'].includes(column));
    } catch (error) { message = error instanceof Error ? error.message : 'Workspace could not be loaded'; }
    finally { loading = false; }
  }

  onMount(() => {
    try { snapshots = JSON.parse(localStorage.getItem('aby.workspace.snapshots') ?? '[]'); } catch { snapshots = []; }
    void loadWorkspace();
  });
  function toggleColumn(column: string) { visibleColumns = visibleColumns.includes(column) ? visibleColumns.filter((value) => value !== column) : [...visibleColumns, column]; }
  function toggleRow(id: string) { selectedIds = selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]; }
  function toggleAll() {
    if (allVisibleSelected) selectedIds = selectedIds.filter((id) => !filteredRows.some((row) => row.id === id));
    else selectedIds = [...new Set([...selectedIds, ...filteredRows.map((row) => row.id)])];
  }
  function saveSnapshot() {
    const name = snapshotName.trim(); if (!name) return;
    snapshots = [{ name, columns: [...visibleColumns] }, ...snapshots.filter((snapshot) => snapshot.name !== name)].slice(0, 20);
    localStorage.setItem('aby.workspace.snapshots', JSON.stringify(snapshots)); snapshotName = ''; message = `Snapshot “${name}” saved.`;
  }
  async function applyBulk() {
    if (!selectedIds.length || !bulkValue.trim()) { message = 'Select rows and add a value.'; return; }
    const response = await fetch('/api/workspace', { method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({ids:selectedIds,field:bulkField,value:bulkValue}) });
    const body = await response.json(); if (!response.ok) { message = body.error?.message ?? 'Bulk edit failed'; return; }
    message = `${body.updated} rows updated${body.skipped ? ` · ${body.skipped} skipped` : ''}.`; bulkValue=''; await loadWorkspace();
  }
  async function execute(row: WorkspaceRow) {
    if (!row.operation?.id) return;
    const response = await fetch(`/api/av/operations/${row.operation.id}/execute`, { method:'POST' }); const body = await response.json();
    message = response.ok ? 'Operation accepted; process beacons will update here.' : body.error?.message ?? 'Operation failed to start'; await loadWorkspace();
  }
</script>

<svelte:head><title>WORKSPACE · Aby</title><meta name="description" content="Desktop data workspace for every Aby item and capture." /></svelte:head>

<main class="workspace-shell">
  <header class="workspace-head"><div><span>ABY / WORKSPACE</span><h1>Everything, inspectable.</h1></div><div class="workspace-search"><input bind:value={query} type="search" placeholder="LIVE SEARCH ACROSS ALL FIELDS" aria-label="Search workspace" /><small>{filteredRows.length} / {rows.length} rows · {selectedIds.length} selected</small></div><button onclick={() => showColumns=!showColumns}>COLUMNS {showColumns?'×':'+'}</button></header>
  <section class="workspace-tools">
    <div class="snapshots"><input bind:value={snapshotName} placeholder="Snapshot name" /><button onclick={saveSnapshot}>SAVE VIEW</button>{#each snapshots as snapshot (snapshot.name)}<button onclick={() => visibleColumns=[...snapshot.columns]}>{snapshot.name}</button>{/each}</div>
    <div class="bulk"><strong>BULK EDIT</strong><select bind:value={bulkField}><option value="tags">TAGS</option><option value="creator">CREATOR / DIRECTOR</option><option value="title">TITLE</option></select><input bind:value={bulkValue} placeholder={bulkField==='tags'?'comma, separated, tags':'New value'} /><button onclick={applyBulk}>APPLY TO {selectedIds.length}</button></div>
  </section>
  {#if showColumns}<aside class="column-picker">{#each columns as column (column)}<label><input type="checkbox" checked={visibleColumns.includes(column)} onchange={() => toggleColumn(column)} /> {labels[column] ?? column}</label>{/each}</aside>{/if}
  {#if message}<p class="workspace-message">{message}</p>{/if}
  <div class="table-wrap"><table><thead><tr><th class="select-cell"><input type="checkbox" checked={allVisibleSelected} onchange={toggleAll} aria-label="Select visible rows" /></th>{#each visibleColumns as column (column)}<th>{labels[column] ?? column}</th>{/each}<th>ACTION</th></tr></thead><tbody>{#if loading}<tr><td colspan={visibleColumns.length+2}>Loading workspace…</td></tr>{:else}{#each filteredRows as row (row.id)}<tr class:selected={selectedIds.includes(row.id)}><td class="select-cell"><input type="checkbox" checked={selectedIds.includes(row.id)} onchange={() => toggleRow(row.id)} aria-label={`Select ${row.title}`} /></td>{#each visibleColumns as column (column)}<td class:mono={['source','destination','externalIds'].includes(column)} title={display(row,column)}>{display(row,column)}</td>{/each}<td>{#if row.operation && ['pending','failed'].includes(row.operation.state)}<button class="execute" onclick={() => execute(row)}>EXECUTE</button>{:else if row.destination?.startsWith('/share/')}<a href={resolve(row.destination)} target="_blank">OPEN ↗</a>{:else}—{/if}</td></tr>{/each}{/if}</tbody></table></div>
</main>

<style>
  .workspace-shell{width:100%;min-height:calc(100svh - 64px);padding:24px 0 80px;background:#0b0c0b;overflow:hidden}.workspace-head{padding:0 24px 22px;display:grid;grid-template-columns:1fr minmax(320px,620px) auto;align-items:end;gap:24px;border-bottom:1px solid var(--line)}.workspace-head span{color:var(--signal);font:9px ui-monospace,monospace;letter-spacing:.13em}.workspace-head h1{margin:5px 0 0;font:400 34px Georgia,serif}.workspace-search{display:grid;gap:6px}.workspace-search input{height:38px;padding:0 12px;border:1px solid #42463e;background:#101110;color:#fff;font:11px ui-monospace,monospace}.workspace-search small{color:var(--muted);font:9px ui-monospace,monospace}.workspace-head>button,.workspace-tools button{height:34px;border:1px solid var(--line);background:#151714;color:#d9ddd4;font:9px ui-monospace,monospace}.workspace-tools{padding:10px 24px;display:flex;justify-content:space-between;gap:18px;border-bottom:1px solid var(--line)}.snapshots,.bulk{display:flex;align-items:center;gap:5px;overflow-x:auto}.workspace-tools input,.workspace-tools select{height:34px;box-sizing:border-box;padding:0 8px;border:1px solid var(--line);background:#0b0c0b;color:#fff;font:9px ui-monospace,monospace}.bulk strong{margin-right:5px;color:var(--signal);font:9px ui-monospace,monospace}.bulk button{border-color:var(--signal);color:var(--signal)}.column-picker{padding:12px 24px;display:flex;flex-wrap:wrap;gap:5px 18px;border-bottom:1px solid var(--line);background:#121310}.column-picker label{margin:0;color:var(--muted);font:9px ui-monospace,monospace}.workspace-message{margin:0;padding:9px 24px;border-bottom:1px solid var(--line);color:var(--signal);font:10px ui-monospace,monospace}.table-wrap{width:100%;overflow:auto;max-height:calc(100svh - 230px)}table{border-collapse:collapse;min-width:100%;font-size:11px}th{position:sticky;z-index:2;top:0;padding:9px 10px;border-right:1px solid #30332e;border-bottom:1px solid #4a4e45;background:#151714;color:#9da198;text-align:left;font:8px ui-monospace,monospace;letter-spacing:.08em}td{max-width:320px;padding:8px 10px;border-right:1px solid #242620;border-bottom:1px solid #242620;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d9ddd5}tr.selected td{background:#c6ff520c}td.mono{font:9px ui-monospace,monospace;color:#aeb2a8}.select-cell{position:sticky;z-index:3;left:0;width:34px;min-width:34px;max-width:34px;background:#111210;text-align:center}.execute{padding:6px 8px;border:1px solid var(--signal);background:transparent;color:var(--signal);font:8px ui-monospace,monospace}td a{color:var(--signal);font:9px ui-monospace,monospace}
  @media(max-width:900px){.workspace-shell::before{content:'WORKSPACE is designed for desktop.';display:block;padding:12px 18px;color:var(--signal);font:10px ui-monospace,monospace}.workspace-head{grid-template-columns:1fr;padding:0 16px 16px}.workspace-tools{padding:10px 16px;display:grid}.table-wrap{max-height:none}}
</style>
