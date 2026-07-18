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

test('uses a feature image when an album has no explicit cover candidate', () => {
  const feature = {
    authority: 'cover-art-archive', url: 'https://coverartarchive.org/release/example/cover.jpg', kind: 'feature' as const,
    exactRelease: false, sourceId: '45503068818', provenance: {}
  };
  expect(preferredCoverCandidate([feature])).toEqual(feature);
});
