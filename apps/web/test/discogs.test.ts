import { describe, expect, test } from 'bun:test';
import { searchDiscogsRelease } from '../src/lib/server/discogs';

describe('Discogs album metadata', () => {
  test('finds Axel Dörner — Sind and returns release-level artwork', async () => {
    const calls: URL[] = [];
    const fetcher: typeof fetch = (async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname.endsWith('/database/search')) {
        return Response.json({ results: [{
          id: 1229980, type: 'release', title: 'Axel Dörner - Sind', year: 2007,
          label: ['absinthRecords'], catno: 'absinthRecords 010'
        }] });
      }
      return Response.json({
        id: 1229980,
        title: 'Sind',
        year: 2007,
        artists_sort: 'Axel Dörner',
        uri: 'https://www.discogs.com/release/1229980-Axel-Dörner-Sind',
        labels: [{ name: 'absinthRecords', catno: 'absinthRecords 010' }],
        images: [{ type: 'primary', uri: 'https://i.discogs.com/sind.jpeg' }]
      });
    }) as typeof fetch;

    const result = await searchDiscogsRelease({
      creator: 'Axel Dörner', albumTitle: 'Axel Dörner - Sind (2007)', year: '2007'
    }, { fetcher });

    expect(calls[0]?.searchParams.get('release_title')).toBe('Sind');
    expect(calls[0]?.searchParams.get('year')).toBe('2007');
    expect(calls[1]?.pathname).toEndWith('/releases/1229980');
    expect(result).toMatchObject({
      id: '1229980', title: 'Sind', creator: 'Axel Dörner', year: '2007',
      label: 'absinthRecords', catalogNumber: 'absinthRecords 010',
      coverUrl: 'https://i.discogs.com/sind.jpeg',
      canonicalUrl: 'https://www.discogs.com/release/1229980-Axel-Dörner-Sind'
    });
  });
});
