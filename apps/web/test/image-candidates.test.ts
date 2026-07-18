import { expect, test } from 'bun:test';
import { mergeImageCandidates, preferredCoverCandidate } from '../src/lib/server/image-candidates';

test('manual cover remains authoritative across service refreshes', () => {
  const manual = {
    authority: 'manual-upload', url: '/api/albums/a/cover?v=abc', kind: 'cover' as const,
    exactRelease: true, sourceId: 'abc', provenance: { artifactObjectKey: 'aby/_artwork/a/abc.jpg' }
  };
  const discogs = {
    authority: 'discogs', url: 'https://i.discogs.com/a.jpeg', kind: 'cover' as const,
    exactRelease: true, sourceId: '123', provenance: {}
  };
  const coverArt = {
    authority: 'cover-art-archive', url: 'https://coverartarchive.org/a.jpg', kind: 'cover' as const,
    exactRelease: true, sourceId: 'release-a', provenance: {}
  };

  const merged = mergeImageCandidates([discogs], [manual, coverArt]);
  expect(merged).toHaveLength(3);
  expect(preferredCoverCandidate(merged)).toEqual(manual);
});
