import { AbyError } from './errors';
import { readConfig } from './config';

interface MusicBrainzArtistCredit {
  name?: string;
  artist?: { id?: string; name?: string };
}

interface MusicBrainzRecording {
  id: string;
  title: string;
  length?: number;
  score?: number;
  'artist-credit'?: MusicBrainzArtistCredit[];
  releases?: Array<{ id: string; title?: string; date?: string; country?: string }>;
}

interface MusicBrainzRelease {
  id: string;
  title: string;
  date?: string;
  country?: string;
  status?: string;
  'release-group'?: { id?: string; title?: string };
  'label-info'?: Array<{ 'catalog-number'?: string; label?: { id?: string; name?: string } }>;
}

interface MusicBrainzReleaseGroup {
  id: string;
  title: string;
  score?: number;
  'artist-credit'?: MusicBrainzArtistCredit[];
}

interface CoverArtDocument {
  release?: string;
  images?: Array<{
    id: string;
    front?: boolean;
    approved?: boolean;
    thumbnails?: Record<string, string>;
    image?: string;
  }>;
}

export interface MusicBrainzIdentification {
  recordingId: string;
  recordingTitle: string;
  recordingLengthMs?: number;
  artistId?: string;
  artistName: string;
  releaseId?: string;
  releaseTitle?: string;
  releaseDate?: string;
  releaseCountry?: string;
  releaseGroupId?: string;
  label?: string;
  labelId?: string;
  catalogNumber?: string;
  score: number;
  cover?: {
    url: string;
    exactRelease: boolean;
    sourceId: string;
    sourceRelease?: string;
  };
}

interface IdentifyOptions {
  fetcher?: typeof fetch;
  musicBrainzIntervalMs?: number;
}

const normalizeName = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const quoted = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

async function jsonRequest<T>(fetcher: typeof fetch, url: URL, userAgent: string): Promise<T> {
  const response = await fetcher(url, { headers: { accept: 'application/json', 'user-agent': userAgent } });
  if (!response.ok) throw new AbyError('external_metadata_failed', `External metadata request failed with HTTP ${response.status}`, 502);
  return response.json() as Promise<T>;
}

