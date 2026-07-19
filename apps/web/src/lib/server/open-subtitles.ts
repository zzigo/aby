import type { AvCatalogItem, AvSubtitleSettings } from '@zztt/aby-domain';
import { readConfig } from './config';
import { AbyError } from './errors';
import { fetchSubtitleBytes, subtitleBytesToVtt } from './subtitle-vtt';

export type OpenSubtitleCandidate = {
  key: string;
  fileId: number;
  language: string;
  release: string;
  fileName: string;
  hearingImpaired: boolean;
  downloadCount: number;
};

const vttCache = new Map<number, { value: string; expiresAt: number }>();

function headers() {
  const config = readConfig();
  if (!config.OPENSUBTITLES_API_KEY) throw new AbyError('opensubtitles_not_configured', 'OpenSubtitles API key is not configured', 503);
  return { 'Api-Key': config.OPENSUBTITLES_API_KEY, 'User-Agent': 'Aby v0.1' };
}

export async function searchOpenSubtitles(item: AvCatalogItem, settings: AvSubtitleSettings): Promise<OpenSubtitleCandidate[]> {
  const url = new URL('https://api.opensubtitles.com/api/v1/subtitles');
  const imdb = item.externalIds.imdb?.replace(/^tt/i, '');
  if (imdb && /^\d+$/.test(imdb)) url.searchParams.set('imdb_id', imdb);
  else url.searchParams.set('query', item.title);
  url.searchParams.set('languages', settings.languages.join(','));
  url.searchParams.set('type', item.kind === 'episode' ? 'episode' : 'movie');
  if (item.year) url.searchParams.set('year', String(item.year));
  const response = await fetch(url, { headers: headers() });
  const body = await response.json() as any;
  if (!response.ok) throw new AbyError('opensubtitles_search_failed', body.message ?? `OpenSubtitles search returned ${response.status}`, 502);
  const candidates: OpenSubtitleCandidate[] = [];
  for (const result of body.data ?? []) {
    const attributes = result.attributes ?? {};
    if (!settings.includeHearingImpaired && attributes.hearing_impaired) continue;
    for (const file of attributes.files ?? []) {
      if (!Number.isInteger(file.file_id)) continue;
      candidates.push({
        key: `opensubtitles:${file.file_id}`, fileId: file.file_id,
        language: attributes.language ?? 'und', release: attributes.release ?? attributes.feature_details?.title ?? file.file_name,
        fileName: file.file_name ?? `subtitle-${file.file_id}.srt`, hearingImpaired: Boolean(attributes.hearing_impaired),
        downloadCount: Number(attributes.download_count ?? attributes.new_download_count ?? 0)
      });
    }
  }
  const perLanguage = new Map<string, number>();
  return candidates.sort((left, right) => right.downloadCount - left.downloadCount).filter((candidate) => {
    const count = perLanguage.get(candidate.language) ?? 0;
    perLanguage.set(candidate.language, count + 1);
    return count < 4;
  });
}

export async function downloadOpenSubtitleVtt(fileId: number): Promise<string> {
  const cached = vttCache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const response = await fetch('https://api.opensubtitles.com/api/v1/download', {
    method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: fileId })
  });
  const body = await response.json() as { link?: string; message?: string };
  if (!response.ok || !body.link) throw new AbyError('opensubtitles_download_failed', body.message ?? `OpenSubtitles download returned ${response.status}`, 502);
  const value = await subtitleBytesToVtt(await fetchSubtitleBytes(body.link));
  vttCache.set(fileId, { value, expiresAt: Date.now() + 6 * 60 * 60_000 });
  return value;
}
