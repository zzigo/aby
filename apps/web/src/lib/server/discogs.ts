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
  artists_sort?: string;
  uri?: string;
  labels?: Array<{ name?: string; catno?: string }>;
  images?: Array<{ type?: string; uri?: string; uri150?: string }>;
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

  const search = await discogsJson<{ results?: DiscogsSearchResult[] }>(fetcher, searchUrl);
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
  const label = release.labels?.[0];
  const cover = release.images?.find((image) => image.type === 'primary') ?? release.images?.[0];
  return {
    id: String(release.id),
    title: release.title || albumTitle,
    creator: release.artists_sort || creator,
    ...(release.year ? { year: String(release.year) } : selected.year ? { year: String(selected.year) } : {}),
    ...(label?.name || selected.label?.[0] ? { label: label?.name || selected.label?.[0] } : {}),
    ...(label?.catno || selected.catno ? { catalogNumber: label?.catno || selected.catno } : {}),
    ...(cover?.uri || selected.cover_image ? { coverUrl: (cover?.uri || selected.cover_image)!.replace(/^http:/, 'https:') } : {}),
    canonicalUrl: release.uri
      ? `https://www.discogs.com${release.uri}`
      : selected.uri
        ? `https://www.discogs.com${selected.uri}`
        : `https://www.discogs.com/release/${release.id}`
  };
}
