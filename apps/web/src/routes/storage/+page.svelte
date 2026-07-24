<script lang="ts">
  import { onMount } from 'svelte';

  type Operation = {
    title:string; mediaKind:'audio'|'video';
    id:string; state:string; stage:string; sizeBytes:number; transferredBytes:number;
    speedBytesPerSecond:number; etaSeconds?:number; beaconAt?:string; error?:string;
    createdAt:string; startedAt?:string; finishedAt?:string;
    files:Array<{sourceObjectKey:string;destinationObjectKey:string;state:string;sizeBytes:number;error?:string}>;
  };
  type Card = {
    mediaKind:'audio'|'video'; entityType:string; entityId:string; title:string; setTitle?:string;
    collectionCode:string; entitySlug:string; container:string; sourcePrefix:string;
    destinationPrefix:string; fileCount:number; sizeBytes:number; anomalies:string[]; operation:Operation|null;
  };

  let cards = $state<Card[]>([]);
  let operations = $state<Operation[]>([]);
  let collections = $state<string[]>([]);
  let summary = $state({total:0,anomalies:0,active:0,awaitingRetirement:0});
  let loading = $state(true);
  let message = $state('');
  let search = $state('');
  let anomaliesOnly = $state(true);
  let selected = $state<Operation|null>(null);
  let dragged = $state<string|null>(null);
  let monitorOpen = $state(true);
  let batchBusy = $state(false);
  let poll: ReturnType<typeof setInterval> | undefined;

  const visible = $derived(cards.filter((card) =>
    (!anomaliesOnly || card.anomalies.length || card.operation) &&
    `${card.title} ${card.collectionCode} ${card.entitySlug} ${card.sourcePrefix} ${card.destinationPrefix}`
      .toLowerCase().includes(search.toLowerCase())
  ));
  const lanes = $derived([...new Set([...collections, ...visible.filter((card)=>card.mediaKind==='audio').map((card)=>card.collectionCode)])]);
  const videos = $derived(visible.filter((card)=>card.mediaKind==='video'));
  const approvedPlans = $derived(operations.filter((operation)=>['draft','failed'].includes(operation.state)));
  const activeOperations = $derived(operations.filter((operation)=>['copying','verifying','retiring'].includes(operation.state)));
  const monitorOperations = $derived(operations.filter((operation)=>operation.state!=='cancelled').slice(0,10));
  const aggregate = $derived.by(()=>{
    const measured=activeOperations.length?activeOperations:monitorOperations.slice(0,1);
    const sizeBytes=measured.reduce((total,operation)=>total+operation.sizeBytes,0);
    const transferredBytes=measured.reduce((total,operation)=>total+operation.transferredBytes,0);
    const speedBytesPerSecond=activeOperations.reduce((total,operation)=>total+operation.speedBytesPerSecond,0);
    const started=activeOperations.map((operation)=>operation.startedAt).filter(Boolean).sort()[0];
    const etaSeconds=activeOperations.length?Math.max(...activeOperations.map((operation)=>operation.etaSeconds??0)):undefined;
    return {sizeBytes,transferredBytes,speedBytesPerSecond,started,etaSeconds};
  });

  function formatBytes(value:number) {
    if (!value) return '0 B';
    const units=['B','KB','MB','GB','TB']; const power=Math.min(Math.floor(Math.log(value)/Math.log(1024)),units.length-1);
    return `${(value/1024**power).toFixed(power>2?2:1)} ${units[power]}`;
  }
  function progress(operation:Operation) {
    return operation.sizeBytes ? Math.min(100,Math.round(operation.transferredBytes/operation.sizeBytes*100)) : 0;
  }
  function stateLabel(state:string) {
    return ({draft:'APPROVED PLAN',copying:'COPYING',verifying:'VERIFYING',retirement_pending:'VERIFIED · READY TO RETIRE',retiring:'RETIRING SOURCE',succeeded:'MOVED',failed:'RETRY APPROVED',cancelled:'CANCELLED'} as Record<string,string>)[state] ?? state.toUpperCase();
  }
  function formatDuration(seconds:number|undefined) {
    if (seconds===undefined || !Number.isFinite(seconds)) return '—';
    const total=Math.max(0,Math.round(seconds)); const hours=Math.floor(total/3600); const minutes=Math.floor(total%3600/60); const secs=total%60;
    return hours?`${hours}h ${String(minutes).padStart(2,'0')}m`:`${minutes}m ${String(secs).padStart(2,'0')}s`;
  }
  function elapsed(operation:Operation) {
    if (!operation.startedAt) return '—';
    const end=operation.finishedAt?new Date(operation.finishedAt).getTime():Date.now();
    return formatDuration((end-new Date(operation.startedAt).getTime())/1000);
  }
  function replaceOperation(operation:Operation) {
    operations = [operation,...operations.filter((candidate)=>candidate.id!==operation.id)];
    const card = cards.find((candidate)=>candidate.operation?.id===operation.id);
    if (card) card.operation=operation;
  }
  async function json(url:string, options?:Parameters<typeof fetch>[1]) {
    const response=await fetch(url,options); const body=await response.json();
    if (!response.ok) throw new Error(body?.error?.message??`Request failed (${response.status})`);
    return body;
  }
  async function load(silent=false) {
    try {
      const body=await json('/api/storage/board');
      cards=body.cards; operations=body.operations; collections=body.collections; summary=body.summary;
      if (selected) selected=operations.find((operation)=>operation.id===selected?.id)??selected;
    } catch(error) {
      if (!silent) message=error instanceof Error?error.message:'Storage board failed';
    } finally { loading=false; }
  }
  async function refreshAndClear() {
    message='Clearing untouched stopped plans and refreshing storage…';
    try {
      const result=await json('/api/storage/operations',{method:'DELETE'});
      selected=null; await load(true);
      message=`Refreshed. ${result.deleted} stopped plans cleared${result.preserved?`; ${result.preserved} partial failures preserved for review`:''}.`;
    } catch(error) {
      message=error instanceof Error?error.message:'Refresh failed';
    }
  }
  async function plan(card:Card) {
    message=`Planning ${card.title}…`;
    try {
      const body=await json('/api/storage/operations',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({mediaKind:card.mediaKind,entityId:card.entityId,destinationPrefix:card.destinationPrefix})
      });
      card.operation=body.operation; card.destinationPrefix=body.operation.destinationPrefix;
      replaceOperation(body.operation); selected=body.operation;
      message='Plan saved. No bytes were copied.';
    } catch(error) { message=error instanceof Error?error.message:'Plan failed'; }
  }
  async function execute(card:Card) {
    if (!card.operation) return;
    message=`Starting verified copy for ${card.title}…`;
    try {
      await json(`/api/storage/operations/${card.operation.id}/execute`,{method:'POST'});
      await load(true); message='Copy accepted. The source will remain after verification.';
    } catch(error) { message=error instanceof Error?error.message:'Copy failed'; }
  }
  async function executeApproved() {
    if (!approvedPlans.length || batchBusy) return;
    batchBusy=true; message=`Starting ${approvedPlans.length} approved copy + verify batches…`;
    try {
      const body=await json('/api/storage/operations/bulk/execute',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({operationIds:approvedPlans.map((operation)=>operation.id)})
      });
      monitorOpen=true; await load(true);
      message=`${body.accepted} approved batches started. Sources remain in place after verification.`;
    } catch(error) {
      message=error instanceof Error?error.message:'Bulk copy failed';
      await load(true);
    } finally { batchBusy=false; }
  }
  async function retire(card:Card) {
    if (!card.operation || !confirm(`Delete the verified source copies for “${card.title}”? The destination will be re-verified first.`)) return;
    message=`Re-verifying ${card.title} before source retirement…`;
    try {
      await json(`/api/storage/operations/${card.operation.id}/retire`,{method:'POST'});
      await load(true); message='Verified sources retired.';
    } catch(error) { message=error instanceof Error?error.message:'Retirement stopped'; await load(true); }
  }
  function moveToLane(collection:string) {
    if (!dragged) return;
    const card=cards.find((candidate)=>candidate.entityId===dragged);
    if (!card || card.mediaKind!=='audio' || card.operation && !['draft','failed'].includes(card.operation.state)) return;
    const parts=card.destinationPrefix.split('/');
    parts[2]=collection; card.collectionCode=collection; card.destinationPrefix=parts.join('/');
    cards=[...cards]; dragged=null; message='Collection changed locally. Save the plan to persist it.';
  }

  onMount(()=>{
    load();
    poll=setInterval(()=>{ if (operations.some((operation)=>['copying','verifying','retiring'].includes(operation.state))) load(true); },2000);
    return ()=>{ if(poll) clearInterval(poll); };
  });
