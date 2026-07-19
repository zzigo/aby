import type { AvMetadataCandidate } from '@zztt/aby-domain';
import { readConfig } from './config';

const timeout = (milliseconds = 8_000) => AbortSignal.timeout(milliseconds);

async function fetchWithRetry(url:URL|string,init:RequestInit,attempts=2):Promise<Response> {
  let response=await fetch(url,init);
  for(let attempt=1;attempt<attempts&&[429,500,502,503,504].includes(response.status);attempt+=1){
    await new Promise((resolve)=>setTimeout(resolve,300*attempt));
    response=await fetch(url,{...init,signal:timeout(15_000)});
  }
  return response;
}

function tmdbCandidate(entry: Record<string, any>): AvMetadataCandidate {
  const releaseDate = typeof entry.release_date === 'string' ? entry.release_date : '';
  const tmdbId = String(entry.id);
  return {
    authority: 'tmdb', externalId: tmdbId, title: String(entry.title || entry.original_title || 'Untitled'),
    ...(entry.original_title ? { originalTitle: String(entry.original_title) } : {}),
    ...(releaseDate ? { year: Number(releaseDate.slice(0, 4)) } : {}),
    ...(entry.overview ? { summary: String(entry.overview) } : {}),
    ...(entry.poster_path ? { posterUrl: `https://image.tmdb.org/t/p/w780${String(entry.poster_path)}` } : {}),
    canonicalUrl: `https://www.themoviedb.org/movie/${tmdbId}`,
    externalIds: { tmdb: tmdbId, ...(entry.external_ids?.imdb_id ? { imdb: String(entry.external_ids.imdb_id) } : {}) },
    metadata: {
      popularity: entry.popularity, originalLanguage: entry.original_language, backdropPath: entry.backdrop_path,
      genres: (entry.genres ?? []).map((genre: Record<string, unknown>) => String(genre.name)).filter(Boolean),
      countries: (entry.production_countries ?? []).map((country: Record<string, unknown>) => String(country.iso_3166_1 || country.name)).filter(Boolean)
    }
  };
}

function configureTmdbRequest(url: URL, config: ReturnType<typeof readConfig>) {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (config.TMDB_READ_ACCESS_TOKEN) {
    headers.authorization = `Bearer ${config.TMDB_READ_ACCESS_TOKEN}`;
    return headers;
  }
  if (config.TMDB_API_KEY) url.searchParams.set('api_key', config.TMDB_API_KEY);
  return headers;
}

async function tmdbCandidates(query: string, year?: number): Promise<AvMetadataCandidate[]> {
  const config = readConfig();
  if (!config.tmdbConfigured) return [];
  const url = new URL('https://api.themoviedb.org/3/search/movie');
  url.searchParams.set('query', query);
  url.searchParams.set('include_adult', 'false');
  url.searchParams.set('language', 'en-US');
  if (year) url.searchParams.set('primary_release_year', String(year));
  const response = await fetch(url, { headers: configureTmdbRequest(url, config), signal: timeout() });
  if (!response.ok) throw new Error(`TMDB responded ${response.status}`);
  let body = await response.json() as { results?: Array<Record<string, unknown>> };
  if (!body.results?.length && year) {
    url.searchParams.delete('primary_release_year');
    const fallback = await fetch(url, { headers: configureTmdbRequest(url, config), signal: timeout() });
    if (!fallback.ok) throw new Error(`TMDB fallback responded ${fallback.status}`);
    body = await fallback.json() as typeof body;
  }
  if (!body.results?.length) {
    const correctedTitle=(await wikidataCandidates(query))[0]?.title;
    if(correctedTitle&&correctedTitle.toLocaleLowerCase()!==query.toLocaleLowerCase()) {
      url.searchParams.set('query',correctedTitle);
      url.searchParams.delete('primary_release_year');
      const corrected=await fetch(url,{headers:configureTmdbRequest(url,config),signal:timeout()});
      if(!corrected.ok) throw new Error(`TMDB corrected-title fallback responded ${corrected.status}`);
      body=await corrected.json() as typeof body;
    }
  }
  return (body.results ?? []).slice(0, 8).map(tmdbCandidate);
}

