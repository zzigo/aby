import type { AvMetadataCandidate } from '@zztt/aby-domain';
import { readConfig } from './config';

const timeout = (milliseconds = 8_000) => AbortSignal.timeout(milliseconds);

async function tmdbCandidates(query: string, year?: number): Promise<AvMetadataCandidate[]> {
  const config = readConfig();
  if (!config.TMDB_READ_ACCESS_TOKEN) return [];
  const url = new URL('https://api.themoviedb.org/3/search/movie');
  url.searchParams.set('query', query);
  url.searchParams.set('include_adult', 'false');
  url.searchParams.set('language', 'en-US');
  if (year) url.searchParams.set('primary_release_year', String(year));
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${config.TMDB_READ_ACCESS_TOKEN}`, accept: 'application/json' },
    signal: timeout()
  });
  if (!response.ok) throw new Error(`TMDB responded ${response.status}`);
  const body = await response.json() as { results?: Array<Record<string, unknown>> };
  return (body.results ?? []).slice(0, 8).map((entry) => {
    const releaseDate = typeof entry.release_date === 'string' ? entry.release_date : '';
    const tmdbId = String(entry.id);
    return {
      authority: 'tmdb', externalId: tmdbId, title: String(entry.title || entry.original_title || 'Untitled'),
      ...(entry.original_title ? { originalTitle: String(entry.original_title) } : {}),
      ...(releaseDate ? { year: Number(releaseDate.slice(0, 4)) } : {}),
      ...(entry.overview ? { summary: String(entry.overview) } : {}),
      ...(entry.poster_path ? { posterUrl: `https://image.tmdb.org/t/p/w780${String(entry.poster_path)}` } : {}),
      canonicalUrl: `https://www.themoviedb.org/movie/${tmdbId}`,
      externalIds: { tmdb: tmdbId },
      metadata: { popularity: entry.popularity, originalLanguage: entry.original_language, backdropPath: entry.backdrop_path }
    } satisfies AvMetadataCandidate;
  });
}

async function wikidataCandidates(query: string): Promise<AvMetadataCandidate[]> {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.search = new URLSearchParams({ action: 'wbsearchentities', search: `${query} film`, language: 'en', uselang: 'en', type: 'item', limit: '8', format: 'json', origin: '*' }).toString();
  const response = await fetch(url, { headers: { 'user-agent': 'Aby/0.1 (https://aby.zztt.org)' }, signal: timeout() });
  if (!response.ok) throw new Error(`Wikidata responded ${response.status}`);
  const body = await response.json() as { search?: Array<{ id: string; label: string; description?: string; concepturi?: string }> };
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
  const response = await fetch(url, { headers: { 'user-agent': 'Aby/0.1 (https://aby.zztt.org)' }, signal: timeout(15_000) });
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

export async function searchAvMetadata(query: string, year?: number): Promise<{ candidates: AvMetadataCandidate[]; services: Record<string, string> }> {
  const config = readConfig();
  const settled = await Promise.allSettled([
    tmdbCandidates(query, year), wikidataCandidates(query), internetArchiveCandidates(query, year)
  ]);
  const names = ['tmdb', 'wikidata', 'internetArchive'] as const;
  const services: Record<string, string> = {};
  const candidates: AvMetadataCandidate[] = [];
  settled.forEach((result, index) => {
    const name = names[index]!;
    if (result.status === 'fulfilled') {
      candidates.push(...result.value);
      services[name] = name === 'tmdb' && !config.tmdbConfigured ? 'not-configured' : 'ok';
    } else services[name] = result.reason instanceof Error ? result.reason.message : 'unavailable';
  });
  return { candidates, services };
}

export async function getTmdbMovieDetails(id: string) {
  const config = readConfig();
  if (!config.TMDB_READ_ACCESS_TOKEN) return null;
  const response = await fetch(`https://api.themoviedb.org/3/movie/${encodeURIComponent(id)}?append_to_response=credits,external_ids`, {
    headers: { authorization: `Bearer ${config.TMDB_READ_ACCESS_TOKEN}`, accept: 'application/json' }, signal: timeout()
  });
  if (!response.ok) throw new Error(`TMDB details responded ${response.status}`);
  const body = await response.json() as Record<string, any>;
  const director = body.credits?.crew?.find((person: Record<string, unknown>) => person.job === 'Director');
  const credits = [
    ...(body.credits?.crew ?? []).slice(0, 500).map((person: Record<string, unknown>) => ({
      name: String(person.name), role: String(person.job || person.department || 'Crew'), externalIds: { tmdbPerson: String(person.id) }
    })),
    ...(body.credits?.cast ?? []).slice(0, 500).map((person: Record<string, unknown>) => ({
      name: String(person.name), role: 'Cast', ...(person.character ? { character: String(person.character) } : {}), externalIds: { tmdbPerson: String(person.id) }
    }))
  ];
  return {
    director: director?.name ? String(director.name) : '', credits,
    country: body.production_countries?.[0]?.iso_3166_1 ? String(body.production_countries[0].iso_3166_1) : '',
    languages: (body.spoken_languages ?? []).map((language: Record<string, unknown>) => String(language.iso_639_1 || language.english_name)).filter(Boolean),
    externalIds: {
      tmdb: String(body.id), ...(body.external_ids?.imdb_id ? { imdb: String(body.external_ids.imdb_id) } : {})
    }
  };
}
