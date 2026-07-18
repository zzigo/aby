import { describe, expect, test } from 'bun:test';
import type { CatalogItem } from '@zztt/aby-domain';
import { id3FfmpegArgs, id3Values } from '../src/lib/server/id3';

describe('ID3 album projection', () => {
  test('maps album, track, roles and descriptors without changing audio codec arguments', () => {
    const item = {
      recordingTitle: 'Object 01', albumTitle: '100 Objects', creator: 'Voice',
      albumArtist: 'Jean-Baptiste Barrière', trackNumber: 1, releaseDate: '1997',
      asset: { canonicalMetadata: {
        genres: ['Classical'], styles: ['Opera'], albumTags: ['Opera'],
        roles: [{ name: 'Jean-Baptiste Barrière', role: 'Composed By' }, { name: 'Voice', role: 'Vocals' }],
        discogs: { id: '6685489' }
      } }
    } as unknown as CatalogItem;
    const values = id3Values(item);
    expect(values).toMatchObject({
      title: 'Object 01', album: '100 Objects', albumArtist: 'Jean-Baptiste Barrière',
      composer: 'Jean-Baptiste Barrière', genre: 'Classical', abyStyles: 'Opera', discogsReleaseId: '6685489'
    });
    const args = id3FfmpegArgs('/tmp/in.mp3', '/tmp/out.mp3', values, '/tmp/cover.jpg');
    expect(args).toContain('copy');
    expect(args).toContain('attached_pic');
    expect(args).toContain('album_artist=Jean-Baptiste Barrière');
    expect(args.at(-3)).toBe('-write_id3v1');
    expect(args.at(-1)).toBe('/tmp/out.mp3');
  });
});