async function wikidataCandidates(query: string): Promise<AvMetadataCandidate[]> {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.search = new URLSearchParams({ action: 'wbsearchentities', search: `${query} film`, language: 'en', uselang: 'en', type: 'item', limit: '8', format: 'json', origin: '*' }).toString();
  let response = await fetch(url, { headers: { 'user-agent': 'Aby/0.1 (https://aby.zztt.org)' }, signal: timeout() });
  if (!response.ok) throw new Error(`Wikidata responded ${response.status}`);
  let body = await response.json() as { search?: Array<{ id: string; label: string; description?: string; concepturi?: string }> };
  if (!body.search?.length) {
    url.searchParams.set('search', query);
    response = await fetch(url, { headers: { 'user-agent': 'Aby/0.1 (https://aby.zztt.org)' }, signal: timeout() });
    if (!response.ok) throw new Error(`Wikidata fallback responded ${response.status}`);
    body = await response.json() as typeof body;
  }
  if (!body.search?.length) {
    const fulltext = new URL('https://www.wikidata.org/w/api.php');
    fulltext.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: `${query} film`, srnamespace: '0', srlimit: '8', format: 'json', origin: '*' }).toString();
    const fallback = await fetch(fulltext, { headers: { 'user-agent': 'Aby/0.1 (https://aby.zztt.org)' }, signal: timeout() });
    if (!fallback.ok) throw new Error(`Wikidata full-text fallback responded ${fallback.status}`);
    const fulltextBody = await fallback.json() as { query?: { search?: Array<{ title: string }> } };
    const direct = await Promise.all((fulltextBody.query?.search ?? []).filter((entry) => /^Q\d+$/.test(entry.title)).map((entry) => wikidataCandidateById(entry.title)));
    return direct.filter((candidate): candidate is AvMetadataCandidate => Boolean(candidate));
  }
  return (body.search ?? []).map((entry) => ({
    authority: 'wikidata', externalId: entry.id, title: entry.label,
    ...(entry.description ? { summary: entry.description } : {}),
    canonicalUrl: entry.concepturi || `https://www.wikidata.org/wiki/${entry.id}`,
    externalIds: { wikidata: entry.id }, metadata: {}
  }));
}

async function internetArchiveCandidates(query: string, year?: number): Promise<AvMetadataCandidate[]> {
  const url = new URL('https://archive.org/advancedsearch.php');
  const clauses = [`title:(${JSON.stringify(query)})`, 'mediatype:(movies)'];
  if (year) clauses.push(`year:${year}`);
  url.searchParams.set('q', clauses.join(' AND '));
  for (const field of ['identifier', 'title', 'year', 'description', 'creator']) url.searchParams.append('fl[]', field);
  url.searchParams.set('rows', '8');
  url.searchParams.set('page', '1');
  url.searchParams.set('output', 'json');
  const response = await fetchWithRetry(url, { headers: { 'user-agent': 'Aby/0.1 (https://aby.zztt.org)' }, signal: timeout(15_000) });
  if (!response.ok) throw new Error(`Internet Archive responded ${response.status}`);
  const body = await response.json() as { response?: { docs?: Array<Record<string, unknown>> } };
  return (body.response?.docs ?? []).map((entry) => {
    const identifier = String(entry.identifier);
    const parsedYear = Number(Array.isArray(entry.year) ? entry.year[0] : entry.year);
    const description = Array.isArray(entry.description) ? entry.description.join('\n') : entry.description;
    return {
      authority: 'internet-archive', externalId: identifier, title: String(entry.title || identifier),
      ...(Number.isInteger(parsedYear) ? { year: parsedYear } : {}),
      ...(description ? { summary: String(description).slice(0, 10_000) } : {}),
      canonicalUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
      externalIds: { internetArchive: identifier }, metadata: { creator: entry.creator }
    } satisfies AvMetadataCandidate;
  });
}

export type AvMetadataService = 'tmdb' | 'wikidata' | 'internet-archive';

async function wikidataCandidateById(id: string): Promise<AvMetadataCandidate | null> {
  if (!/^Q\d+$/i.test(id)) return null;
  const qid = id.toUpperCase();
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.search = new URLSearchParams({ action: 'wbgetentities', ids: qid, languages: 'en|fr|es', props: 'labels|descriptions|claims', format: 'json', origin: '*' }).toString();
  const response = await fetch(url, { headers: { 'user-agent': 'Aby/0.1 (https://aby.zztt.org)' }, signal: timeout() });
  if (!response.ok) throw new Error(`Wikidata entity responded ${response.status}`);
  const body = await response.json() as { entities?: Record<string, any> };
  const entity = body.entities?.[qid];
  if (!entity || entity.missing !== undefined) return null;
  const claimValue = (property: string) => entity.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
  const publication = claimValue('P577')?.time as string | undefined;
  const image = claimValue('P18') as string | undefined;
  const imdb = claimValue('P345') as string | undefined;
  const tmdb = claimValue('P4947') as string | undefined;
  return {
    authority: 'wikidata', externalId: qid, title: entity.labels?.en?.value || entity.labels?.fr?.value || entity.labels?.es?.value || qid,
    ...(publication ? { year: Number(publication.slice(1, 5)) } : {}),
    ...(entity.descriptions?.en?.value ? { summary: String(entity.descriptions.en.value) } : {}),
    ...(image ? { posterUrl: `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(image)}?width=780` } : {}),
    canonicalUrl: `https://www.wikidata.org/wiki/${qid}`,
    externalIds: { wikidata: qid, ...(imdb ? { imdb } : {}), ...(tmdb ? { tmdb: String(tmdb) } : {}) }, metadata: {}
  };
}

