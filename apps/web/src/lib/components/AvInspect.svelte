<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import type { AvCatalogItem, AvCredit, AvMetadataCandidate, AvTreeStrategy, StorageOperation } from '@zztt/aby-domain';

  type SharedPageData = { user: { id: string; name?: string | null; email?: string | null } | null };
  type Source = { objectKey: string; mediaKind: 'mov'; workTitle: string; creatorDisplay: string };
  type Inspection = {
    id: string; sourceObjectKey: string; originalFilename: string; playbackUrl: string; probeState: 'ok' | 'partial'; inspectedAt: string;
    technicalMetadata: { sizeBytes: number; contentType?: string; durationMs?: number; videoCodec?: string; audioCodec?: string; width?: number; height?: number };
    embeddedMetadata: { title: string; originalTitle?: string; year?: number; director?: string; country?: string; languages: string[]; summary?: string; tags: Record<string,string> };
  };
  type Service = 'tmdb' | 'wikidata' | 'internet-archive';
  const services: Array<{ id: Service; label: string }> = [
    { id: 'tmdb', label: 'TMDB' }, { id: 'wikidata', label: 'WIKIDATA' }, { id: 'internet-archive', label: 'INTERNET ARCHIVE' }
  ];
  const creditRoles = ['Director','Composer','Screenplay','Cinematography','Editing','Producer','Production Design','Art Direction','Costume Design','Sound','Animation','Visual Effects','Cast','Narrator','Other'];
  let { data }: { data: SharedPageData } = $props();
  const canInspect = $derived(Boolean(data.user) || import.meta.env.DEV);
  let sources = $state<Source[]>([]);
  let sourceTotal = $state(0);
  let sourceQuery = $state('');
  let sourcesOpen = $state(false);
  let inspection = $state<Inspection | null>(null);
  let operations = $state<StorageOperation[]>([]);
  let committed = $state<AvCatalogItem | null>(null);
  let candidates = $state<Record<Service, AvMetadataCandidate[]>>({ tmdb: [], wikidata: [], 'internet-archive': [] });
  let serviceState = $state<Record<Service, string>>({ tmdb: 'READY', wikidata: 'READY', 'internet-archive': 'READY' });
  let title = $state(''); let originalTitle = $state(''); let year = $state<number | undefined>();
  let kind = $state<'film'|'episode'|'video'|'personal'|'archive'>('film');
  let director = $state(''); let entity = $state(''); let saga = $state(''); let country = $state('');
  let composer = $state(''); let countriesText = $state(''); let languagesText = $state(''); let tagsText = $state('');
  let summary = $state(''); let editionNotes = $state(''); let posterUrl = $state(''); let credits = $state<AvCredit[]>([]);
  let referenceUrl = $state('');
  let imdbId = $state(''); let tmdbId = $state(''); let wikidataId = $state(''); let internetArchiveId = $state('');
  let authorityQuery = $state<Record<Service,string>>({ tmdb:'', wikidata:'', 'internet-archive':'' });
  let subtitleProviders = $state<Array<{id:string;label:string;state:string;detail:string}>>([]);
  let metadataSources = $state<Array<{ authority: string; externalId: string; canonicalUrl: string; fetchedAt: string }>>([]);
  let treeStrategy = $state<AvTreeStrategy>('author'); let treeValue = $state('');
  let busy = $state(false); let status = $state('Choose an audiovisual source. No bytes move during inspection or commit.');
  let searchTimer: ReturnType<typeof setTimeout> | undefined; let operationTimer: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    if (canInspect) { void loadOperations(); void loadSubtitleProviders(); }
    operationTimer = setInterval(() => { if (operations.some((operation) => operation.state === 'running')) void loadOperations(); }, 2_000);
    return () => clearInterval(operationTimer);
  });

  function formatBytes(value: number) { const units=['B','KB','MB','GB','TB']; let amount=value; let unit=0; while(amount>=1000&&unit<units.length-1){amount/=1000;unit+=1;} return `${amount.toLocaleString(undefined,{maximumFractionDigits:unit?1:0})} ${units[unit]}`; }
  function formatDuration(ms?: number) { if (!ms) return '—'; const seconds=Math.floor(ms/1000); return `${Math.floor(seconds/3600)}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`; }
  function splitValues(value:string) { return [...new Set(value.split(',').map((entry)=>entry.trim()).filter(Boolean))]; }
  function operationProgress(operation: StorageOperation) { return operation.sizeBytes ? Math.min(100, operation.transferredBytes / operation.sizeBytes * 100) : 0; }

  async function jsonRequest(path: string, init?: Parameters<typeof fetch>[1]) {
    const response = await fetch(path, init); const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? 'Request failed'); return body;
  }

  async function loadSources(query = sourceQuery) {
    const params = new SvelteURLSearchParams({ mode: 'surf', media: 'mov', limit: '150' });
    if (query.trim()) params.set('q', query.trim());
    const body = await jsonRequest(`/api/ingest/sources?${params}`);
    sources = body.sources ?? []; sourceTotal = body.total ?? 0;
  }

  function queueSearch() { clearTimeout(searchTimer); searchTimer = setTimeout(() => void loadSources(), 250); }
  async function toggleSources() { sourcesOpen = !sourcesOpen; if (sourcesOpen && sources.length === 0) await loadSources(); }

  function applyInspection(next: Inspection) {
    inspection = next; committed = null;
    title = next.embeddedMetadata.title; originalTitle = next.embeddedMetadata.originalTitle ?? ''; year = next.embeddedMetadata.year;
    director = next.embeddedMetadata.director ?? ''; composer = ''; country = next.embeddedMetadata.country ?? ''; countriesText = country;
    languagesText = next.embeddedMetadata.languages.join(', '); tagsText = ''; summary = next.embeddedMetadata.summary ?? ''; editionNotes = ''; posterUrl = ''; referenceUrl = ''; credits = [];
    entity = ''; saga = ''; imdbId = ''; tmdbId = ''; wikidataId = ''; internetArchiveId = ''; metadataSources = [];
    treeStrategy = director ? 'author' : 'custom'; treeValue = director || next.embeddedMetadata.title;
    authorityQuery = { tmdb:title, wikidata:title, 'internet-archive':title };
    candidates = { tmdb: [], wikidata: [], 'internet-archive': [] };
    status = next.probeState === 'ok' ? 'Container metadata extracted. Review canonical fields and query each authority.' : 'Source identified; container probe was partial. Canonical metadata can still be completed manually or from authorities.';
  }

  async function inspectSource(source: Source) {
    busy = true; sourcesOpen = false; status = `Inspecting ${source.objectKey}…`;
    try { const body = await jsonRequest('/api/av/inspect', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({sourceObjectKey:source.objectKey}) }); applyInspection(body.inspection); await Promise.allSettled(services.map((service) => reloadService(service.id))); }
    catch (error) { status = error instanceof Error ? error.message : 'AV inspection failed'; }
    finally { busy = false; }
  }

  async function surpriseMe() {
    busy = true; status = 'Choosing one untracked video from mov/…';
    try { const body = await jsonRequest('/api/ingest/sources?mode=random&media=mov'); const source = body.sources?.[0]; if (!source) { status='No AV sources found in mov/.'; return; } await inspectSource(source); }
    catch (error) { status = error instanceof Error ? error.message : 'Surprise discovery failed'; }
    finally { busy = false; }
  }

  async function reloadService(service: Service) {
    const query = authorityQuery[service].trim() || title.trim();
    if (!query) { status = 'Enter a search query or canonical ID.'; return; }
    serviceState[service] = 'LOADING'; status = `Rechecking ${service}…`;
    try {
      const id = service === 'tmdb' ? tmdbId.trim() : service === 'wikidata' ? wikidataId.trim() : internetArchiveId.trim();
      const params = new SvelteURLSearchParams({ service });
      const validId = service === 'tmdb' ? /^\d+$/.test(id) : service === 'wikidata' ? /^Q\d+$/i.test(id) : Boolean(id && !/\s/.test(id));
      if (validId) params.set('id', id); else params.set('q', query);
      if (year) params.set('year',String(year));
      const body = await jsonRequest(`/api/av/metadata?${params}`);
      candidates[service] = body.candidates ?? []; serviceState[service] = String(Object.values(body.services ?? {})[0] ?? 'ok');
      status = candidates[service].length ? `${candidates[service].length} ${service} candidates. Canonical fields are unchanged until USE.` : `${service} returned no candidates for ${validId ? id : query}.`;
    } catch (error) { serviceState[service] = 'ERROR'; status = error instanceof Error ? error.message : `${service} failed`; }
  }

  function setCredits(next: AvCredit[]) { credits = next.map((credit) => ({...credit,externalIds:credit.externalIds??{}})); }
  function addCredit() { credits = [...credits,{name:'',role:'Other',externalIds:{}}]; }
  function removeCredit(index:number) { credits = credits.filter((_,position)=>position!==index); }
  function canonicalCredits() {
    const rows = credits.filter((credit)=>credit.name.trim()&&credit.role.trim()).map((credit)=>({...credit,name:credit.name.trim(),role:credit.role.trim()}));
    for (const [name,role] of [[director,'Director'],[composer,'Composer']] as const) if(name.trim()&&!rows.some((credit)=>credit.name.toLocaleLowerCase()===name.trim().toLocaleLowerCase()&&credit.role===role)) rows.unshift({name:name.trim(),role,externalIds:{}});
    return rows;
  }

  async function useCandidate(candidate: AvMetadataCandidate) {
    title = candidate.title; originalTitle = candidate.originalTitle ?? originalTitle; year = candidate.year ?? year;
    summary = candidate.summary ?? summary; posterUrl = candidate.posterUrl ?? posterUrl;
    tmdbId = candidate.externalIds.tmdb ?? tmdbId; wikidataId = candidate.externalIds.wikidata ?? wikidataId;
    internetArchiveId = candidate.externalIds.internetArchive ?? internetArchiveId;
    metadataSources = [...metadataSources.filter((source) => source.authority !== candidate.authority), { authority:candidate.authority, externalId:candidate.externalId, canonicalUrl:candidate.canonicalUrl, fetchedAt:new Date().toISOString() }];
    if (candidate.authority === 'tmdb') {
      tmdbId = candidate.externalId;
      const body = await jsonRequest(`/api/av/metadata?tmdbId=${encodeURIComponent(candidate.externalId)}`);
      if (body.details) { director = body.details.director || director; composer = body.details.composer || composer; countriesText = (body.details.countries ?? []).join(', ') || countriesText; country = body.details.country || country; languagesText = (body.details.languages ?? []).join(', ') || languagesText; tagsText = (body.details.tags ?? []).join(', ') || tagsText; imdbId = body.details.externalIds?.imdb ?? imdbId; wikidataId = body.details.externalIds?.wikidata ?? wikidataId; setCredits(body.details.credits ?? []); }
    }
    if (candidate.authority === 'wikidata') wikidataId = candidate.externalId;
    if (candidate.authority === 'internet-archive') internetArchiveId = candidate.externalId;
    if (treeStrategy === 'author') treeValue = director || treeValue;
    status = `${candidate.authority} candidate copied into CANONICAL METADATA. Every field remains editable.`;
  }

  function strategyValue() { if(treeStrategy==='author') return director||treeValue; if(treeStrategy==='entity') return entity||treeValue; if(treeStrategy==='saga') return saga||treeValue; if(treeStrategy==='decade') return year?`${Math.floor(year/10)*10}s`:treeValue; return treeValue; }

  async function commitToCatalog() {
    if (!inspection || !title.trim() || !strategyValue().trim()) { status='Inspect a source and complete title plus tree value.'; return; }
    busy = true; status = 'Committing canonical metadata and creating a pending storage operation. No copy is running…';
    try {
      const countries = splitValues(countriesText);
      const externalIds = Object.fromEntries(Object.entries({ imdb:imdbId, tmdb:tmdbId, wikidata:wikidataId, internetArchive:internetArchiveId }).filter(([,value]) => value.trim()));
      const body = await jsonRequest('/api/av/items', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({
        inspectionId:inspection.id, sourceObjectKey:inspection.sourceObjectKey, title:title.trim(), ...(originalTitle.trim()?{originalTitle:originalTitle.trim()}:{}), kind,
        ...(year?{year}:{}), ...(director.trim()?{director:director.trim()}:{}), ...(composer.trim()?{composer:composer.trim()}:{}), ...(entity.trim()?{entity:entity.trim()}:{}), ...(saga.trim()?{saga:saga.trim()}:{}),
        ...(countries[0]?{country:countries[0]}:{}), countries, languages:splitValues(languagesText), tags:splitValues(tagsText), ...(summary.trim()?{summary:summary.trim()}:{}),
        ...(editionNotes.trim()?{editionNotes:editionNotes.trim()}:{}), ...(posterUrl.trim()?{posterUrl:posterUrl.trim()}:{}), credits:canonicalCredits(), externalIds, metadataSources, treeStrategy, treeValue:strategyValue().trim(), destinationObjectKey:'server-proposed'
      }) });
      committed = body.item; status = 'Committed to catalog. It is now visible in VIEW; storage remains pending until EXECUTE.'; await loadOperations();
    } catch (error) { status = error instanceof Error ? error.message : 'Commit failed'; }
    finally { busy = false; }
  }

  async function loadOperations() { try { const body=await jsonRequest('/api/av/operations'); operations=body.operations??[]; } catch {/* status belongs to the active editor action */} }
  async function importReference() {
    if(!referenceUrl.trim()) return;
    busy=true; status='Importing bounded metadata from the reference page…';
    try { const body=await jsonRequest(`/api/av/reference?url=${encodeURIComponent(referenceUrl.trim())}`); posterUrl=body.posterUrl||posterUrl; editionNotes=body.editionNotes||editionNotes; metadataSources=[...metadataSources.filter((source)=>source.authority!=='dvdbeaver'),body.source]; status='DVDBeaver reference imported into editable poster and edition notes.'; }
    catch(error){status=error instanceof Error?error.message:'Reference import failed';} finally{busy=false;}
  }
  async function loadSubtitleProviders() { try { const body=await jsonRequest('/api/av/subtitle-providers'); subtitleProviders=body.providers??[]; } catch { subtitleProviders=[]; } }
  async function execute(operation: StorageOperation) { try { await jsonRequest(`/api/av/operations/${operation.id}/execute`,{method:'POST'}); status='EXECUTE accepted. The process beacon now follows rclone.'; await loadOperations(); } catch(error){ status=error instanceof Error?error.message:'Operation could not start'; } }
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->

