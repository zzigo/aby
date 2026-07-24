import { expect, test } from 'bun:test';
import type { IngestPreview } from '@zztt/aby-domain';
import { applyDiscogsToIngestPreview } from '../src/lib/server/ingest-discogs';

const fetchedAt = '2026-07-24T10:00:00.000Z';
const preview: IngestPreview = {
  id: crypto.randomUUID(),
  ownerId: 'owner',
  provider: 'wasabi',
  bucket: 'media',
  objectKey: 'ref/19/Claude Debussy/La Mer/01.mp3',
  originalFilename: '01.mp3',
  originalDirectory: 'ref/19/Claude Debussy/La Mer',
  checksumSha256: 'a'.repeat(64),
  technicalMetadata: { durationMs: 1_000, formatName: 'mp3', tags: {} },
  candidateMetadata: {
    title: 'La Mer',
    recordingTitle: 'Track one',
    creator: 'Claude Debussy',
    tracks: [
      {
        objectKey: 'ref/19/Claude Debussy/La Mer/01.mp3',
        canonicalObjectKey: 'aby/aud/19/debussy/la-mer/01.mp3',
        originalFilename: '01.mp3',
        checksumSha256: 'a'.repeat(64),
        technicalMetadata: { durationMs: 1_000, formatName: 'mp3', tags: {} },
        recordingTitle: 'Track one',
        trackNumber: 1
      }
    ]
  },
  provenance: {
    method: 'calculated',
    source: 'wasabi:ref/19/Claude Debussy/La Mer/01.mp3',
    actorId: 'owner',
    parameters: {},
    timestamp: fetchedAt,
    reviewState: 'candidate'
  },
  status: 'candidate',
  createdAt: fetchedAt
};

test('applies an exact Discogs release to a Wasabi album preview without committing it', () => {
  const result = applyDiscogsToIngestPreview(preview, {
    id: '123',
    title: 'La Mer',
    creator: 'Claude Debussy',
    year: '1962',
    label: 'Example',
    catalogNumber: 'EX-1',
    coverUrl: 'https://i.discogs.com/cover.jpg',
    canonicalUrl: 'https://www.discogs.com/release/123',
    genres: ['Classical'],
    styles: ['Impressionist'],
    tracklist: [{ position: '1', title: 'De l’aube à midi sur la mer', duration: '9:00' }]
  }, fetchedAt);

  expect(result.status).toBe('candidate');
  expect(result.candidateMetadata).toMatchObject({
    albumTitle: 'La Mer',
    creator: 'Claude Debussy',
    entitySlug: 'debussy',
    releaseDate: '1962',
    label: 'Example',
    catalogNumber: 'EX-1',
    tags: ['Classical', 'Impressionist'],
    discogs: { id: '123' },
    discogsRefreshedAt: fetchedAt,
    tracks: [{ recordingTitle: 'De l’aube à midi sur la mer', trackNumber: 1 }]
  });
  expect(result.candidateMetadata.metadataSources).toMatchObject([
    { authority: 'discogs', externalId: '123', reviewState: 'candidate' }
  ]);
  expect(result.candidateMetadata.imageCandidates?.[0]).toMatchObject({
    authority: 'discogs', sourceId: '123', kind: 'cover'
  });
});
