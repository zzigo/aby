import { AbyError } from './errors';
import { readConfig } from './config';
import { albumArtworkLookupTitle } from './musicbrainz';

interface DiscogsSearchResult {
  id: number;
  type: string;
  title: string;
  year?: string | number;
  label?: string[];
  catno?: string;
  cover_image?: string;
  resource_url?: string;
  uri?: string;
}

interface DiscogsReleaseDocument {
  id: number;
  title: string;
  year?: number;
  released?: string;
  country?: string;
  artists_sort?: string;
  uri?: string;
  labels?: Array<{ name?: string; catno?: string; id?: number; entity_type_name?: string }>;
  companies?: Array<{ name?: string; catno?: string; id?: number; entity_type_name?: string }>;
  extraartists?: Array<{ name?: string; role?: string; tracks?: string; id?: number }>;
  genres?: string[];
  styles?: string[];
  formats?: Array<{ name?: string; qty?: string; descriptions?: string[] }>;
  tracklist?: Array<{ position?: string; title?: string; duration?: string; type_?: string }>;
  images?: Array<{ type?: string; uri?: string; uri150?: string }>;
  data_quality?: string;
}

export interface DiscogsReleaseCandidate {
  id: string;
  title: string;
  creator: string;
  year?: string;
  label?: string;
  catalogNumber?: string;
  coverUrl?: string;
  canonicalUrl: string;
  releaseDate?: string;
  country?: string;
  labels?: Array<{ name: string; catalogNumber?: string; externalId?: string; entityType?: string }>;
  companies?: Array<{ name: string; role?: string; catalogNumber?: string; externalId?: string }>;
  credits?: Array<{ name: string; role: string; tracks?: string; externalId?: string }>;
  genres?: string[];
  styles?: string[];
  formats?: Array<{ name: string; quantity?: string; descriptions?: string[] }>;
  tracklist?: Array<{ position?: string; title: string; duration?: string; type?: string }>;
  dataQuality?: string;
}

interface DiscogsOptions {
  fetcher?: typeof fetch;
}

const normalize = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function headers() {
  const config = readConfig();
  const result: Record<string, string> = {
    accept: 'application/vnd.discogs.v2.discogs+json',
    'user-agent': `Aby/0.1.0 (${config.ABY_EXTERNAL_METADATA_CONTACT})`
  };
  if (config.DISCOGS_CONSUMER_KEY && config.DISCOGS_CONSUMER_SECRET) {
    result.authorization = `Discogs key=${config.DISCOGS_CONSUMER_KEY}, secret=${config.DISCOGS_CONSUMER_SECRET}`;
  }
  return result;
}

async function discogsJson<T>(fetcher: typeof fetch, url: URL): Promise<T> {
  const response = await fetcher(url, { headers: headers() });
  if (!response.ok) {
    throw new AbyError('discogs_failed', `Discogs request failed with HTTP ${response.status}`, 502);
  }
  return response.json() as Promise<T>;
}

function releaseCandidate(
  release: DiscogsReleaseDocument,
  fallback: { creator?: string; year?: string | number; label?: string; catalogNumber?: string; coverUrl?: string } = {}
): DiscogsReleaseCandidate {
  const labels = (release.labels ?? []).flatMap((entry) => entry.name ? [{
    name: entry.name,
    ...(entry.catno ? { catalogNumber: entry.catno } : {}),
    ...(entry.id ? { externalId: String(entry.id) } : {}),
    ...(entry.entity_type_name ? { entityType: entry.entity_type_name } : {})
  }] : []);
  const companies = (release.companies ?? []).flatMap((entry) => entry.name ? [{
    name: entry.name,
    ...(entry.entity_type_name ? { role: entry.entity_type_name } : {}),
    ...(entry.catno ? { catalogNumber: entry.catno } : {}),
    ...(entry.id ? { externalId: String(entry.id) } : {})
  }] : []);
  const credits = (release.extraartists ?? []).flatMap((entry) => entry.name && entry.role ? [{
    name: entry.name,
    role: entry.role,
    ...(entry.tracks ? { tracks: entry.tracks } : {}),
    ...(entry.id ? { externalId: String(entry.id) } : {})
  }] : []);
  const formats = (release.formats ?? []).flatMap((entry) => entry.name ? [{
    name: entry.name,
    ...(entry.qty ? { quantity: entry.qty } : {}),
    ...(entry.descriptions?.length ? { descriptions: entry.descriptions } : {})
  }] : []);
  const tracklist = (release.tracklist ?? []).flatMap((entry) => entry.title ? [{
    ...(entry.position ? { position: entry.position } : {}),
    title: entry.title,
    ...(entry.duration ? { duration: entry.duration } : {}),
    ...(entry.type_ ? { type: entry.type_ } : {})
  }] : []);
  const label = release.labels?.[0];
  const cover = release.images?.find((image) => image.type === 'primary') ?? release.images?.[0];
  const releasePath = release.uri;
  return {
    id: String(release.id),
    title: release.title,
    creator: release.artists_sort || fallback.creator || 'Unknown artist',
    ...(release.year ? { year: String(release.year) } : fallback.year ? { year: String(fallback.year) } : {}),
    ...(release.released ? { releaseDate: release.released } : {}),
    ...(release.country ? { country: release.country } : {}),
    ...(label?.name || fallback.label ? { label: label?.name || fallback.label } : {}),
    ...(label?.catno || fallback.catalogNumber ? { catalogNumber: label?.catno || fallback.catalogNumber } : {}),
    ...(cover?.uri || fallback.coverUrl ? { coverUrl: (cover?.uri || fallback.coverUrl)!.replace(/^http:/, 'https:') } : {}),
    ...(labels.length ? { labels } : {}),
    ...(companies.length ? { companies } : {}),
    ...(credits.length ? { credits } : {}),
    ...(release.genres?.length ? { genres: release.genres } : {}),
    ...(release.styles?.length ? { styles: release.styles } : {}),
    ...(formats.length ? { formats } : {}),
    ...(tracklist.length ? { tracklist } : {}),
    ...(release.data_quality ? { dataQuality: release.data_quality } : {}),
    canonicalUrl: releasePath
      ? /^https?:\/\//i.test(releasePath) ? releasePath : new URL(releasePath, 'https://www.discogs.com').toString()
      : `https://www.discogs.com/release/${release.id}`
  };
}

