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
        released: '2007-03-12', country: 'Germany', genres: ['Jazz'], styles: ['Free Improvisation'],
        companies: [{ name: 'Example Studio', entity_type_name: 'Recorded At', id: 44 }],
        extraartists: [{ name: 'Axel Dörner', role: 'Trumpet', tracks: '1-4', id: 55 }],
        formats: [{ name: 'CD', qty: '1', descriptions: ['Album'] }],
        tracklist: [{ position: '1', title: 'Sind', duration: '4:12', type_: 'track' }],
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
    expect(result).toMatchObject({
      releaseDate: '2007-03-12', country: 'Germany', genres: ['Jazz'], styles: ['Free Improvisation'],
      companies: [{ name: 'Example Studio', role: 'Recorded At', externalId: '44' }],
      credits: [{ name: 'Axel Dörner', role: 'Trumpet', tracks: '1-4', externalId: '55' }],
      formats: [{ name: 'CD', quantity: '1', descriptions: ['Album'] }],
      tracklist: [{ position: '1', title: 'Sind', duration: '4:12', type: 'track' }]
    });
  });

  test('falls back to release title when the embedded artist is damaged or wrong', async () => {
    const calls: URL[] = [];
    const fetcher: typeof fetch = (async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname.endsWith('/database/search') && url.searchParams.has('artist')) {
        return Response.json({ results: [] });
      }
      if (url.pathname.endsWith('/database/search')) {
        return Response.json({ results: [{
          id: 6685489, type: 'release',
          title: 'Jean-Baptiste Barrière - 100 Objects To Represent The World', year: 1997
        }] });
      }
      return Response.json({
        id: 6685489, title: '100 Objects To Represent The World', year: 1997,
        artists_sort: 'Jean-Baptiste Barrière', uri: '/release/6685489'
      });
    }) as typeof fetch;

    const result = await searchDiscogsRelease({
      creator: 'Jean Luc Barriere', albumTitle: '100 Objects to Represent the W', year: '1997'
    }, { fetcher });

    expect(calls).toHaveLength(3);
    expect(calls[1]?.searchParams.get('artist')).toBeNull();
    expect(result).toMatchObject({ id: '6685489', creator: 'Jean-Baptiste Barrière' });
  });
});
