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
    return ({draft:'APPROVED PLAN',copying:'COPYING',verifying:'VERIFYING',retirement_pending:'VERIFIED · SOURCE RETAINED',retiring:'RETIRING SOURCE',succeeded:'MOVED',failed:'RETRY APPROVED',cancelled:'CANCELLED'} as Record<string,string>)[state] ?? state.toUpperCase();
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
    <button onclick={()=>load()}>REFRESH</button>
  </header>

  <section class="protocol">
    <strong>STRICT MOVE</strong><span>1 · PLAN</span><i>→</i><span>2 · COPY</span><i>→</i><span>3 · SHA-256 VERIFY</span><i>→</i><span>4 · CATALOG SWITCH</span><i>→</i><span>5 · EXPLICIT SOURCE RETIREMENT</span>
  </section>

  {#if loading}<p class="state">READING CATALOG AND STORAGE STATE…</p>{:else}
    <section class="board" aria-label="Audio collection board">
      {#each lanes as lane (lane)}
        <div class="lane" role="group" aria-label={`Collection ${lane}`} ondragover={(event)=>event.preventDefault()} ondrop={()=>moveToLane(lane)}>
          <header><strong>{lane}</strong><span>{visible.filter((card)=>card.mediaKind==='audio'&&card.collectionCode===lane).length}</span></header>
          <div class="stack">
            {#each visible.filter((card)=>card.mediaKind==='audio'&&card.collectionCode===lane) as card (card.entityId)}
              <article draggable={!card.operation||['draft','failed'].includes(card.operation.state)} ondragstart={()=>dragged=card.entityId}>
                <div class="card-title"><span>AUDIO · {card.entityType.toUpperCase()}</span><strong>{card.title}</strong>{#if card.setTitle}<small>SET · {card.setTitle}</small>{/if}</div>
                {#if card.anomalies.length}<ul>{#each card.anomalies as anomaly (anomaly)}<li>{anomaly}</li>{/each}</ul>{/if}
                <label>DESTINATION PREFIX<input bind:value={card.destinationPrefix} /></label>
                <div class="path"><span>FROM</span><code>{card.sourcePrefix}</code></div>
                <div class="facts"><span>{card.fileCount} FILES</span><span>{formatBytes(card.sizeBytes)}</span></div>
                {#if card.operation}
                  <button class="operation" onclick={()=>selected=card.operation}><strong>{stateLabel(card.operation.state)}</strong><span>{card.operation.stage} · {progress(card.operation)}%</span></button>
                  <div class="actions">
                    {#if ['draft','failed'].includes(card.operation.state)}<button onclick={()=>plan(card)}>UPDATE PLAN</button><button class="signal" onclick={()=>execute(card)}>COPY + VERIFY</button>{/if}
                    {#if card.operation.state==='retirement_pending'}<button class="danger" onclick={()=>retire(card)}>RETIRE VERIFIED SOURCES</button>{/if}
                  </div>
                {:else}<button class="signal wide" onclick={()=>plan(card)}>SAVE PLAN</button>{/if}
              </article>
            {/each}
          </div>
        </div>
      {/each}
    </section>

    <section class="video">
      <header><div><span>VIDEO</span><strong>MOVIE DESTINATIONS</strong></div><small>Full destination includes filename. Sidecar subtitles follow the film.</small></header>
      <div class="video-grid">
        {#each videos as card (card.entityId)}
          <article>
            <div class="card-title"><span>VIDEO · {card.collectionCode.toUpperCase()}</span><strong>{card.title}</strong></div>
            {#if card.anomalies.length}<ul>{#each card.anomalies as anomaly (anomaly)}<li>{anomaly}</li>{/each}</ul>{/if}
            <label>FINAL DESTINATION<input bind:value={card.destinationPrefix} /></label>
            <div class="path"><span>FROM</span><code>{card.sourcePrefix}</code></div>
            <div class="facts"><span>{card.fileCount} FILES</span><span>{formatBytes(card.sizeBytes)}</span></div>
            {#if card.operation}
              <button class="operation" onclick={()=>selected=card.operation}><strong>{stateLabel(card.operation.state)}</strong><span>{card.operation.stage} · {progress(card.operation)}%</span></button>
              <div class="actions">
                {#if ['draft','failed'].includes(card.operation.state)}<button onclick={()=>plan(card)}>UPDATE PLAN</button><button class="signal" onclick={()=>execute(card)}>COPY + VERIFY</button>{/if}
                {#if card.operation.state==='retirement_pending'}<button class="danger" onclick={()=>retire(card)}>RETIRE VERIFIED SOURCES</button>{/if}
              </div>
            {:else}<button class="signal wide" onclick={()=>plan(card)}>SAVE PLAN</button>{/if}
          </article>
        {/each}
      </div>
    </section>
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
    <button class="dock-head" onclick={()=>monitorOpen=!monitorOpen}>
      <div><span>ABY PROCESS MONITOR</span><strong>{activeOperations.length} ACTIVE · {approvedPlans.length} APPROVED · {monitorOperations.length} BATCHES</strong></div>
      <div class="aggregate-meter"><i style={`width:${aggregate.sizeBytes?Math.min(100,Math.round(aggregate.transferredBytes/aggregate.sizeBytes*100)):0}%`}></i></div>
      <div class="aggregate-facts">
        <span>{formatBytes(aggregate.transferredBytes)} / {formatBytes(aggregate.sizeBytes)}</span>
        <span>{formatBytes(aggregate.speedBytesPerSecond)}/s</span>
        <span>ELAPSED {aggregate.started?formatDuration((Date.now()-new Date(aggregate.started).getTime())/1000):'—'}</span>
        <span>LEFT {formatDuration(aggregate.etaSeconds)}</span>
      </div>
      <b>{monitorOpen?'⌄':'⌃'}</b>
    </button>
    {#if monitorOpen}
      <div class="batch-list">
        {#each monitorOperations as operation (operation.id)}
          <button class="batch-row" onclick={()=>selected=operation}>
            <div class="batch-name"><span>{operation.mediaKind.toUpperCase()}</span><strong>{operation.title}</strong><small>{stateLabel(operation.state)} · {operation.stage}</small></div>
            <div class="batch-progress"><i style={`width:${progress(operation)}%`}></i></div>
            <span>{progress(operation)}%</span>
            <span>{formatBytes(operation.speedBytesPerSecond)}/s</span>
            <span>{elapsed(operation)} ELAPSED</span>
            <span>{formatDuration(operation.etaSeconds)} LEFT</span>
          </button>
        {/each}
      </div>
    {/if}
  </aside>
{/if}

{#if message}<button class="message" onclick={()=>message=''}>{message}</button>{/if}

<style>
  main{min-height:calc(100dvh - 64px);background:#0a0b0a;color:#e7e9e2}.toolbar{position:sticky;z-index:10;top:64px;min-height:58px;padding:8px 14px;display:grid;grid-template-columns:auto minmax(200px,1fr) auto auto auto;gap:10px;align-items:center;border-bottom:1px solid var(--line);background:#0e100eee;backdrop-filter:blur(14px)}.toolbar>div{display:grid;gap:3px}.toolbar span,.toolbar label{color:var(--muted);font:8px ui-monospace,monospace}.toolbar strong{font:9px ui-monospace,monospace;color:var(--signal)}.toolbar input[type=search],.toolbar button{height:34px;border:1px solid #33362f;background:#171916;color:#e7e9e2;font:9px ui-monospace,monospace}.toolbar input[type=search]{padding:0 10px}.toolbar label{display:flex;gap:7px;align-items:center}.toolbar .bulk{border-color:var(--signal);color:var(--signal)}.toolbar button:disabled{opacity:.4}.protocol{min-height:44px;padding:0 16px;display:flex;gap:12px;align-items:center;border-bottom:1px solid var(--line);font:8px ui-monospace,monospace;color:var(--muted)}.protocol strong{color:var(--signal)}.protocol i{font-style:normal}.board{padding:14px;display:flex;gap:10px;align-items:flex-start;overflow:auto;border-bottom:1px solid var(--line)}.lane{width:310px;min-width:310px;max-height:68dvh;display:grid;grid-template-rows:auto minmax(0,1fr);background:#101210;border:1px solid #292c27}.lane>header,.video>header{padding:11px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);font:9px ui-monospace,monospace}.lane>header span{color:var(--signal)}.stack{padding:6px;display:grid;gap:6px;overflow:auto}article{min-width:0;padding:11px;background:#171916;border:1px solid #292c27}.card-title{display:grid;gap:4px}.card-title span{color:var(--signal);font:7px ui-monospace,monospace}.card-title strong{font:14px Georgia,serif;font-weight:400}.card-title small{color:var(--muted);font:8px ui-monospace,monospace}ul{margin:9px 0;padding:7px 8px 7px 24px;background:#221d15;color:#e5bd6b;font:8px/1.5 ui-monospace,monospace}article label{margin-top:10px;display:grid;gap:4px;color:var(--muted);font:7px ui-monospace,monospace}article input{width:100%;height:32px;box-sizing:border-box;padding:0 7px;border:1px solid #343730;background:#0e100e;color:#fff;font:8px ui-monospace,monospace}.path{margin-top:8px;display:grid;gap:3px}.path span{color:var(--muted);font:7px ui-monospace,monospace}code{overflow-wrap:anywhere;color:#c4c8bf;font:8px/1.45 ui-monospace,monospace}.facts{margin:10px 0;display:flex;justify-content:space-between;color:var(--muted);font:8px ui-monospace,monospace}.operation{width:100%;padding:8px;display:grid;gap:4px;text-align:left;border:1px solid #33362f;background:#111310;color:#fff}.operation strong{color:var(--signal);font:8px ui-monospace,monospace}.operation span{color:var(--muted);font:7px ui-monospace,monospace}.actions{margin-top:6px;display:flex;gap:5px}.actions button,.wide{min-height:31px;flex:1;padding:5px 7px;border:1px solid #343730;background:#101210;color:#ddd;font:7px ui-monospace,monospace}.signal{border-color:var(--signal)!important;color:var(--signal)!important}.danger{border-color:#8d453b!important;color:#e69789!important}.wide{width:100%}.video{padding:18px 14px 300px}.video>header{padding-inline:0}.video>header>div{display:grid;gap:3px}.video>header span{color:var(--signal);font:8px ui-monospace,monospace}.video>header small{color:var(--muted);font:8px ui-monospace,monospace}.video-grid{padding-top:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:7px}.state{padding:30px;font:9px ui-monospace,monospace;color:var(--muted)}.modal{position:fixed;z-index:100;inset:0;padding:4dvh 4vw;display:grid;place-items:center;background:#000b}.dialog{width:min(1000px,92vw);max-height:90dvh;display:grid;grid-template-rows:auto auto auto minmax(0,1fr);overflow:hidden;border:1px solid #3a3e36;background:#101210}.modal header{padding:12px 14px;display:flex;justify-content:space-between;border-bottom:1px solid var(--line)}.modal header>div{display:grid;gap:4px}.modal header span{color:var(--muted);font:8px ui-monospace,monospace}.modal header strong{color:var(--signal);font:10px ui-monospace,monospace}.modal header button{border:0;background:transparent;color:#fff;font-size:22px}.meter{height:5px;background:#252821}.meter i{height:100%;display:block;background:var(--signal)}.monitor-facts{padding:8px 14px;display:flex;gap:20px;border-bottom:1px solid var(--line);font:8px ui-monospace,monospace;color:var(--muted)}.files{padding:8px;display:grid;gap:5px;overflow:auto}.files article{display:grid;grid-template-columns:90px minmax(0,1fr) 20px minmax(0,1fr);gap:7px;align-items:center}.files strong{color:var(--signal);font:7px ui-monospace,monospace}.files i{text-align:center;font-style:normal}.files small{grid-column:2/-1;color:#e69789}.error{margin:0;padding:9px 14px;background:#2a1715;color:#e69789;font:8px ui-monospace,monospace}.process-dock{position:fixed;z-index:80;left:0;right:0;bottom:0;max-height:min(42dvh,360px);display:grid;grid-template-rows:auto minmax(0,1fr);border-top:1px solid #3b4036;background:#0d0f0dec;box-shadow:0 -18px 42px #0008;backdrop-filter:blur(18px)}.process-dock:not(.open){display:block}.dock-head{width:100%;min-height:58px;padding:8px 14px;display:grid;grid-template-columns:minmax(190px,auto) minmax(120px,1fr) auto auto;gap:14px;align-items:center;border:0;background:transparent;color:#e7e9e2;text-align:left}.dock-head>div:first-child{display:grid;gap:4px}.dock-head span{font:8px ui-monospace,monospace;color:var(--muted)}.dock-head strong{font:9px ui-monospace,monospace;color:var(--signal)}.dock-head>b{font:16px ui-monospace,monospace;color:var(--signal)}.aggregate-meter,.batch-progress{height:5px;background:#262a23}.aggregate-meter i,.batch-progress i{display:block;height:100%;background:var(--signal)}.aggregate-facts{display:flex;gap:14px;white-space:nowrap}.aggregate-facts span{font-size:8px}.batch-list{padding:0 8px 8px;display:grid;gap:3px;overflow:auto}.batch-row{min-height:38px;padding:5px 7px;display:grid;grid-template-columns:minmax(180px,1.5fr) minmax(100px,1fr) 40px 85px 105px 85px;gap:10px;align-items:center;border:1px solid #282b26;background:#141613;color:#ccd0c6;text-align:left}.batch-name{min-width:0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 8px}.batch-name>span{grid-row:1/3;color:var(--signal);font:8px ui-monospace,monospace}.batch-name>strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11px Georgia,serif}.batch-name>small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font:7px ui-monospace,monospace}.batch-row>span{font:8px ui-monospace,monospace;color:var(--muted);white-space:nowrap}.message{position:fixed;z-index:110;left:18px;bottom:min(44dvh,375px);max-width:calc(100vw - 36px);padding:10px 14px;border:1px solid var(--signal);background:#111;color:#fff;font:9px ui-monospace,monospace}
  .process-dock:not(.open)+.message{bottom:74px}
  @media(max-width:1050px){.toolbar{grid-template-columns:1fr 1fr auto}.toolbar>div,.toolbar input[type=search]{grid-column:span 1}.toolbar label{grid-column:1}.toolbar .bulk{grid-column:2}.aggregate-facts span:nth-child(3){display:none}.batch-row{grid-template-columns:minmax(160px,1.5fr) minmax(90px,1fr) 40px 80px}.batch-row>span:nth-last-child(-n+2){display:none}}
  @media(max-width:800px){.toolbar{grid-template-columns:1fr auto}.toolbar input[type=search]{grid-column:1/-1}.toolbar label,.toolbar .bulk{grid-column:auto}.protocol{overflow:auto;white-space:nowrap}.board{max-height:none}.lane{min-width:86vw}.files article{grid-template-columns:1fr}.files i{display:none}.monitor-facts{flex-wrap:wrap}.modal{padding:0}.dialog{width:100vw;max-height:100dvh}.video-grid{grid-template-columns:1fr}.video{padding-bottom:230px}.dock-head{grid-template-columns:1fr auto}.dock-head .aggregate-meter,.aggregate-facts{grid-column:1/-1}.batch-row{grid-template-columns:minmax(150px,1fr) 70px 34px}.batch-row>span:nth-last-child(-n+3){display:none}.message{bottom:230px}}
</style>
