import { expect, test } from 'bun:test';
import { identifyWithMusicBrainz } from '../src/lib/server/musicbrainz';

test('selects the duration-matched recording and marks release-group art as fallback', async () => {
  const requests: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('/recording/')) return Response.json({ recordings: [{
      id: 'd88c8ddf-779c-48f0-b47c-73082a33d615', title: 'The Sinking of the Titanic', length: 3_619_000, score: 100,
      'artist-credit': [{ name: 'Gavin Bryars', artist: { id: 'artist-id', name: 'Gavin Bryars' } }],
      releases: [{ id: 'release-id', title: 'The Sinking of the Titanic', date: '1990', country: 'BE' }]
    }] });
    if (url.includes('musicbrainz.org') && url.includes('/release/release-id')) return Response.json({
      id: 'release-id', title: 'The Sinking of the Titanic', date: '1990', country: 'BE',
      'release-group': { id: 'group-id', title: 'The Sinking of the Titanic' },
      'label-info': [{ 'catalog-number': 'TWI 922-2', label: { id: 'label-id', name: 'Les Disques du Crépuscule' } }]
    });
    if (url.includes('/release/release-id/')) return new Response('', { status: 404 });
    if (url.includes('/release-group/group-id/')) return Response.json({
      release: 'https://musicbrainz.org/release/cover-source',
      images: [{ id: 'cover-id', front: true, approved: true, thumbnails: { '500': 'http://coverartarchive.org/cover-500.jpg' } }]
    });
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const result = await identifyWithMusicBrainz({
    creator: 'Gavin Bryars', workTitle: 'The Sinking of the Titanic', durationMs: 3_619_066
  }, { fetcher, musicBrainzIntervalMs: 0 });
  expect(result?.recordingId).toBe('d88c8ddf-779c-48f0-b47c-73082a33d615');
  expect(result?.catalogNumber).toBe('TWI 922-2');
  expect(result?.score).toBe(0.99);
  expect(result?.cover?.exactRelease).toBe(false);
  expect(result?.cover?.url).toBe('https://coverartarchive.org/cover-500.jpg');
  expect(requests).toHaveLength(4);
});

import { identifyWithMusicBrainzRecordingId } from '../src/lib/server/musicbrainz';

test('identifies recording directly by ID', async () => {
  const requests: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('/recording/rec-id')) return Response.json({
      id: 'rec-id', title: 'Direct Recording Track', length: 120_000,
      'artist-credit': [{ name: 'Solesmes Monk', artist: { id: 'artist-id', name: 'Solesmes Monk' } }],
      releases: [{ id: 'release-id', title: 'Gregorian Easter', date: '2004', country: 'FR' }]
    });
    if (url.includes('musicbrainz.org') && url.includes('/release/release-id')) return Response.json({
      id: 'release-id', title: 'Gregorian Easter', date: '2004', country: 'FR',
      'release-group': { id: 'group-id', title: 'Gregorian Easter' },
      'label-info': [{ 'catalog-number': 'L-4380', label: { id: 'label-id', name: 'Solesmes Records' } }]
    });
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const result = await identifyWithMusicBrainzRecordingId('rec-id', 120_000, { fetcher, musicBrainzIntervalMs: 0 });
  expect(result?.recordingId).toBe('rec-id');
  expect(result?.artistName).toBe('Solesmes Monk');
  expect(result?.releaseTitle).toBe('Gregorian Easter');
  expect(result?.catalogNumber).toBe('L-4380');
});
