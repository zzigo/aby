import { expect, test } from 'bun:test';
import { buildIngestTrackEdits } from '../src/lib/ingest-track-edits';

const technicalMetadata = {
  durationMs: 1_000,
  formatName: 'flac',
  tags: {}
};

test('gives CUE tracks unique UI identities when they share one source object', () => {
  const objectKey = 'ref/21 late/Clara Iannotta/Earthing/Earthing.ape';
  const tracks = buildIngestTrackEdits([
    {
      objectKey,
      canonicalObjectKey: 'aby/aud/21L/iannotta/earthing/01-earthing-i.flac',
      originalFilename: 'Earthing.ape#track1',
      checksumSha256: 'a'.repeat(64),
      technicalMetadata,
      recordingTitle: 'Earthing I',
      trackNumber: 1,
      segmentStartMs: 0,
      segmentEndMs: 1_000
    },
    {
      objectKey,
      canonicalObjectKey: 'aby/aud/21L/iannotta/earthing/02-earthing-ii.flac',
      originalFilename: 'Earthing.ape#track2',
      checksumSha256: 'a'.repeat(64),
      technicalMetadata,
      recordingTitle: 'Earthing II',
      trackNumber: 2,
      segmentStartMs: 1_000,
      segmentEndMs: 2_000
    }
  ]);

  expect(new Set(tracks.map((track) => track.key)).size).toBe(2);
  expect(tracks.map((track) => track.objectKey)).toEqual([objectKey, objectKey]);
});
