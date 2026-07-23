import { describe, expect, test } from 'bun:test';
import type { CatalogItem } from '@zztt/aby-domain';
import {
  audioDestinationPrefix, audioPathAnomalies, audioTargetObjectKey,
  composerSurnameSlug, validateAudioDestinationPrefix
} from '../src/lib/server/media-path';

function item(objectKey: string): CatalogItem {
  return {
    asset: {
      id: '11111111-1111-4111-8111-111111111111',
      ownerId: 'owner', workId: '22222222-2222-4222-8222-222222222222',
      recordingId: '33333333-3333-4333-8333-333333333333',
      provider: 'wasabi', objectKey, originalFilename: '01-Gute Nacht.mp3',
      checksumSha256: 'a'.repeat(64), technicalMetadata: { durationMs: 1_000, formatName: 'mp3', tags: {} },
      canonicalMetadata: { title: 'Winterreise', recordingTitle: '01 Gute Nacht', trackNumber: 1 },
      provenance: {
        method: 'human', source: 'test', actorId: 'owner', parameters: {},
        reviewState: 'accepted', timestamp: new Date(0).toISOString()
      },
      createdAt: new Date(0).toISOString()
    },
    workTitle: 'Winterreise', recordingTitle: 'Gute Nacht', trackNumber: 1, segments: []
  };
}

describe('canonical media paths', () => {
  test('audio has one album-or-set container, never two album-like folders', () => {
    const prefix = audioDestinationPrefix({ collectionCode: '19', entitySlug: 'schubert', container: 'Winterreise I' });
    expect(prefix).toBe('aby/aud/19/schubert/Winterreise-I');
    expect(audioTargetObjectKey(prefix, item('aby/aud/19/schubert/old/old/01.mp3')))
      .toBe('aby/aud/19/schubert/Winterreise-I/01-Gute-Nacht.mp3');
    expect(validateAudioDestinationPrefix(prefix)).toBe(prefix);
    expect(validateAudioDestinationPrefix('/aby/audio/19/Schubert/Winterreise I/01-Gute Nacht.mp3'))
      .toBe('aby/aud/19/schubert/Winterreise-I');
  });

  test('the sanitizer identifies the legacy extra album layer', () => {
    expect(audioPathAnomalies('aby/aud/19/schubert/Winterreise-I/Winterreise-I/01.mp3', '19'))
      .toContain('redundant album folder layer');
    expect(audioPathAnomalies('aby/aud/19/schubert/Winterreise-I/01.mp3', '19')).toEqual([]);
  });

  test('composer folders use only the lowercase surname', () => {
    expect(composerSurnameSlug('Johann Sebastian Bach')).toBe('bach');
    expect(composerSurnameSlug('Jean-Luc Barrière')).toBe('barriere');
    expect(composerSurnameSlug('Bach, Johann Sebastian')).toBe('bach');
  });
});