export async function getDiscogsRelease(
  releaseId: string,
  options: DiscogsOptions = {}
): Promise<DiscogsReleaseCandidate> {
  if (!/^\d+$/.test(releaseId)) throw new AbyError('discogs_release_invalid', 'Discogs release ID must be numeric', 400);
  const config = readConfig();
  const fetcher = options.fetcher ?? fetch;
  const releaseUrl = new URL(`${config.DISCOGS_BASE_URL.replace(/\/+$/, '')}/releases/${releaseId}`);
  const release = await discogsJson<DiscogsReleaseDocument>(fetcher, releaseUrl);
  return releaseCandidate(release);
}

export async function searchDiscogsRelease(
  input: { creator: string; albumTitle: string; year?: string },
  options: DiscogsOptions = {}
): Promise<DiscogsReleaseCandidate | null> {
  const creator = input.creator.trim();
  const albumTitle = albumArtworkLookupTitle(creator, input.albumTitle);
  if (!creator || !albumTitle) return null;

  const config = readConfig();
  const fetcher = options.fetcher ?? fetch;
  const searchUrl = new URL(`${config.DISCOGS_BASE_URL.replace(/\/+$/, '')}/database/search`);
  searchUrl.searchParams.set('artist', creator);
  searchUrl.searchParams.set('release_title', albumTitle);
  searchUrl.searchParams.set('type', 'release');
  searchUrl.searchParams.set('per_page', '25');
  const year = input.year?.match(/(?:18|19|20)\d{2}/)?.[0];
  if (year) searchUrl.searchParams.set('year', year);

  let search = await discogsJson<{ results?: DiscogsSearchResult[] }>(fetcher, searchUrl);
  if (!(search.results ?? []).some((candidate) => candidate.type === 'release')) {
    // Embedded artist tags are frequently missing or damaged. Keep the title/year
    // as the stable release query and let the user review the resulting candidate.
    searchUrl.searchParams.delete('artist');
    search = await discogsJson<{ results?: DiscogsSearchResult[] }>(fetcher, searchUrl);
  }
  const creatorKey = normalize(creator);
  const titleKey = normalize(albumTitle);
  const candidates = (search.results ?? []).filter((candidate) => candidate.type === 'release');
  const exact = candidates.find((candidate) => {
    const [candidateCreator = '', ...candidateTitle] = candidate.title.split(' - ');
    return normalize(candidateCreator).includes(creatorKey)
      && normalize(candidateTitle.join(' - ')) === titleKey;
  });
  const selected = exact ?? candidates[0];
  if (!selected) return null;

  const releaseUrl = new URL(`${config.DISCOGS_BASE_URL.replace(/\/+$/, '')}/releases/${selected.id}`);
  const release = await discogsJson<DiscogsReleaseDocument>(fetcher, releaseUrl);
  return releaseCandidate(release, {
    creator,
    year: selected.year,
    label: selected.label?.[0],
    catalogNumber: selected.catno,
    coverUrl: selected.cover_image
  });
}
