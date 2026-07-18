import { describe, expect, test } from 'bun:test';
import type { SourceRetirementCandidate } from '../src/lib/server/repository';
import { groupSourceRetirementCandidates } from '../src/lib/server/source-retirement';

function candidate(input: Partial<SourceRetirementCandidate> & Pick<SourceRetirementCandidate, 'id' | 'sourceObjectKey' | 'canonicalObjectKey'>): SourceRetirementCandidate {
  return {
    provider: 'wasabi',
    bucket: 'untref-licmusica',
    checksumSha256: 'a'.repeat(64),
    state: 'candidate',
    provenance: {
      method: 'human', source: 'test', actorId: 'owner', parameters: {}, timestamp: new Date().toISOString(),
      sourceAssetChecksum: 'a'.repeat(64), reviewState: 'candidate'
    },
    canonicalAssetId: `asset-${input.id}`,
    canonicalSizeBytes: 1_000,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    ...input
  };
}

describe('source retirement grouping', () => {
  test('groups copied objects by their human-readable source folder and sums sizes', () => {
    const folders = groupSourceRetirementCandidates([
      candidate({ id: '1', sourceObjectKey: 'ref/20 late/Composer/Album/01.mp3', canonicalObjectKey: 'aby/aud/20L/composer/work/album/01.mp3' }),
      candidate({ id: '2', sourceObjectKey: 'ref/20 late/Composer/Album/02.mp3', canonicalObjectKey: 'aby/aud/20L/composer/work/album/02.mp3', canonicalSizeBytes: 2_000 })
    ]);
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({ folder: 'ref/20 late/Composer/Album', objectCount: 2, canonicalCount: 2, sizeBytes: 3_000, sizeComplete: true, state: 'candidate' });
  });

  test('only exposes delete-ready state when every row shares a current verification', () => {
    const retirementVerification = {
      verificationId: 'same-run', checkedAt: new Date().toISOString(), folder: 'ref/Impro/Sind'
    };
    const folders = groupSourceRetirementCandidates([
      candidate({ id: '1', sourceObjectKey: 'ref/Impro/Sind/01.mp3', canonicalObjectKey: 'aby/aud/20L/impro/sind/01.mp3', state: 'approved', provenance: { method: 'human', source: 'test', actorId: 'owner', parameters: {}, timestamp: new Date().toISOString(), sourceAssetChecksum: 'a'.repeat(64), reviewState: 'candidate', retirementVerification } }),
      candidate({ id: '2', sourceObjectKey: 'ref/Impro/Sind/02.mp3', canonicalObjectKey: 'aby/aud/20L/impro/sind/02.mp3', state: 'approved', provenance: { method: 'human', source: 'test', actorId: 'owner', parameters: {}, timestamp: new Date().toISOString(), sourceAssetChecksum: 'a'.repeat(64), reviewState: 'candidate', retirementVerification } })
    ]);
    expect(folders[0].state).toBe('verified');
    expect(folders[0].checkedAt).toBe(retirementVerification.checkedAt);
  });

  test('blocks a row whose canonical catalog asset no longer resolves', () => {
    const folders = groupSourceRetirementCandidates([
      candidate({ id: '1', sourceObjectKey: 'ref/20 early/Missing/01.mp3', canonicalObjectKey: 'aby/aud/20E/missing/01.mp3', canonicalAssetId: undefined, canonicalSizeBytes: undefined })
    ]);
    expect(folders[0]).toMatchObject({ state: 'blocked', canonicalCount: 0, sizeComplete: false });
  });
});