<svelte:head><title>INSPECT AV · Aby</title><meta name="description" content="Preview-before-write audiovisual catalog adoption." /></svelte:head>

<main class="av-inspect">
  <header class="av-intro"><div><span>AV ADOPTION · PREVIEW BEFORE WRITE</span><h1>Inspect the file.<br />Commit the metadata.</h1></div><p>Selection and extraction happen here. VIEW remains a gallery-player for catalogued films. Commit never starts the copy.</p></header>
  {#if !canInspect}<section class="signin"><p>Sign in to inspect private Wasabi sources.</p><form method="POST" action="?/signIn"><button>CONTINUE WITH LOGTO</button></form></section>{:else}
    <section class="source-step">
      <header><span>01</span><h2>Choose source</h2><small>MKV · MOV · VOB · MP4 · M4V · AVI · WEBM</small></header>
      <div class="source-actions"><button class="primary" onclick={surpriseMe} disabled={busy}>SURPRISE ME · AV</button><button onclick={toggleSources} disabled={busy}>SURF mov/</button></div>
      {#if sourcesOpen}<div class="source-browser"><div><input bind:value={sourceQuery} oninput={queueSearch} placeholder="Search mov/…" /><button onclick={() => loadSources()}>↻</button></div><small>{sourceTotal} sources</small>{#each sources as source (source.objectKey)}<button onclick={() => inspectSource(source)}><strong>{source.workTitle}</strong><span>{source.objectKey}</span></button>{/each}</div>{/if}
    </section>
    <div class="status"><i class:working={busy}></i>{status}</div>

    <section class="inspect-grid">
      <article class="source-preview">
        <header><span>02</span><h2>Extracted source metadata</h2></header>
        {#if inspection}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={inspection.playbackUrl} controls preload="metadata"></video>
          <dl><div><dt>SOURCE</dt><dd>{inspection.sourceObjectKey}</dd></div><div><dt>PROBE</dt><dd>{inspection.probeState}</dd></div><div><dt>SIZE</dt><dd>{formatBytes(inspection.technicalMetadata.sizeBytes)}</dd></div><div><dt>DURATION</dt><dd>{formatDuration(inspection.technicalMetadata.durationMs)}</dd></div><div><dt>VIDEO</dt><dd>{inspection.technicalMetadata.videoCodec ?? '—'} · {inspection.technicalMetadata.width ?? '—'}×{inspection.technicalMetadata.height ?? '—'}</dd></div><div><dt>AUDIO</dt><dd>{inspection.technicalMetadata.audioCodec ?? '—'}</dd></div></dl>
          {#if Object.keys(inspection.embeddedMetadata.tags).length}<details><summary>EMBEDDED TAGS · {Object.keys(inspection.embeddedMetadata.tags).length}</summary><pre>{JSON.stringify(inspection.embeddedMetadata.tags,null,2)}</pre></details>{/if}
        {:else}<p class="empty">Choose one source. Aby uses HEAD plus bounded ffprobe against a temporary URL; it does not download the complete film into the web process.</p>{/if}
      </article>

      <article class="authority-panel">
        <header><span>03</span><h2>Metadata authorities</h2><small>Reload independently; USE writes only into the editor.</small></header>
        {#each services as service (service.id)}
          <section class="authority"><header><strong>{service.label}</strong><span>{serviceState[service.id]}</span><button onclick={() => reloadService(service.id)} disabled={!inspection || busy}>↻ RELOAD</button></header>
            <div class="authority-id">
              <label>SEARCH QUERY<input bind:value={authorityQuery[service.id]} placeholder="Title from filename or canonical editor" /></label>
              {#if service.id === 'tmdb'}<label>CANONICAL TMDB ID<input bind:value={tmdbId} placeholder="Numeric, e.g. 16093" /></label>
              {:else if service.id === 'wikidata'}<label>CANONICAL WIKIDATA ID<input bind:value={wikidataId} placeholder="Q identifier, e.g. Q669232" /></label>
              {:else}<label>CANONICAL INTERNET ARCHIVE ID<input bind:value={internetArchiveId} placeholder="Archive item identifier" /></label>{/if}
              <small>RELOAD searches text unless a valid canonical ID is present. USE fills the ID automatically.</small>
            </div>
            {#if candidates[service.id].length}<div>{#each candidates[service.id] as candidate (`${candidate.authority}:${candidate.externalId}`)}<article><span>{candidate.year ?? '—'}</span><strong>{candidate.title}</strong><p>{candidate.summary ?? ''}</p><footer><!-- eslint-disable-next-line svelte/no-navigation-without-resolve --><a href={candidate.canonicalUrl} target="_blank" rel="noreferrer">SOURCE ↗</a><button onclick={() => useCandidate(candidate)}>USE</button></footer></article>{/each}</div>{:else}<p>No candidates loaded.</p>{/if}
          </section>
        {/each}
      </article>
    </section>

    <section class="canonical-editor">
      <header><div><span>04</span><h2>Canonical metadata</h2></div><p>This editable field set is Aby’s source of truth. Authority results never overwrite it without USE.</p></header>
      {#if inspection}<div class="editor-body">
        <div class="poster-column"><label>POSTER URL<input bind:value={posterUrl} /></label><div class="poster">{#if posterUrl}<img src={posterUrl} alt="Poster preview" />{:else}<span>{title.slice(0,1)||'V'}</span>{/if}</div></div>
        <div class="fields">
          <div class="wide"><label>TITLE<input bind:value={title} /></label><label>ORIGINAL TITLE<input bind:value={originalTitle} /></label></div>
          <div class="quad"><label>KIND<select bind:value={kind}><option value="film">FILM</option><option value="episode">EPISODE</option><option value="video">VIDEO</option><option value="archive">ARCHIVE</option><option value="personal">PERSONAL</option></select></label><label>YEAR<input bind:value={year} type="number" min="1800" max="2200" /></label><label>DIRECTOR(S)<input bind:value={director} placeholder="Comma separated" /></label><label>COMPOSER(S)<input bind:value={composer} placeholder="Comma separated" /></label></div>
          <div class="wide"><label>COUNTRIES · COMMA SEPARATED<input bind:value={countriesText} /></label><label>SAGA / COLLECTION<input bind:value={saga} /></label></div>
          <div class="wide"><label>LANGUAGES · COMMA SEPARATED<input bind:value={languagesText} /></label><label>TAGS · GENRES + STYLES<input bind:value={tagsText} placeholder="science fiction, cyberpunk, anime" /></label></div><label>SUMMARY<textarea bind:value={summary} rows="6"></textarea></label>
          <div class="reference-import"><label>REFERENCE PAGE · DVDBeaver<input bind:value={referenceUrl} type="url" placeholder="http://www.dvdbeaver.com/…" /></label><button onclick={importReference} disabled={busy||!referenceUrl.trim()}>IMPORT PAGE</button></div>
          <label>EDITION / SOURCE NOTES<textarea bind:value={editionNotes} rows="5" placeholder="Disc edition, transfer, runtime variants, bitrate, codec, reference notes…"></textarea></label>
          <div class="ids"><label>IMDb ID<input bind:value={imdbId} /></label><p>TMDB, Wikidata and Internet Archive IDs are canonical fields edited directly in their authority panels above.</p></div>
          <section class="credit-editor"><header><strong>CREDITS / ROLES</strong><button onclick={addCredit}>＋ ADD</button></header>{#each credits as credit,index (index)}<div><input bind:value={credit.name} placeholder="Person / entity" aria-label={`Credit ${index+1} name`} /><select bind:value={credit.role} aria-label={`Credit ${index+1} role`}>{#each creditRoles as role (role)}<option value={role}>{role}</option>{/each}</select><input bind:value={credit.character} placeholder="Character / detail" aria-label={`Credit ${index+1} detail`} /><button onclick={()=>removeCredit(index)} aria-label={`Remove credit ${index+1}`}>−</button></div>{/each}</section>
          <div class="tree"><label>TREE<select bind:value={treeStrategy}><option value="author">AUTHOR</option><option value="decade">DECADE</option><option value="saga">SAGA / COLLECTION</option><option value="custom">CUSTOM FOLDER</option></select></label><label>FOLDER VALUE<input bind:value={treeValue} /></label></div>
          <div class="provenance">{#each metadataSources as source (`${source.authority}:${source.externalId}`)}<span>{source.authority} · {source.externalId}</span>{/each}</div>
          <button class="commit" onclick={commitToCatalog} disabled={busy || Boolean(committed)}>COMMIT TO CATALOG · METADATA ONLY</button>
          {#if committed}<a class="view-link" href={resolve('/view') + `?item=${committed.id}`}>OPEN IN VIEW ↗</a>{/if}
        </div>
      </div>{:else}<p class="empty">Canonical fields unlock after source inspection.</p>{/if}
    </section>

    <section class="subtitle-config"><header><div><span>TEXT</span><h2>Subtitle providers</h2></div><small>Embedded tracks come from the container. External providers remain explicit.</small></header><div>{#each subtitleProviders as provider (provider.id)}<article><strong>{provider.label}</strong><span class:ready={provider.state==='READY'}>{provider.state}</span><p>{provider.detail}</p></article>{/each}</div></section>

    <section class="operation-thread"><header><div><span>STORAGE</span><h2>Deferred operation thread</h2></div><small>origin · destination · state · size · progress · speed · ETA</small></header>{#if operations.length===0}<p class="empty">No AV storage operations.</p>{/if}{#each operations as operation (operation.id)}<article><div><strong>{operation.sourceObjectKey}</strong><span>→ {operation.destinationObjectKey}</span></div><div class="metrics"><span>{operation.state}</span><span>{formatBytes(operation.sizeBytes)}</span><span>{operationProgress(operation).toFixed(1)}%</span><span>{formatBytes(operation.speedBytesPerSecond)}/s</span><span>ETA {operation.etaSeconds ?? '—'}</span></div><i><b style={`width:${operationProgress(operation)}%`}></b></i><footer><small>{operation.beaconAt ? `beacon ${new Date(operation.beaconAt).toLocaleTimeString()}` : 'not started'}</small><button onclick={() => execute(operation)} disabled={operation.state==='running'||operation.state==='succeeded'}>EXECUTE</button></footer></article>{/each}</section>
  {/if}
</main>

<style>
  .av-inspect{max-width:1500px;margin:0 auto;padding:64px 0 140px}.av-intro{display:grid;grid-template-columns:1fr minmax(280px,500px);gap:40px;align-items:end;margin-bottom:54px}.av-intro span,.source-step header span,.inspect-grid>article>header span,.canonical-editor>header span,.operation-thread>header span{color:var(--signal);font:10.35px ui-monospace,monospace;letter-spacing:.12em}.av-intro h1{margin:8px 0 0;font:400 clamp(48px,8vw,108px)/.9 Georgia,serif;letter-spacing:-.055em}.av-intro p{color:var(--muted);line-height:1.6}.source-step,.source-preview,.authority-panel,.canonical-editor,.operation-thread,.signin{border:1px solid var(--line);background:var(--surface)}.source-step>header,.inspect-grid>article>header{padding:15px 18px;display:flex;align-items:baseline;gap:14px;border-bottom:1px solid var(--line)}h2{margin:0;font-size:19.55px;font-weight:500}.source-step header small,.inspect-grid header small{margin-left:auto;color:var(--muted);font:10.35px ui-monospace,monospace}.source-actions{padding:16px;display:flex;gap:8px}.source-actions button,.signin button{min-height:40px;padding:0 18px;border:1px solid var(--line);background:transparent;color:#fff;font:11.5px ui-monospace,monospace}.source-actions .primary,.signin button{border-color:var(--signal);color:var(--signal)}.source-browser{max-height:360px;margin:0 16px 16px;border:1px solid var(--line);overflow:auto}.source-browser>div{position:sticky;top:0;display:grid;grid-template-columns:1fr auto;background:#10120f}.source-browser input{padding:10px;border:0;background:#090a09;color:#fff}.source-browser>div button{border:0;background:#171916;color:var(--signal)}.source-browser>small{display:block;padding:7px 10px;color:var(--muted);font:9.2px ui-monospace,monospace}.source-browser>button{width:100%;padding:9px 10px;display:grid;gap:3px;border:0;border-top:1px solid var(--line);background:transparent;color:#fff;text-align:left}.source-browser>button strong{font-size:11.5px}.source-browser>button span{color:var(--muted);font:9.2px ui-monospace,monospace;overflow-wrap:anywhere}.inspect-grid{margin-top:18px;display:grid;grid-template-columns:minmax(0,1fr) minmax(390px,.8fr);gap:18px}.source-preview video{width:100%;max-height:440px;background:#000}.source-preview dl{margin:0;display:grid;grid-template-columns:repeat(2,1fr)}.source-preview dl div{padding:10px 13px;border-top:1px solid var(--line)}dt{color:var(--muted);font:9.2px ui-monospace,monospace}dd{margin:4px 0 0;overflow-wrap:anywhere;font:11.5px ui-monospace,monospace}.source-preview details{border-top:1px solid var(--line)}.source-preview summary{padding:12px;color:var(--signal);font:10.35px ui-monospace,monospace}.source-preview pre{max-height:240px;margin:0;padding:12px;overflow:auto;color:var(--muted);font:10.35px ui-monospace,monospace}.authority{border-top:1px solid var(--line)}.authority>header{padding:10px 12px;display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center}.authority>header strong{font:10.35px ui-monospace,monospace}.authority>header span{color:var(--muted);font:9.2px ui-monospace,monospace}.authority button{border:1px solid var(--line);background:transparent;color:var(--signal);padding:7px;font:9.2px ui-monospace,monospace}.authority>p{padding:0 12px 10px;color:var(--muted);font:10.35px ui-monospace,monospace}.authority>div{max-height:220px;overflow:auto}.authority article{padding:10px 12px;border-top:1px solid #282b26}.authority article>span{float:right;color:var(--signal);font:9.2px ui-monospace,monospace}.authority article strong{font-size:12.65px}.authority article p{max-height:34px;margin:4px 0;color:var(--muted);overflow:hidden;font-size:10.35px;line-height:1.4}.authority article footer{display:flex;justify-content:space-between;align-items:center}.authority article a{color:var(--muted);font:9.2px ui-monospace,monospace}.canonical-editor{margin-top:18px}.canonical-editor>header,.operation-thread>header{padding:18px;display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--line)}.canonical-editor>header>div,.operation-thread>header>div{display:flex;gap:14px;align-items:baseline}.canonical-editor>header p{max-width:560px;margin:0;color:var(--muted);font-size:12.65px}.editor-body{display:grid;grid-template-columns:240px 1fr}.poster-column{padding:18px;border-right:1px solid var(--line)}.poster{aspect-ratio:2/3;margin-top:12px;display:grid;place-items:center;overflow:hidden;background:#20231d;color:var(--signal);font:60px Georgia,serif}.poster img{width:100%;height:100%;object-fit:cover}.fields{padding:18px;display:grid;gap:12px}.fields label,.poster-column label{display:grid;gap:5px;color:var(--muted);font:9.2px ui-monospace,monospace}.fields input,.fields textarea,.fields select,.poster-column input{width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--line);background:#090a09;color:#fff;font:12.65px ui-monospace,monospace}.wide,.quad,.ids,.tree{display:grid;gap:10px}.wide{grid-template-columns:1fr 1fr}.quad,.ids{grid-template-columns:repeat(4,1fr)}.tree{grid-template-columns:180px 1fr}.provenance{display:flex;flex-wrap:wrap;gap:5px}.provenance span{padding:5px 7px;background:#1b1d19;color:var(--muted);font:9.2px ui-monospace,monospace}.commit{min-height:44px;border:1px solid var(--signal);background:transparent;color:var(--signal);font:11.5px ui-monospace,monospace}.commit:disabled{opacity:.35}.view-link{justify-self:start;color:var(--signal);font:11.5px ui-monospace,monospace}.operation-thread{margin-top:18px}.operation-thread>header small{color:var(--muted);font:9.2px ui-monospace,monospace}.operation-thread>article{padding:13px 18px;border-bottom:1px solid var(--line)}.operation-thread>article>div:first-child{display:grid;gap:3px}.operation-thread article strong,.operation-thread article span,.operation-thread article small{overflow-wrap:anywhere;font:10.35px ui-monospace,monospace}.operation-thread article span,.operation-thread article small{color:var(--muted)}.metrics{margin:9px 0;display:grid;grid-template-columns:repeat(5,1fr)}.operation-thread article>i{display:block;height:2px;background:#2c2f29}.operation-thread article>i b{display:block;height:100%;background:var(--signal)}.operation-thread article footer{margin-top:8px;display:flex;justify-content:space-between;align-items:center}.operation-thread article footer button{padding:7px 11px;border:1px solid var(--signal);background:transparent;color:var(--signal);font:10.35px ui-monospace,monospace}.empty{padding:24px;color:var(--muted);line-height:1.5}.status{position:sticky;z-index:9;top:120px;margin:8px 0;padding:10px 13px;display:flex;gap:9px;align-items:center;background:#111310f2;border:1px solid var(--line);font:11.5px ui-monospace,monospace}.status i{width:7px;height:7px;border-radius:50%;background:var(--signal)}.status i.working{animation:pulse .8s infinite alternate}.signin{padding:28px}.signin button{margin-top:10px}@keyframes pulse{to{opacity:.2}}
  @media(max-width:900px){.av-inspect{padding:38px 14px 120px}.av-intro,.inspect-grid{grid-template-columns:1fr}.editor-body{grid-template-columns:1fr}.poster-column{border-right:0;border-bottom:1px solid var(--line)}.poster{max-width:220px}.quad,.ids{grid-template-columns:1fr 1fr}.canonical-editor>header{display:grid;gap:8px}.source-step header small{display:none}}@media(max-width:560px){.wide,.quad,.ids,.tree{grid-template-columns:1fr}.source-actions{display:grid}.metrics{grid-template-columns:1fr 1fr}.av-intro h1{font-size:42px}}
  .authority-id{padding:0 12px 12px;border-top:1px solid #282b26}.authority-id label{margin:10px 0 5px;display:grid;gap:5px;color:var(--muted);font:9.2px ui-monospace,monospace}.authority-id input{width:100%;box-sizing:border-box;margin:0;padding:9px;border:1px solid var(--line);background:#090a09;color:#fff;font:11.5px ui-monospace,monospace}.authority-id small{color:var(--muted);font:9.2px ui-monospace,monospace}.ids{grid-template-columns:minmax(180px,320px) 1fr;align-items:end}.ids p{margin:0;padding:8px 0;color:var(--muted);font:10.35px/1.45 ui-monospace,monospace}
  .credit-editor{border:1px solid var(--line)}.credit-editor>header{padding:8px 10px;display:flex;justify-content:space-between;align-items:center;background:#111310}.credit-editor>header strong{color:var(--muted);font:9.2px ui-monospace,monospace}.credit-editor button{border:1px solid var(--line);background:transparent;color:var(--signal)}.credit-editor>div{padding:6px;display:grid;grid-template-columns:1.2fr .8fr 1fr 32px;gap:6px;border-top:1px solid var(--line)}.credit-editor>div input,.credit-editor>div select{padding:8px}.subtitle-config{margin-top:18px;background:var(--surface)}.subtitle-config>header{padding:18px;display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--line)}.subtitle-config>header>div{display:flex;gap:14px;align-items:baseline}.subtitle-config>header small{color:var(--muted);font:9.2px ui-monospace,monospace}.subtitle-config>div{display:grid;grid-template-columns:repeat(3,1fr)}.subtitle-config article{padding:14px;border-right:1px solid var(--line)}.subtitle-config article span{float:right;color:var(--muted);font:9.2px ui-monospace,monospace}.subtitle-config article span.ready{color:var(--signal)}.subtitle-config article p{margin:8px 0 0;color:var(--muted);font:10.35px/1.4 ui-monospace,monospace}@media(max-width:700px){.credit-editor>div,.subtitle-config>div{grid-template-columns:1fr}.credit-editor>div button{min-height:34px}}
  .reference-import{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}.reference-import button{min-height:36px;border:1px solid var(--signal);background:transparent;color:var(--signal);font:9.2px ui-monospace,monospace}
</style>