async function internetArchiveCandidateById(id: string): Promise<AvMetadataCandidate | null> {
  if (!id.trim()) return null;
  const identifier = id.trim();
  const response = await fetchWithRetry(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, { headers: { 'user-agent': 'Aby/0.1 (https://aby.zztt.org)' }, signal: timeout(15_000) });
  if (!response.ok) throw new Error(`Internet Archive metadata responded ${response.status}`);
  const body = await response.json() as { metadata?: Record<string, unknown> };
  const entry = body.metadata;
  if (!entry?.identifier) return null;
  const parsedYear = Number(Array.isArray(entry.year) ? entry.year[0] : entry.year);
  const description = Array.isArray(entry.description) ? entry.description.join('\n') : entry.description;
  return {
    authority: 'internet-archive', externalId: identifier, title: String(entry.title || identifier),
    ...(Number.isInteger(parsedYear) ? { year: parsedYear } : {}),
    ...(description ? { summary: String(description).slice(0, 10_000) } : {}),
    canonicalUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    externalIds: { internetArchive: identifier }, metadata: { creator: entry.creator }
  };
}

export async function lookupAvMetadataById(service: AvMetadataService, id: string) {
  if (service === 'tmdb') {
    const details = await getTmdbMovieDetails(id);
    return { candidates: details?.candidate ? [details.candidate] : [], services: { tmdb: details ? 'ok' : 'not-found' }, details };
  }
  const candidate = service === 'wikidata' ? await wikidataCandidateById(id) : await internetArchiveCandidateById(id);
  const label = service === 'internet-archive' ? 'internetArchive' : 'wikidata';
  return { candidates: candidate ? [candidate] : [], services: { [label]: candidate ? 'ok' : 'not-found' } };
}

export async function searchAvMetadata(query: string, year?: number, requested?: AvMetadataService): Promise<{ candidates: AvMetadataCandidate[]; services: Record<string, string> }> {
  const config = readConfig();
  const available = [
    { id: 'tmdb' as const, label: 'tmdb', load: () => tmdbCandidates(query, year) },
    { id: 'wikidata' as const, label: 'wikidata', load: () => wikidataCandidates(query) },
    { id: 'internet-archive' as const, label: 'internetArchive', load: () => internetArchiveCandidates(query, year) }
  ];
  const selected = requested ? available.filter((service) => service.id === requested) : available;
  const settled = await Promise.allSettled(selected.map((service) => service.load()));
  const services: Record<string, string> = {};
  const candidates: AvMetadataCandidate[] = [];
  settled.forEach((result, index) => {
    const name = selected[index]!.label;
    if (result.status === 'fulfilled') {
      candidates.push(...result.value);
      services[name] = name === 'tmdb' && !config.tmdbConfigured ? 'not-configured' : 'ok';
    } else services[name] = result.reason instanceof Error ? result.reason.message : 'unavailable';
  });
  return { candidates, services };
}

export async function getTmdbMovieDetails(id: string) {
  const config = readConfig();
  if (!config.tmdbConfigured || !/^\d+$/.test(id)) return null;
  const url = new URL(`https://api.themoviedb.org/3/movie/${encodeURIComponent(id)}`);
  url.searchParams.set('append_to_response', 'credits,external_ids');
  const response = await fetch(url, { headers: configureTmdbRequest(url, config), signal: timeout() });
  if (!response.ok) throw new Error(`TMDB details responded ${response.status}`);
  const body = await response.json() as Record<string, any>;
  const director = body.credits?.crew?.find((person: Record<string, unknown>) => person.job === 'Director');
  const composer = body.credits?.crew?.find((person: Record<string, unknown>) => ['Original Music Composer', 'Music'].includes(String(person.job)));
  const credits = [
    ...(body.credits?.crew ?? []).slice(0, 500).map((person: Record<string, unknown>) => ({
      name: String(person.name), role: String(person.job || person.department || 'Crew'), externalIds: { tmdbPerson: String(person.id) }
    })),
    ...(body.credits?.cast ?? []).slice(0, 500).map((person: Record<string, unknown>) => ({
      name: String(person.name), role: 'Cast', ...(person.character ? { character: String(person.character) } : {}), externalIds: { tmdbPerson: String(person.id) }
    }))
  ];
  return {
    candidate: tmdbCandidate(body),
    director: director?.name ? String(director.name) : '', composer: composer?.name ? String(composer.name) : '', credits,
    country: body.production_countries?.[0]?.iso_3166_1 ? String(body.production_countries[0].iso_3166_1) : '',
    countries: (body.production_countries ?? []).map((country: Record<string, unknown>) => String(country.iso_3166_1 || country.name)).filter(Boolean),
    tags: (body.genres ?? []).map((genre: Record<string, unknown>) => String(genre.name)).filter(Boolean),
    languages: (body.spoken_languages ?? []).map((language: Record<string, unknown>) => String(language.iso_639_1 || language.english_name)).filter(Boolean),
    externalIds: {
      tmdb: String(body.id), ...(body.external_ids?.imdb_id ? { imdb: String(body.external_ids.imdb_id) } : {})
    }
  };
}
