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
      assetId: asset.id, startTimeMs: 100, endTimeMs: 400, channelSelection: [], fadeInMs: 0, fadeOutMs: 0,
      sourceContext: 'mobile_draft'
    }, { method: 'human', source: 'test', actorId: 'owner-a', parameters: {}, timestamp: new Date().toISOString(), reviewState: 'accepted' });
    expect(segment.endTimeMs).toBe(400);
    expect(segment.sourceContext).toBe('mobile_draft');
    const catalog = await repository.listCatalog('owner-a');
    expect(catalog[0]?.workTitle).toBe('Accepted work');
    expect(catalog[0]?.segments[0]?.startTimeMs).toBe(100);
    expect(catalog[0]?.segments[0]?.sourceContext).toBe('mobile_draft');
  });

  test('does not leak assets across owners', async () => {
    const repository = new MemoryAbyRepository();
    const preview = await repository.savePreview(fixturePreview());
    const asset = await repository.commitPreview('owner-a', preview.id, 'Work', 'Recording');
    expect(await repository.getAsset('owner-b', asset.id)).toBeNull();
  });

  test('keeps an optional album between work and track and supports soft deletion', async () => {
    const repository = new MemoryAbyRepository();
    const preview = await repository.savePreview(fixturePreview());
    const asset = await repository.commitPreview('owner-a', preview.id, 'Work', 'Track', 'Album');
    const [item] = await repository.listCatalog('owner-a');
    expect(item?.workTitle).toBe('Work');
    expect(item?.albumTitle).toBe('Album');
    expect(item?.recordingTitle).toBe('Track');
    await repository.softDeleteAsset('owner-a', asset.id);
    expect(await repository.listCatalog('owner-a')).toHaveLength(0);
  });

  test('sanitizes numeric prefixes at commit and edit boundaries', async () => {
    const repository = new MemoryAbyRepository();
    const preview = await repository.savePreview(fixturePreview());
    const asset = await repository.commitPreview('owner-a', preview.id, 'Work', '07 Initial title');
    let item = await repository.getCatalogItem('owner-a', asset.id);
    expect(item?.recordingTitle).toBe('Initial title');
    expect(item?.trackNumber).toBe(7);
    item = await repository.updateCatalogItem('owner-a', asset.id, {
      workTitle: 'Work', recordingTitle: '12 — Edited title', tags: ['solo']
    });
    expect(item.recordingTitle).toBe('Edited title');
    expect(item.trackNumber).toBe(12);
    expect(item.asset.canonicalMetadata.tags).toEqual(['solo']);
  });

  test('commits individual titles for every track in a collective folder', async () => {
    const repository = new MemoryAbyRepository();
    const collective = fixturePreview();
    collective.candidateMetadata.tracks = [
      {
        objectKey: collective.objectKey, canonicalObjectKey: collective.objectKey,
        originalFilename: '01. FIRST.wav', checksumSha256: collective.checksumSha256,
        technicalMetadata: collective.technicalMetadata, recordingTitle: 'FIRST', trackNumber: 1
      },
      {
        objectKey: 'aby/aud/demo/02-SECOND.wav', canonicalObjectKey: 'aby/aud/demo/02-SECOND.wav',
        originalFilename: '02. SECOND.wav', checksumSha256: 'b'.repeat(64),
        technicalMetadata: collective.technicalMetadata, recordingTitle: 'SECOND', trackNumber: 2
      }
    ];
    const preview = await repository.savePreview(collective);
    await repository.commitPreview('owner-a', preview.id, 'Collective work', 'FIRST', 'Album', undefined, undefined, undefined, undefined, undefined, [
      { objectKey: collective.objectKey, recordingTitle: 'First edited', trackNumber: 1 },
      { objectKey: 'aby/aud/demo/02-SECOND.wav', recordingTitle: 'Second edited', trackNumber: 2 }
    ]);
    const catalog = await repository.listCatalog('owner-a');
    expect(catalog.map((item) => item.recordingTitle)).toEqual(['First edited', 'Second edited']);
  });

  test('updates album metadata and cover across every track', async () => {
    const repository = new MemoryAbyRepository();
    const collective = fixturePreview();
    collective.candidateMetadata.tracks = [
      {
        objectKey: collective.objectKey, canonicalObjectKey: collective.objectKey,
        originalFilename: '01.wav', checksumSha256: collective.checksumSha256,
        technicalMetadata: collective.technicalMetadata, recordingTitle: 'One', trackNumber: 1
      },
      {
        objectKey: 'aby/aud/demo/02.wav', canonicalObjectKey: 'aby/aud/demo/02.wav',
        originalFilename: '02.wav', checksumSha256: 'b'.repeat(64),
        technicalMetadata: collective.technicalMetadata, recordingTitle: 'Two', trackNumber: 2
      }
    ];
    const preview = await repository.savePreview(collective);
    await repository.commitPreview('owner-a', preview.id, 'Work', 'One', 'Album', 'Artist', undefined, '2007', undefined, undefined, [
      { objectKey: collective.objectKey, recordingTitle: 'One', trackNumber: 1 },
      { objectKey: 'aby/aud/demo/02.wav', recordingTitle: 'Two', trackNumber: 2 }
    ]);
    const initial = await repository.listCatalog('owner-a');
    const albumId = initial[0]!.albumId!;

    const updated = await repository.applyAlbumMetadata('owner-a', albumId, {
      title: 'Sind', albumArtist: 'Axel Dörner', releaseDate: '2007',
      label: 'absinthRecords', catalogNumber: 'absinthRecords 010', albumDurationMs: 252_000,
      albumTags: ['Free Improvisation'], genres: ['Jazz'], styles: ['Free Improvisation'],
      roles: [{ name: 'Axel Dörner', role: 'Trumpet' }]
    }, {
      imageCandidates: [{
        authority: 'discogs', url: 'https://i.discogs.com/sind.jpeg', kind: 'cover',
        exactRelease: true, sourceId: '1229980', provenance: {}
      }]
    });

    expect(updated).toHaveLength(2);
    expect(updated.map((item) => item.recordingTitle)).toEqual(['One', 'Two']);
    for (const item of updated) {
      expect(item.albumTitle).toBe('Sind');
      expect(item.albumArtist).toBe('Axel Dörner');
      expect(item.creator).toBe('Artist');
      expect(item.label).toBe('absinthRecords');
      expect(item.coverUrl).toBe('https://i.discogs.com/sind.jpeg');
      expect(item.asset.canonicalMetadata.albumDurationMs).toBe(252_000);
      expect(item.asset.canonicalMetadata.albumTags).toEqual(['Free Improvisation']);
      expect(item.asset.canonicalMetadata.roles).toEqual([{ name: 'Axel Dörner', role: 'Trumpet' }]);
    }
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