</script>

<svelte:head><title>Storage · Aby</title></svelte:head>

<!-- eslint-disable svelte/no-navigation-without-resolve -->

<main>
  <header class="toolbar">
    <div><span>STORAGE SANITIZER</span><strong>{summary.anomalies} ANOMALIES · {summary.awaitingRetirement} READY TO RETIRE · {summary.active} ACTIVE</strong></div>
    <input type="search" bind:value={search} placeholder="SEARCH TITLE · PATH · ENTITY" />
    <label><input type="checkbox" bind:checked={anomaliesOnly} /> ANOMALIES / OPERATIONS ONLY</label>
    <button class="bulk" onclick={executeApproved} disabled={!approvedPlans.length||batchBusy}>COPY + VERIFY {approvedPlans.length} APPROVED</button>
    <button onclick={refreshAndClear}>REFRESH · CLEAR STOPPED</button>
  </header>

  <section class="protocol">
    <strong>STRICT MOVE</strong><span>1 · PLAN</span><i>→</i><span>2 · COPY</span><i>→</i><span>3 · SHA-256 VERIFY</span><i>→</i><span>4 · CATALOG SWITCH</span><i>→</i><span>5 · EXPLICIT SOURCE RETIREMENT</span>
  </section>

  {#if loading}<p class="state">READING CATALOG AND STORAGE STATE…</p>{:else}
    <section class="board-list" aria-label="Audio collection lists">
      {#each lanes as lane (lane)}
        {@const laneCards = visible.filter((card)=>card.mediaKind==='audio'&&card.collectionCode===lane)}
        {#if laneCards.length}
          <div class="lane-group" role="group" aria-label={`Collection ${lane}`} ondragover={(event)=>event.preventDefault()} ondrop={()=>moveToLane(lane)}>
            <header class="lane-header">
              <strong>COLLECTION {lane}</strong>
              <span class="count">{laneCards.length} ITEMS</span>
            </header>
            <div class="table-container">
              <table class="storage-table">
                <thead>
                  <tr>
                    <th style="width: 25%;">TITLE / ANOMALIES</th>
                    <th style="width: 30%;">DESTINATION PREFIX</th>
                    <th style="width: 15%;">FROM</th>
                    <th style="width: 10%;">INFO</th>
                    <th style="width: 20%;">STATUS & ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {#each laneCards as card (card.entityId)}
                    <tr 
                      draggable={!card.operation||['draft','failed'].includes(card.operation.state)} 
                      ondragstart={()=>dragged=card.entityId}
                      class:has-anomalies={card.anomalies.length > 0}
                    >
                      <td>
                        <div class="title-cell">
                          <strong>{card.title}</strong>
                          {#if card.setTitle}<small class="set-name">SET: {card.setTitle}</small>{/if}
                          {#if card.anomalies.length}
                            <div class="anomalies-list">
                              {#each card.anomalies as anomaly (anomaly)}
                                <span class="anomaly-badge">{anomaly}</span>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      </td>
                      <td>
                        <div class="dest-cell">
                          <input bind:value={card.destinationPrefix} />
                        </div>
                      </td>
                      <td>
                        <code class="path-code">{card.sourcePrefix}</code>
                      </td>
                      <td>
                        <div class="info-cell">
                          <span>{card.fileCount} files</span>
                          <span>{formatBytes(card.sizeBytes)}</span>
                        </div>
                      </td>
                      <td>
                        <div class="actions-cell">
                          {#if card.operation}
                            <button class="operation-badge" onclick={()=>selected=card.operation} class:active={['copying','verifying','retiring'].includes(card.operation.state)}>
                              <strong>{stateLabel(card.operation.state)}</strong>
                              <span>{card.operation.error??card.operation.stage} ({progress(card.operation)}%)</span>
                            </button>
                            <div class="row-actions">
                              {#if ['draft','failed'].includes(card.operation.state)}
                                <button onclick={()=>plan(card)} class="sub-btn">UPDATE</button>
                                <button class="sub-btn signal" onclick={()=>execute(card)}>COPY + VERIFY</button>
                              {/if}
                              {#if card.operation.state==='retirement_pending'}
                                <button class="sub-btn danger" onclick={()=>retire(card)}>RETIRE SOURCES</button>
                              {/if}
                            </div>
                          {:else}
                            <button class="sub-btn signal wide" onclick={()=>plan(card)}>SAVE PLAN</button>
                          {/if}
                        </div>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        {/if}
      {/each}
    </section>

    {#if videos.length}
      <section class="video-list">
        <header class="lane-header">
          <strong>VIDEO</strong>
          <span class="count">{videos.length} MOVIE DESTINATIONS</span>
        </header>
        <div class="table-container">
          <table class="storage-table">
            <thead>
              <tr>
                <th style="width: 25%;">MOVIE</th>
                <th style="width: 30%;">FINAL DESTINATION</th>
                <th style="width: 15%;">FROM</th>
                <th style="width: 10%;">INFO</th>
                <th style="width: 20%;">STATUS & ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {#each videos as card (card.entityId)}
                <tr class:has-anomalies={card.anomalies.length > 0}>
                  <td>
                    <div class="title-cell">
                      <strong>{card.title}</strong>
                      {#if card.anomalies.length}
                        <div class="anomalies-list">
                          {#each card.anomalies as anomaly (anomaly)}
                            <span class="anomaly-badge">{anomaly}</span>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  </td>
                  <td>
                    <div class="dest-cell">
                      <input bind:value={card.destinationPrefix} />
                    </div>
                  </td>
                  <td>
                    <code class="path-code">{card.sourcePrefix}</code>
                  </td>
                  <td>
                    <div class="info-cell">
                      <span>{card.fileCount} files</span>
                      <span>{formatBytes(card.sizeBytes)}</span>
                    </div>
                  </td>
                  <td>
                    <div class="actions-cell">
                      {#if card.operation}
                        <button class="operation-badge" onclick={()=>selected=card.operation} class:active={['copying','verifying','retiring'].includes(card.operation.state)}>
                          <strong>{stateLabel(card.operation.state)}</strong>
                          <span>{card.operation.error??card.operation.stage} ({progress(card.operation)}%)</span>
                        </button>
                        <div class="row-actions">
                          {#if ['draft','failed'].includes(card.operation.state)}
                            <button onclick={()=>plan(card)} class="sub-btn">UPDATE</button>
                            <button class="sub-btn signal" onclick={()=>execute(card)}>COPY + VERIFY</button>
                          {/if}
                          {#if card.operation.state==='retirement_pending'}
                            <button class="sub-btn danger" onclick={()=>retire(card)}>RETIRE SOURCES</button>
                          {/if}
                        </div>
                      {:else}
                        <button class="sub-btn signal wide" onclick={()=>plan(card)}>SAVE PLAN</button>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
  {/if}
</main>

{#if selected}
  <div class="modal" role="presentation" onclick={(event)=>{if(event.target===event.currentTarget) selected=null}}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Storage operation monitor">
      <header><div><span>PROCESS BEACON</span><strong>{stateLabel(selected.state)}</strong></div><button onclick={()=>selected=null}>×</button></header>
      <div class="meter"><i style={`width:${progress(selected)}%`}></i></div>
      <div class="monitor-facts"><span>{formatBytes(selected.transferredBytes)} / {formatBytes(selected.sizeBytes)}</span><span>{formatBytes(selected.speedBytesPerSecond)}/s</span><span>{selected.etaSeconds??'—'} s ETA</span><span>{selected.beaconAt?new Date(selected.beaconAt).toLocaleTimeString():'NO BEACON'}</span></div>
      {#if selected.error}<p class="error">{selected.error}</p>{/if}
      <div class="files">{#each selected.files as file (`${file.sourceObjectKey}:${file.destinationObjectKey}`)}<article><strong>{file.state.toUpperCase()}</strong><code>{file.sourceObjectKey}</code><i>→</i><code>{file.destinationObjectKey}</code>{#if file.error}<small>{file.error}</small>{/if}</article>{/each}</div>
    </div>
  </div>
{/if}

{#if operations.length}
  <aside class:open={monitorOpen} class="process-dock" aria-label="Storage process monitor">
    <div class="dock-head" role="button" tabindex="0" onclick={(e)=>{ if (e.target instanceof Element && e.target.closest('.clear-console-btn')) return; monitorOpen=!monitorOpen; }} onkeydown={(e)=>{ if (e.key==='Enter'||e.key===' ') { e.preventDefault(); monitorOpen=!monitorOpen; } }}>
      <div>
        <span>ABY PROCESS MONITOR</span>
        <strong>{activeOperations.length} ACTIVE · {approvedPlans.length} APPROVED · {monitorOperations.length} BATCHES</strong>
        <button class="clear-console-btn" onclick={(e)=>{e.stopPropagation(); refreshAndClear();}}>CLEAR CONSOLE</button>
      </div>
      <div class="aggregate-meter"><i style={`width:${aggregate.sizeBytes?Math.min(100,Math.round(aggregate.transferredBytes/aggregate.sizeBytes*100)):0}%`}></i></div>
      <div class="aggregate-facts">
        <span>{formatBytes(aggregate.transferredBytes)} / {formatBytes(aggregate.sizeBytes)}</span>
        <span>{formatBytes(aggregate.speedBytesPerSecond)}/s</span>
        <span>ELAPSED {aggregate.started?formatDuration((Date.now()-new Date(aggregate.started).getTime())/1000):'—'}</span>
        <span>LEFT {formatDuration(aggregate.etaSeconds)}</span>
      </div>
      <b>{monitorOpen?'⌄':'⌃'}</b>
    </div>
    {#if monitorOpen}
      <div class="batch-list">
        {#each monitorOperations as operation (operation.id)}
          <button class="batch-row" onclick={()=>selected=operation}>
            <div class="batch-name">
              <span>{operation.mediaKind.toUpperCase()}</span>
              <strong>{operation.title}</strong>
              <small>{stateLabel(operation.state)} · {operation.error??operation.stage}</small>
            </div>
            <div class="batch-progress"><i style={`width:${progress(operation)}%`}></i></div>
            <div class="batch-stats">
              <span>{progress(operation)}%</span>
              <span>{formatBytes(operation.speedBytesPerSecond)}/s</span>
              <span>{elapsed(operation)} ELAPSED</span>
              <span>{formatDuration(operation.etaSeconds)} LEFT</span>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </aside>
{/if}

{#if message}<button class="message" onclick={()=>message=''}>{message}</button>{/if}

<style>
  main {
    min-height: calc(100dvh - 64px);
    background: #0a0b0a;
    color: #e7e9e2;
    padding-bottom: 120px;
  }
  .toolbar {
    position: sticky;
    z-index: 10;
    top: 64px;
    min-height: 58px;
    padding: 8px 14px;
    display: grid;
    grid-template-columns: auto minmax(200px, 1fr) auto auto auto;
    gap: 10px;
    align-items: center;
    border-bottom: 1px solid var(--line);
    background: #0e100eee;
    backdrop-filter: blur(14px);
  }
  .toolbar>div {
    display: grid;
    gap: 3px;
  }
  .toolbar span, .toolbar label {
    color: var(--muted);
    font: 8px ui-monospace, monospace;
  }
  .toolbar strong {
    font: 9px ui-monospace, monospace;
    color: var(--signal);
  }
  .toolbar input[type=search], .toolbar button {
    height: 34px;
    border: 1px solid #33362f;
    background: #171916;
    color: #e7e9e2;
    font: 9px ui-monospace, monospace;
    padding: 0 10px;
  }
  .toolbar label {
    display: flex;
    gap: 7px;
    align-items: center;
  }
  .toolbar .bulk {
    border-color: var(--signal);
    color: var(--signal);
    cursor: pointer;
  }
  .toolbar button:disabled {
    opacity: .4;
    cursor: not-allowed;
  }
  .protocol {
    min-height: 44px;
    padding: 0 16px;
    display: flex;
    gap: 12px;
    align-items: center;
    border-bottom: 1px solid var(--line);
    font: 8px ui-monospace, monospace;
    color: var(--muted);
  }
  .protocol strong {
    color: var(--signal);
  }
  .protocol i {
    font-style: normal;
  }

  /* Redesigned Board List view */
  .board-list, .video-list {
    padding: 18px 14px;
  }
  .lane-group {
    margin-bottom: 30px;
    border: 1px solid #232620;
    background: #101210;
  }
  .lane-header {
    padding: 12px 16px;
    background: #141713;
    border-bottom: 1px solid #232620;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: ui-monospace, monospace;
  }
  .lane-header strong {
    font-size: 11px;
    color: var(--signal);
    letter-spacing: 0.08em;
  }
  .lane-header .count {
    font-size: 9px;
    color: var(--muted);
  }
  .table-container {
    overflow-x: auto;
  }
  .storage-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-family: ui-monospace, monospace;
    font-size: 10px;
  }
  .storage-table th {
    padding: 10px 16px;
    border-bottom: 1px solid #232620;
    color: var(--muted);
    font-weight: normal;
    letter-spacing: 0.05em;
  }
  .storage-table td {
    padding: 12px 16px;
    border-bottom: 1px solid #1c1e19;
    vertical-align: middle;
  }
  .storage-table tr:hover {
    background: #151714;
  }
  .storage-table tr.has-anomalies {
    border-left: 2px solid #e5bd6b;
  }

  .title-cell {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .title-cell strong {
    font-family: Georgia, serif;
    font-size: 13px;
    font-weight: normal;
    color: #f2f3ef;
  }
  .title-cell .set-name {
    font-size: 8px;
    color: var(--muted);
  }
  .anomalies-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 5px;
  }
  .anomaly-badge {
    background: #2a2012;
    color: #e5bd6b;
    border: 1px solid #4a3818;
    padding: 2px 6px;
    font-size: 8px;
    border-radius: 2px;
  }

  .dest-cell input {
    width: 100%;
    height: 28px;
    padding: 0 8px;
    background: #070807;
    border: 1px solid #2b2e27;
    color: #fff;
    font-family: ui-monospace, monospace;
    font-size: 9px;
    box-sizing: border-box;
  }
  .dest-cell input:focus {
    border-color: var(--signal);
    outline: none;
  }

  .path-code {
    font-size: 9px;
    color: #a4a89f;
    word-break: break-all;
  }

  .info-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--muted);
  }

  .actions-cell {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .operation-badge {
    width: 100%;
    padding: 6px 8px;
    text-align: left;
    background: #1b1e19;
    border: 1px solid #2a2f26;
    color: #fff;
    cursor: pointer;
    font-family: ui-monospace, monospace;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .operation-badge.active {
    border-color: var(--signal);
  }
  .operation-badge strong {
    color: var(--signal);
    font-size: 9px;
  }
  .operation-badge span {
    color: var(--muted);
    font-size: 8px;
  }

  .row-actions {
    display: flex;
    gap: 4px;
  }
  .sub-btn {
    flex: 1;
    height: 24px;
    padding: 0 6px;
    font-size: 8px;
    font-family: ui-monospace, monospace;
    background: #161814;
    border: 1px solid #2c3028;
    color: #ccc;
    cursor: pointer;
  }
  .sub-btn:hover {
    border-color: #4c5245;
    color: #fff;
  }
  .sub-btn.signal {
    border-color: var(--signal) !important;
    color: var(--signal) !important;
  }
  .sub-btn.danger {
    border-color: #8d453b !important;
    color: #e69789 !important;
  }
  .sub-btn.wide {
    width: 100%;
  }

  .video-list {
    margin-top: 10px;
    padding-bottom: 250px;
  }

  .state {
    padding: 30px;
    font: 9px ui-monospace, monospace;
    color: var(--muted);
  }

  /* Modal Dialog */
  .modal {
    position: fixed;
    z-index: 100;
    inset: 0;
    padding: 4dvh 4vw;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.75);
  }
  .dialog {
    width: min(1000px, 92vw);
    max-height: 90dvh;
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr);
    overflow: hidden;
    border: 1px solid #3a3e36;
    background: #101210;
  }
  .modal header {
    padding: 12px 14px;
    display: flex;
    justify-content: space-between;
    border-bottom: 1px solid var(--line);
  }
  .modal header>div {
    display: grid;
    gap: 4px;
  }
  .modal header span {
    color: var(--muted);
    font: 8px ui-monospace, monospace;
  }
  .modal header strong {
    color: var(--signal);
    font: 10px ui-monospace, monospace;
  }
  .modal header button {
    border: 0;
    background: transparent;
    color: #fff;
    font-size: 22px;
    cursor: pointer;
  }
  .meter {
    height: 5px;
    background: #252821;
  }
  .meter i {
    height: 100%;
    display: block;
    background: var(--signal);
  }
  .monitor-facts {
    padding: 8px 14px;
    display: flex;
    gap: 20px;
    border-bottom: 1px solid var(--line);
    font: 8px ui-monospace, monospace;
    color: var(--muted);
  }
  .files {
    padding: 8px;
    display: grid;
    gap: 5px;
    overflow: auto;
  }
  .files article {
    display: grid;
    grid-template-columns: 90px minmax(0, 1fr) 20px minmax(0, 1fr);
    gap: 7px;
    align-items: center;
    border: 1px solid #1c1e19;
    padding: 8px;
  }
  .files strong {
    color: var(--signal);
    font: 7px ui-monospace, monospace;
  }
  .files i {
    text-align: center;
    font-style: normal;
  }
  .files small {
    grid-column: 2/-1;
    color: #e69789;
  }
  .error {
    margin: 0;
    padding: 9px 14px;
    background: #2a1715;
    color: #e69789;
    font: 8px ui-monospace, monospace;
  }

  /* Premium Process Dock (Glassmorphism + Neon hints) */
  .process-dock {
    position: fixed;
    z-index: 80;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: min(45dvh, 380px);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    border-top: 1px solid var(--signal);
    background: rgba(13, 15, 13, 0.92);
    box-shadow: 0 -10px 30px rgba(198, 255, 82, 0.05);
    backdrop-filter: blur(24px) saturate(180%);
    transition: max-height 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .process-dock:not(.open) {
    display: block;
    max-height: 58px;
    overflow: hidden;
  }
  .dock-head {
    width: 100%;
    min-height: 58px;
    padding: 8px 14px;
    display: grid;
    grid-template-columns: minmax(190px, auto) minmax(120px, 1fr) auto auto;
    gap: 14px;
    align-items: center;
    border: 0;
    background: transparent;
    color: #e7e9e2;
    text-align: left;
    cursor: pointer;
  }
  .dock-head>div:first-child {
    display: grid;
    gap: 4px;
  }
  .dock-head span {
    font: 8px ui-monospace, monospace;
    color: var(--muted);
  }
  .dock-head strong {
    font: 9px ui-monospace, monospace;
    color: var(--signal);
  }
  .clear-console-btn {
    margin-top: 3px;
    width: fit-content;
    height: 18px;
    padding: 0 6px;
    border: 1px solid #ff8e78;
    background: transparent;
    color: #ff8e78;
    font: 8px ui-monospace, monospace;
    cursor: pointer;
  }
  .clear-console-btn:hover {
    background: #ff8e78;
    color: #000;
  }
  .dock-head>b {
    font: 16px ui-monospace, monospace;
    color: var(--signal);
  }
  .aggregate-meter, .batch-progress {
    height: 4px;
    background: #1d211a;
    border-radius: 2px;
    overflow: hidden;
  }
  .aggregate-meter i, .batch-progress i {
    display: block;
    height: 100%;
    background: var(--signal);
    box-shadow: 0 0 8px var(--signal);
  }
  .aggregate-facts {
    display: flex;
    gap: 14px;
    white-space: nowrap;
  }
  .aggregate-facts span {
    font-size: 8px;
    font-family: ui-monospace, monospace;
  }

  .batch-list {
    padding: 0 10px 10px;
    display: grid;
    gap: 4px;
    overflow-y: auto;
  }
  .batch-row {
    min-height: 44px;
    padding: 6px 12px;
    display: grid;
    grid-template-columns: 2fr 1fr 1.5fr;
    gap: 12px;
    align-items: center;
    border: 1px solid #1f221c;
    background: rgba(20, 22, 19, 0.6);
    color: #ccd0c6;
    text-align: left;
    cursor: pointer;
  }
  .batch-row:hover {
    border-color: var(--signal);
    background: rgba(28, 31, 26, 0.8);
  }
  .batch-name {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .batch-name>span {
    color: var(--signal);
    font: 8px ui-monospace, monospace;
    border: 1px solid rgba(198, 255, 82, 0.2);
    padding: 1px 4px;
  }
  .batch-name>strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 12px Georgia, serif;
  }
  .batch-name>small {
    color: var(--muted);
    font: 7px ui-monospace, monospace;
    margin-left: 8px;
  }
  .batch-stats {
    display: flex;
    justify-content: space-between;
    font: 8px ui-monospace, monospace;
    color: var(--muted);
  }
  .batch-stats span {
    white-space: nowrap;
  }

  .message {
    position: fixed;
    z-index: 110;
    left: 18px;
    bottom: min(47dvh, 395px);
    max-width: calc(100vw - 36px);
    padding: 10px 14px;
    border: 1px solid var(--signal);
    background: #111;
    color: #fff;
    font: 9px ui-monospace, monospace;
    cursor: pointer;
  }
  .process-dock:not(.open)+.message {
    bottom: 74px;
  }

  @media(max-width: 1050px) {
    .toolbar {
      grid-template-columns: 1fr 1fr auto;
    }
    .toolbar>div, .toolbar input[type=search] {
      grid-column: span 1;
    }
    .toolbar label {
      grid-column: 1;
    }
    .toolbar .bulk {
      grid-column: 2;
    }
    .aggregate-facts span:nth-child(3) {
      display: none;
    }
  }
  @media(max-width: 800px) {
    .toolbar {
      grid-template-columns: 1fr auto;
    }
    .toolbar input[type=search] {
      grid-column: 1/-1;
    }
    .toolbar label, .toolbar .bulk {
      grid-column: auto;
    }
    .protocol {
      overflow: auto;
      white-space: nowrap;
    }
    .files article {
      grid-template-columns: 1fr;
    }
    .files i {
      display: none;
    }
    .monitor-facts {
      flex-wrap: wrap;
    }
    .modal {
      padding: 0;
    }
    .dialog {
      width: 100vw;
      max-height: 100dvh;
    }
    .video-list {
      padding-bottom: 230px;
    }
    .dock-head {
      grid-template-columns: 1fr auto;
    }
    .dock-head .aggregate-meter, .aggregate-facts {
      grid-column: 1/-1;
    }
    .batch-row {
      grid-template-columns: 1fr;
      gap: 6px;
    }
    .batch-stats {
      display: flex;
      justify-content: flex-start;
      gap: 10px;
    }
    .message {
      bottom: 230px;
    }
  }
</style>
