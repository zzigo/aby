import { expect, test } from 'bun:test';
import { findLrclibLyrics, parseLrc, plainLyricsFromLrc } from '../src/lib/server/lrclib';

test('normalizes line-level LRC into ordered timed text cues', () => {
  const lrc = '[ar:Example]\n[00:12.40] First line\n[00:15.005][00:18.00] Repeated line';
  expect(parseLrc(lrc)).toEqual([
    { position: 0, startMs: 12_400, endMs: 15_005, text: 'First line', speaker: null, words: [] },
    { position: 1, startMs: 15_005, endMs: 18_000, text: 'Repeated line', speaker: null, words: [] },
    { position: 2, startMs: 18_000, endMs: null, text: 'Repeated line', speaker: null, words: [] }
  ]);
  expect(plainLyricsFromLrc(lrc)).toBe('First line\nRepeated line\nRepeated line');
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
