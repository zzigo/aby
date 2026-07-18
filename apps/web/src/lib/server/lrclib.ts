import { AbyError } from './errors';

export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface ParsedLyricCue {
  position: number;
  startMs: number | null;
  endMs: number | null;
  text: string;
  speaker: null;
  words: [];
}

export function parseLrc(value: string): ParsedLyricCue[] {
  const entries: Array<{ startMs: number; text: string }> = [];
  for (const line of value.replaceAll('\r\n', '\n').split('\n')) {
    const timestamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!timestamps.length) continue;
    const text = line.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g, '').trim();
    if (!text) continue;
    for (const match of timestamps) {
      const fraction = (match[3] ?? '').padEnd(3, '0').slice(0, 3);
      entries.push({
        startMs: (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number(fraction || 0),
        text
      });
    }
  }
  entries.sort((left, right) => left.startMs - right.startMs);
  return entries.slice(0, 5000).map((entry, position) => ({
    position,
    startMs: entry.startMs,
    endMs: entries[position + 1]?.startMs ?? null,
    text: entry.text,
    speaker: null,
    words: []
  }));
}

export function plainLyricsFromLrc(value: string): string {
  return parseLrc(value).map((cue) => cue.text).join('\n');
}

export async function findLrclibLyrics(input: {
  trackName: string;
  artistName: string;
  albumName: string;
  durationSeconds: number;
}, fetcher: typeof fetch = fetch): Promise<LrclibRecord | null> {
  const url = new URL('https://lrclib.net/api/get');
  url.searchParams.set('track_name', input.trackName);
  url.searchParams.set('artist_name', input.artistName);
  url.searchParams.set('album_name', input.albumName);
  url.searchParams.set('duration', String(Math.round(input.durationSeconds)));
  const response = await fetcher(url, {
    headers: { accept: 'application/json', 'user-agent': 'Aby/0.1.0 (https://aby.zztt.org)' },
    signal: AbortSignal.timeout(15_000)
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new AbyError('lrclib_failed', `LRCLIB request failed with HTTP ${response.status}`, 502);
  const record = await response.json() as LrclibRecord;
  if (!record.plainLyrics && !record.syncedLyrics && !record.instrumental) return null;
  return record;
}
