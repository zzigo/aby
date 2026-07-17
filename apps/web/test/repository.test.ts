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
  });

  test('does not leak assets across owners', async () => {
    const repository = new MemoryAbyRepository();
    const preview = await repository.savePreview(fixturePreview());
    const asset = await repository.commitPreview('owner-a', preview.id, 'Work', 'Recording');
    expect(await repository.getAsset('owner-b', asset.id)).toBeNull();
  });
});
