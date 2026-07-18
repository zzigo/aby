import { expect, test } from 'bun:test';
import { findLrclibLyrics, looksLikeLrc, parseLrc, plainLyricsFromLrc } from '../src/lib/server/lrclib';

test('normalizes line-level LRC into ordered timed text cues', () => {
  const lrc = '[ar:Example]\n[00:12.40] First line\n[00:15.005][00:18.00] Repeated line';
  expect(parseLrc(lrc)).toEqual([
    { position: 0, startMs: 12_400, endMs: 15_005, text: 'First line', speaker: null, words: [] },
    { position: 1, startMs: 15_005, endMs: 18_000, text: 'Repeated line', speaker: null, words: [] },
    { position: 2, startMs: 18_000, endMs: null, text: 'Repeated line', speaker: null, words: [] }
  ]);
  expect(plainLyricsFromLrc(lrc)).toBe('First line\nRepeated line\nRepeated line');
  expect(looksLikeLrc(lrc)).toBe(true);
  expect(looksLikeLrc('First line\nSecond line')).toBe(false);
});

test('queries LRCLIB with the exact duration signature', async () => {
  let requested = '';
  const record = await findLrclibLyrics({
    trackName: 'Song', artistName: 'Artist', albumName: 'Album', durationSeconds: 243.4
  }, (async (input) => {
    requested = String(input);
    return new Response(JSON.stringify({
      id: 12, trackName: 'Song', artistName: 'Artist', albumName: 'Album', duration: 243,
      instrumental: false, plainLyrics: 'Line', syncedLyrics: '[00:01.00] Line'
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);
  expect(requested).toContain('duration=243');
  expect(requested).toContain('artist_name=Artist');
  expect(record?.id).toBe(12);
});

test('falls back to ranked LRCLIB search when the exact album signature is absent', async () => {
  const requested: string[] = [];
  const record = await findLrclibLyrics({
    trackName: 'Money', artistName: 'Pink Floyd', albumName: 'Dark Side Of The Moon', durationSeconds: 381.561
  }, (async (input) => {
    requested.push(String(input));
    if (requested.length === 1) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify([
      { id: 2, trackName: 'Money', artistName: 'Pink Floyd', albumName: 'Pulse', duration: 535, instrumental: false, plainLyrics: 'live', syncedLyrics: null },
      { id: 1, trackName: 'Money', artistName: 'Pink Floyd', albumName: '.', duration: 381, instrumental: false, plainLyrics: 'money', syncedLyrics: '[00:17.69] Money' }
    ]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);
  expect(requested[1]).toContain('/api/search?');
  expect(requested[1]).toContain('artist_name=Pink+Floyd');
  expect(record?.id).toBe(1);
});