async function optionalCoverArt(fetcher: typeof fetch, url: URL, userAgent: string): Promise<CoverArtDocument | null> {
  const response = await fetcher(url, { headers: { accept: 'application/json', 'user-agent': userAgent }, redirect: 'follow' });
  if (response.status === 404) return null;
  if (!response.ok) throw new AbyError('cover_art_failed', `Cover Art Archive request failed with HTTP ${response.status}`, 502);
  return response.json() as Promise<CoverArtDocument>;
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function searchMusicBrainzArtists(query: string, options: IdentifyOptions = {}) {
  const value = query.trim();
  if (value.length < 2) return [];
  const config = readConfig();
  const fetcher = options.fetcher ?? fetch;
  const url = new URL(`${config.MUSICBRAINZ_BASE_URL.replace(/\/+$/, '')}/artist/`);
  url.searchParams.set('query', `artist:${quoted(value)}`);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', '8');
  const result = await jsonRequest<{ artists?: Array<{ id: string; name: string; 'sort-name'?: string; disambiguation?: string; score?: number }> }>(
    fetcher, url, `Aby/0.1.0 (${config.ABY_EXTERNAL_METADATA_CONTACT})`
  );
  return (result.artists ?? []).map((artist) => ({
    id: artist.id,
    name: artist.name,
    sortName: artist['sort-name'] ?? artist.name,
    disambiguation: artist.disambiguation ?? '',
    score: (artist.score ?? 0) / 100
  }));
}

export async function findAlbumArtwork(
  input: { creator: string; albumTitle: string },
  options: IdentifyOptions = {}
): Promise<MusicBrainzIdentification['cover'] | null> {
  if (!input.creator.trim() || !input.albumTitle.trim()) return null;
  const config = readConfig();
  const fetcher = options.fetcher ?? fetch;
  const userAgent = `Aby/0.1.0 (${config.ABY_EXTERNAL_METADATA_CONTACT})`;
  const url = new URL(`${config.MUSICBRAINZ_BASE_URL.replace(/\/+$/, '')}/release-group/`);
  url.searchParams.set('query', `artist:${quoted(input.creator)} AND releasegroup:${quoted(input.albumTitle)}`);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', '10');
  const result = await jsonRequest<{ 'release-groups'?: MusicBrainzReleaseGroup[] }>(fetcher, url, userAgent);
  const creator = normalizeName(input.creator);
  const title = normalizeName(input.albumTitle);
  const candidate = (result['release-groups'] ?? []).find((group) => {
    const artist = group['artist-credit']?.map((credit) => credit.name || credit.artist?.name || '').join(' ') ?? '';
    return normalizeName(group.title) === title && normalizeName(artist).includes(creator);
  }) ?? result['release-groups']?.[0];
  if (!candidate) return null;
  const document = await optionalCoverArt(
    fetcher,
    new URL(`${config.COVER_ART_ARCHIVE_BASE_URL.replace(/\/+$/, '')}/release-group/${candidate.id}/`),
    userAgent
  );
  const image = document?.images?.find((entry) => entry.front && entry.approved !== false)
    ?? document?.images?.find((entry) => entry.approved !== false);
  const imageUrl = image?.thumbnails?.['500'] ?? image?.thumbnails?.large ?? image?.image;
  return image && imageUrl ? {
    url: imageUrl.replace(/^http:/, 'https:'),
    exactRelease: false,
    sourceId: image.id,
    sourceRelease: document?.release
  } : null;
}

export async function identifyWithMusicBrainz(
  input: { creator: string; workTitle: string; durationMs: number },
  options: IdentifyOptions = {}
): Promise<MusicBrainzIdentification | null> {
  const config = readConfig();
  const fetcher = options.fetcher ?? fetch;
  const userAgent = `Aby/0.1.0 (${config.ABY_EXTERNAL_METADATA_CONTACT})`;
  const query = `artist:${quoted(input.creator)} AND recording:${quoted(input.workTitle)}`;
  const searchUrl = new URL(`${config.MUSICBRAINZ_BASE_URL.replace(/\/+$/, '')}/recording/`);
  searchUrl.searchParams.set('query', query);
  searchUrl.searchParams.set('fmt', 'json');
  searchUrl.searchParams.set('limit', '25');
  const search = await jsonRequest<{ recordings?: MusicBrainzRecording[] }>(fetcher, searchUrl, userAgent);
  const creator = normalizeName(input.creator);
  const title = normalizeName(input.workTitle);
  const recordings = (search.recordings ?? []).filter((candidate) => {
    const candidateArtist = candidate['artist-credit']?.map((credit) => credit.name || credit.artist?.name || '').join(' ') ?? '';
    return normalizeName(candidate.title) === title && normalizeName(candidateArtist).includes(creator);
  });
  recordings.sort((left, right) => {
    const durationDelta = (candidate: MusicBrainzRecording) => candidate.length === undefined
      ? Number.MAX_SAFE_INTEGER
      : Math.abs(candidate.length - input.durationMs);
    return durationDelta(left) - durationDelta(right) || (right.score ?? 0) - (left.score ?? 0);
  });
  const recording = recordings[0];
  if (!recording) return null;
  const durationDelta = recording.length === undefined ? Number.MAX_SAFE_INTEGER : Math.abs(recording.length - input.durationMs);
  const releaseSummary = recording.releases?.[0];
  let release: MusicBrainzRelease | undefined;
  if (releaseSummary) {
    await sleep(options.musicBrainzIntervalMs ?? 1_100);
    const releaseUrl = new URL(`${config.MUSICBRAINZ_BASE_URL.replace(/\/+$/, '')}/release/${releaseSummary.id}`);
    releaseUrl.searchParams.set('fmt', 'json');
    releaseUrl.searchParams.set('inc', 'artist-credits+labels+release-groups');
    release = await jsonRequest<MusicBrainzRelease>(fetcher, releaseUrl, userAgent);
  }
  const labelInfo = release?.['label-info']?.[0];
  const releaseGroupId = release?.['release-group']?.id;
  let coverDocument: CoverArtDocument | null = null;
  let exactRelease = true;
  if (release?.id) {
    coverDocument = await optionalCoverArt(
      fetcher,
      new URL(`${config.COVER_ART_ARCHIVE_BASE_URL.replace(/\/+$/, '')}/release/${release.id}/`),
      userAgent
    );
  }
  if (!coverDocument && releaseGroupId) {
    exactRelease = false;
    coverDocument = await optionalCoverArt(
      fetcher,
      new URL(`${config.COVER_ART_ARCHIVE_BASE_URL.replace(/\/+$/, '')}/release-group/${releaseGroupId}/`),
      userAgent
    );
  }
  const image = coverDocument?.images?.find((candidate) => candidate.front && candidate.approved !== false)
    ?? coverDocument?.images?.find((candidate) => candidate.approved !== false);
  const imageUrl = image?.thumbnails?.['500'] ?? image?.thumbnails?.large ?? image?.image;
  const artist = recording['artist-credit']?.[0];
  const score = durationDelta <= 1_000 ? 0.99 : durationDelta <= 5_000 ? 0.95 : Math.min(0.9, (recording.score ?? 0) / 100);
  return {
    recordingId: recording.id,
    recordingTitle: recording.title,
    ...(recording.length !== undefined ? { recordingLengthMs: recording.length } : {}),
    ...(artist?.artist?.id ? { artistId: artist.artist.id } : {}),
    artistName: artist?.name || artist?.artist?.name || input.creator,
    ...(release?.id ? { releaseId: release.id } : {}),
    ...(release?.title ? { releaseTitle: release.title } : {}),
    ...(release?.date ? { releaseDate: release.date } : {}),
    ...(release?.country ? { releaseCountry: release.country } : {}),
    ...(releaseGroupId ? { releaseGroupId } : {}),
    ...(labelInfo?.label?.name ? { label: labelInfo.label.name } : {}),
    ...(labelInfo?.label?.id ? { labelId: labelInfo.label.id } : {}),
    ...(labelInfo?.['catalog-number'] ? { catalogNumber: labelInfo['catalog-number'] } : {}),
    score,
    ...(image && imageUrl ? {
      cover: {
        url: imageUrl.replace(/^http:/, 'https:'),
        exactRelease,
        sourceId: image.id,
        ...(coverDocument?.release ? { sourceRelease: coverDocument.release } : {})
      }
    } : {})
  };
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

export async function getAudioFingerprint(path: string, fpcalcPath: string): Promise<{ duration: number; fingerprint: string } | null> {
  try {
    const { stdout } = await execFileAsync(fpcalcPath, ['-json', '-length', '120', path], { timeout: 30_000 });
    const parsed = JSON.parse(stdout);
    if (parsed.fingerprint && parsed.duration) {
      return {
        duration: Math.round(parsed.duration),
        fingerprint: parsed.fingerprint
      };
    }
  } catch (err) {
    console.error('AcoustID fpcalc fingerprinting failed:', err);
  }
  return null;
}

export async function lookupAcoustID(duration: number, fingerprint: string, clientKey: string): Promise<any> {
  const url = new URL('https://api.acoustid.org/v2/lookup');
  url.searchParams.append('client', clientKey);
  url.searchParams.append('meta', 'recordings+releases+releasegroups+tracks');
  url.searchParams.append('duration', String(duration));
  url.searchParams.append('fingerprint', fingerprint);

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Aby/0.1.0 (https://aby.zztt.org)' }
    });
    if (!res.ok) {
      console.warn('AcoustID API lookup failed with status:', res.status);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('AcoustID lookup HTTP request failed:', err);
    return null;
  }
}

export async function identifyWithMusicBrainzRecordingId(
  recordingId: string,
  durationMs: number,
  options: IdentifyOptions = {}
): Promise<MusicBrainzIdentification | null> {
  const config = readConfig();
  const fetcher = options.fetcher ?? fetch;
  const userAgent = `Aby/0.1.0 (${config.ABY_EXTERNAL_METADATA_CONTACT})`;
  
  const recordingUrl = new URL(`${config.MUSICBRAINZ_BASE_URL.replace(/\/+$/, '')}/recording/${recordingId}`);
  recordingUrl.searchParams.set('fmt', 'json');
  recordingUrl.searchParams.set('inc', 'artist-credits+releases');
  
  let recording: MusicBrainzRecording;
  try {
    recording = await jsonRequest<MusicBrainzRecording>(fetcher, recordingUrl, userAgent);
  } catch (err) {
    console.error(`MusicBrainz lookup for recording ${recordingId} failed:`, err);
    return null;
  }
  
  const releaseSummary = recording.releases?.[0];
  let release: MusicBrainzRelease | undefined;
  if (releaseSummary) {
    await sleep(options.musicBrainzIntervalMs ?? 1_100);
    const releaseUrl = new URL(`${config.MUSICBRAINZ_BASE_URL.replace(/\/+$/, '')}/release/${releaseSummary.id}`);
    releaseUrl.searchParams.set('fmt', 'json');
    releaseUrl.searchParams.set('inc', 'artist-credits+labels+release-groups');
    try {
      release = await jsonRequest<MusicBrainzRelease>(fetcher, releaseUrl, userAgent);
    } catch (err) {
      console.error(`MusicBrainz lookup for release ${releaseSummary.id} failed:`, err);
    }
  }
  const labelInfo = release?.['label-info']?.[0];
  const releaseGroupId = release?.['release-group']?.id;
  let coverDocument: CoverArtDocument | null = null;
  let exactRelease = true;
  if (release?.id) {
    try {
      coverDocument = await optionalCoverArt(
        fetcher,
        new URL(`${config.COVER_ART_ARCHIVE_BASE_URL.replace(/\/+$/, '')}/release/${release.id}/`),
        userAgent
      );
    } catch (err) {
      console.warn(`Cover Art lookup for release ${release.id} failed:`, err);
    }
  }
  if (!coverDocument && releaseGroupId) {
    exactRelease = false;
    try {
      coverDocument = await optionalCoverArt(
        fetcher,
        new URL(`${config.COVER_ART_ARCHIVE_BASE_URL.replace(/\/+$/, '')}/release-group/${releaseGroupId}/`),
        userAgent
      );
    } catch (err) {
      console.warn(`Cover Art lookup for release-group ${releaseGroupId} failed:`, err);
    }
  }
  const image = coverDocument?.images?.find((candidate) => candidate.front && candidate.approved !== false)
    ?? coverDocument?.images?.find((candidate) => candidate.approved !== false);
  const imageUrl = image?.thumbnails?.['500'] ?? image?.thumbnails?.large ?? image?.image;
  const artist = recording['artist-credit']?.[0];
  const score = 0.99;
  return {
    recordingId: recording.id,
    recordingTitle: recording.title,
    ...(recording.length !== undefined ? { recordingLengthMs: recording.length } : {}),
    ...(artist?.artist?.id ? { artistId: artist.artist.id } : {}),
    artistName: artist?.name || artist?.artist?.name || 'Unknown Artist',
    ...(release?.id ? { releaseId: release.id } : {}),
    ...(release?.title ? { releaseTitle: release.title } : {}),
    ...(release?.date ? { releaseDate: release.date } : {}),
    ...(release?.country ? { releaseCountry: release.country } : {}),
    ...(releaseGroupId ? { releaseGroupId } : {}),
    ...(labelInfo?.label?.name ? { label: labelInfo.label.name } : {}),
    ...(labelInfo?.label?.id ? { labelId: labelInfo.label.id } : {}),
    ...(labelInfo?.['catalog-number'] ? { catalogNumber: labelInfo['catalog-number'] } : {}),
    score,
    ...(image && imageUrl ? {
      cover: {
        url: imageUrl.replace(/^http:/, 'https:'),
        exactRelease,
        sourceId: image.id,
        ...(coverDocument?.release ? { sourceRelease: coverDocument.release } : {})
      }
    } : {})
  };
}
