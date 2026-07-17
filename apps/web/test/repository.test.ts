import { describe, expect, test } from 'bun:test';
import type { IngestPreview } from '@zztt/aby-domain';
import { MemoryAbyRepository } from '../src/lib/server/repository';

function fixturePreview(): IngestPreview {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), ownerId: 'owner-a', provider: 'local-fixture', objectKey: 'aby/aud/demo/test.wav',
    originalFilename: 'test.wav', originalDirectory: '/fixture', checksumSha256: 'a'.repeat(64),
    technicalMetadata: { durationMs: 1000, formatName: 'wav', tags: {} },
    candidateMetadata: { title: 'Candidate', recordingTitle: 'Take 1' },
    provenance: { method: 'calculated', source: 'test', actorId: 'owner-a', parameters: {}, timestamp: now, reviewState: 'candidate' },
    status: 'candidate', createdAt: now
  };
}

describe('preview-before-write repository flow', () => {
  test('requires explicit commit and keeps segments logical', async () => {
    const repository = new MemoryAbyRepository();
    const preview = await repository.savePreview(fixturePreview());
    const asset = await repository.commitPreview('owner-a', preview.id, 'Accepted work', 'Accepted recording');
    expect(asset.canonicalMetadata.title).toBe('Accepted work');
    const segment = await repository.createSegment('owner-a', {
      assetId: asset.id, startTimeMs: 100, endTimeMs: 400, channelSelection: [], fadeInMs: 0, fadeOutMs: 0
    }, { method: 'human', source: 'test', actorId: 'owner-a', parameters: {}, timestamp: new Date().toISOString(), reviewState: 'accepted' });
    expect(segment.endTimeMs).toBe(400);
    const catalog = await repository.listCatalog('owner-a');
    expect(catalog[0]?.workTitle).toBe('Accepted work');
    expect(catalog[0]?.segments[0]?.startTimeMs).toBe(100);
  });

  test('does not leak assets across owners', async () => {
    const repository = new MemoryAbyRepository();
    const preview = await repository.savePreview(fixturePreview());
    const asset = await repository.commitPreview('owner-a', preview.id, 'Work', 'Recording');
    expect(await repository.getAsset('owner-b', asset.id)).toBeNull();
  });

  test('promotion switches authority and preserves the source as retirement provenance', async () => {
    const repository = new MemoryAbyRepository();
    const source = fixturePreview();
    source.provider = 'wasabi';
    source.bucket = 'private';
    source.objectKey = 'ref/20 late/example.mp3';
    source.candidateMetadata.canonicalObjectKey = 'aby/aud/20L/example/work/recording/work.mp3';
    const preview = await repository.savePreview(source);
    const promoted = await repository.markPreviewPromoted(
      'owner-a',
      preview.id,
      source.objectKey,
      source.candidateMetadata.canonicalObjectKey
    );
    expect(promoted.objectKey).toBe(source.candidateMetadata.canonicalObjectKey);
    expect(promoted.provenance.parameters.sourceObjectKey).toBe(source.objectKey);
    const asset = await repository.commitPreview('owner-a', preview.id, 'Work', 'Recording');
    expect(asset.objectKey).toBe(source.candidateMetadata.canonicalObjectKey);
  });

  test('reuses a canonical asset for the same storage identity and checksum, but rejects changed content', async () => {
    const repository = new MemoryAbyRepository();
    const initial = fixturePreview();
    initial.provider = 'wasabi';
    initial.bucket = 'private';
    const firstPreview = await repository.savePreview(initial);
    const firstAsset = await repository.commitPreview('owner-a', firstPreview.id, 'Work', 'Recording');

    const repeatedPreview = fixturePreview();
    repeatedPreview.ownerId = firstPreview.ownerId;
    repeatedPreview.provider = firstPreview.provider;
    repeatedPreview.bucket = firstPreview.bucket;
    repeatedPreview.objectKey = firstPreview.objectKey;
    repeatedPreview.checksumSha256 = firstPreview.checksumSha256;
    const savedRepeat = await repository.savePreview(repeatedPreview);
    const repeatedAsset = await repository.commitPreview('owner-a', savedRepeat.id, 'Work', 'Recording');
    expect(repeatedAsset.id).toBe(firstAsset.id);

    for (const [workTitle, recordingTitle] of [
      ['Different work', 'Recording'],
      ['Work', 'Different recording']
    ]) {
      const metadataConflict = fixturePreview();
      metadataConflict.ownerId = firstPreview.ownerId;
      metadataConflict.provider = firstPreview.provider;
      metadataConflict.bucket = firstPreview.bucket;
      metadataConflict.objectKey = firstPreview.objectKey;
      metadataConflict.checksumSha256 = firstPreview.checksumSha256;
      const savedMetadataConflict = await repository.savePreview(metadataConflict);
      expect(repository.commitPreview('owner-a', savedMetadataConflict.id, workTitle, recordingTitle)).rejects.toMatchObject({
        code: 'canonical_metadata_conflict',
        status: 409
      });
    }

    const conflictingPreview = fixturePreview();
    conflictingPreview.ownerId = firstPreview.ownerId;
    conflictingPreview.provider = firstPreview.provider;
    conflictingPreview.bucket = firstPreview.bucket;
    conflictingPreview.objectKey = firstPreview.objectKey;
    conflictingPreview.checksumSha256 = 'b'.repeat(64);
    const savedConflict = await repository.savePreview(conflictingPreview);
    expect(repository.commitPreview('owner-a', savedConflict.id, 'Work', 'Recording')).rejects.toMatchObject({
      code: 'canonical_asset_conflict',
      status: 409
    });
  });
});
