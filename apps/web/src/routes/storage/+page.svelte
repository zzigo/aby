<script lang="ts">
  import { onMount } from 'svelte';

  type Operation = {
    id:string; state:string; stage:string; sizeBytes:number; transferredBytes:number;
    speedBytesPerSecond:number; etaSeconds?:number; beaconAt?:string; error?:string;
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
  let cloneUrl = $state('https://clone.zztt.org/');
  let loading = $state(true);
  let message = $state('');
  let search = $state('');
  let anomaliesOnly = $state(true);
  let selected = $state<Operation|null>(null);
  let dragged = $state<string|null>(null);
  let poll: ReturnType<typeof setInterval> | undefined;

  const visible = $derived(cards.filter((card) =>
    (!anomaliesOnly || card.anomalies.length || card.operation) &&
    `${card.title} ${card.collectionCode} ${card.entitySlug} ${card.sourcePrefix} ${card.destinationPrefix}`
      .toLowerCase().includes(search.toLowerCase())
  ));
  const lanes = $derived([...new Set([...collections, ...visible.filter((card)=>card.mediaKind==='audio').map((card)=>card.collectionCode)])]);
  const videos = $derived(visible.filter((card)=>card.mediaKind==='video'));

  function formatBytes(value:number) {
    if (!value) return '0 B';
    const units=['B','KB','MB','GB','TB']; const power=Math.min(Math.floor(Math.log(value)/Math.log(1024)),units.length-1);
    return `${(value/1024**power).toFixed(power>2?2:1)} ${units[power]}`;
  }
  function progress(operation:Operation) {
    return operation.sizeBytes ? Math.min(100,Math.round(operation.transferredBytes/operation.sizeBytes*100)) : 0;
  }
  function stateLabel(state:string) {
    return ({draft:'PLAN READY',copying:'COPYING',verifying:'VERIFYING',retirement_pending:'VERIFIED · SOURCE RETAINED',retiring:'RETIRING SOURCE',succeeded:'MOVED',failed:'STOPPED',cancelled:'CANCELLED'} as Record<string,string>)[state] ?? state.toUpperCase();
  }
  function replaceOperation(operation:Operation) {
    operations = [operation,...operations.filter((candidate)=>candidate.id!==operation.id)];
    cards = cards.map((card)=>card.entityId===operation.files[0]?.sourceObjectKey ? card : card);
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
      cards=body.cards; operations=body.operations; collections=body.collections; summary=body.summary; cloneUrl=body.cloneUrl;
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
      card.operation=body.operation; replaceOperation(body.operation); selected=body.operation;
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
      <details><summary>CLONE.ZZTT.ORG MONITOR</summary><div class="clone"><iframe src={cloneUrl} title="clone.zztt.org process monitor"></iframe><a href={cloneUrl} target="_blank" rel="noreferrer">OPEN MONITOR ↗</a></div></details>
    </div>
  </div>
{/if}

{#if message}<button class="message" onclick={()=>message=''}>{message}</button>{/if}

<style>
  main{min-height:calc(100dvh - 64px);background:#0a0b0a;color:#e7e9e2}.toolbar{position:sticky;z-index:10;top:64px;min-height:58px;padding:8px 14px;display:grid;grid-template-columns:auto minmax(240px,1fr) auto auto;gap:10px;align-items:center;border-bottom:1px solid var(--line);background:#0e100eee;backdrop-filter:blur(14px)}.toolbar>div{display:grid;gap:3px}.toolbar span,.toolbar label{color:var(--muted);font:8px ui-monospace,monospace}.toolbar strong{font:9px ui-monospace,monospace;color:var(--signal)}.toolbar input[type=search],.toolbar button{height:34px;border:1px solid #33362f;background:#171916;color:#e7e9e2;font:9px ui-monospace,monospace}.toolbar input[type=search]{padding:0 10px}.toolbar label{display:flex;gap:7px;align-items:center}.protocol{min-height:44px;padding:0 16px;display:flex;gap:12px;align-items:center;border-bottom:1px solid var(--line);font:8px ui-monospace,monospace;color:var(--muted)}.protocol strong{color:var(--signal)}.protocol i{font-style:normal}.board{padding:14px;display:flex;gap:10px;align-items:flex-start;overflow:auto;border-bottom:1px solid var(--line)}.lane{width:310px;min-width:310px;max-height:68dvh;display:grid;grid-template-rows:auto minmax(0,1fr);background:#101210;border:1px solid #292c27}.lane>header,.video>header{padding:11px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);font:9px ui-monospace,monospace}.lane>header span{color:var(--signal)}.stack{padding:6px;display:grid;gap:6px;overflow:auto}article{min-width:0;padding:11px;background:#171916;border:1px solid #292c27}.card-title{display:grid;gap:4px}.card-title span{color:var(--signal);font:7px ui-monospace,monospace}.card-title strong{font:14px Georgia,serif;font-weight:400}.card-title small{color:var(--muted);font:8px ui-monospace,monospace}ul{margin:9px 0;padding:7px 8px 7px 24px;background:#221d15;color:#e5bd6b;font:8px/1.5 ui-monospace,monospace}article label{margin-top:10px;display:grid;gap:4px;color:var(--muted);font:7px ui-monospace,monospace}article input{width:100%;height:32px;box-sizing:border-box;padding:0 7px;border:1px solid #343730;background:#0e100e;color:#fff;font:8px ui-monospace,monospace}.path{margin-top:8px;display:grid;gap:3px}.path span{color:var(--muted);font:7px ui-monospace,monospace}code{overflow-wrap:anywhere;color:#c4c8bf;font:8px/1.45 ui-monospace,monospace}.facts{margin:10px 0;display:flex;justify-content:space-between;color:var(--muted);font:8px ui-monospace,monospace}.operation{width:100%;padding:8px;display:grid;gap:4px;text-align:left;border:1px solid #33362f;background:#111310;color:#fff}.operation strong{color:var(--signal);font:8px ui-monospace,monospace}.operation span{color:var(--muted);font:7px ui-monospace,monospace}.actions{margin-top:6px;display:flex;gap:5px}.actions button,.wide{min-height:31px;flex:1;padding:5px 7px;border:1px solid #343730;background:#101210;color:#ddd;font:7px ui-monospace,monospace}.signal{border-color:var(--signal)!important;color:var(--signal)!important}.danger{border-color:#8d453b!important;color:#e69789!important}.wide{width:100%}.video{padding:18px 14px 120px}.video>header{padding-inline:0}.video>header>div{display:grid;gap:3px}.video>header span{color:var(--signal);font:8px ui-monospace,monospace}.video>header small{color:var(--muted);font:8px ui-monospace,monospace}.video-grid{padding-top:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:7px}.state{padding:30px;font:9px ui-monospace,monospace;color:var(--muted)}.modal{position:fixed;z-index:100;inset:0;padding:4dvh 4vw;display:grid;place-items:center;background:#000b}.dialog{width:min(1000px,92vw);max-height:90dvh;display:grid;grid-template-rows:auto auto auto minmax(0,1fr) auto;overflow:hidden;border:1px solid #3a3e36;background:#101210}.modal header{padding:12px 14px;display:flex;justify-content:space-between;border-bottom:1px solid var(--line)}.modal header>div{display:grid;gap:4px}.modal header span{color:var(--muted);font:8px ui-monospace,monospace}.modal header strong{color:var(--signal);font:10px ui-monospace,monospace}.modal header button{border:0;background:transparent;color:#fff;font-size:22px}.meter{height:5px;background:#252821}.meter i{height:100%;display:block;background:var(--signal)}.monitor-facts{padding:8px 14px;display:flex;gap:20px;border-bottom:1px solid var(--line);font:8px ui-monospace,monospace;color:var(--muted)}.files{padding:8px;display:grid;gap:5px;overflow:auto}.files article{display:grid;grid-template-columns:90px minmax(0,1fr) 20px minmax(0,1fr);gap:7px;align-items:center}.files strong{color:var(--signal);font:7px ui-monospace,monospace}.files i{text-align:center;font-style:normal}.files small{grid-column:2/-1;color:#e69789}.error{margin:0;padding:9px 14px;background:#2a1715;color:#e69789;font:8px ui-monospace,monospace}.modal details{border-top:1px solid var(--line)}.modal summary{padding:11px 14px;color:var(--signal);font:8px ui-monospace,monospace}.clone{height:55dvh;position:relative}.clone iframe{width:100%;height:100%;border:0;background:#fff}.clone a{position:absolute;right:8px;top:8px;padding:7px;background:#111;color:var(--signal);font:8px ui-monospace,monospace}.message{position:fixed;z-index:110;left:18px;bottom:22px;max-width:calc(100vw - 36px);padding:10px 14px;border:1px solid var(--signal);background:#111;color:#fff;font:9px ui-monospace,monospace}
  @media(max-width:800px){.toolbar{grid-template-columns:1fr auto}.toolbar input[type=search]{grid-column:1/-1}.protocol{overflow:auto;white-space:nowrap}.board{max-height:none}.lane{min-width:86vw}.files article{grid-template-columns:1fr}.files i{display:none}.monitor-facts{flex-wrap:wrap}.modal{padding:0}.dialog{width:100vw;max-height:100dvh}.video-grid{grid-template-columns:1fr}}
</style>
