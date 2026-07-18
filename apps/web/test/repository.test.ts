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

  test('stores lyrics as revisioned timed text without bloating catalog rows', async () => {
    const repository = new MemoryAbyRepository();
    const preview = await repository.savePreview(fixturePreview());
    const asset = await repository.commitPreview('owner-a', preview.id, 'Work', 'Song', 'Album', 'Artist');
    const retrievedAt = new Date().toISOString();
    await repository.saveTimedText('owner-a', asset.id, {
      provider: 'lrclib', providerItemId: '12', textType: 'lyrics', language: 'en',
      originalFormat: 'lrc', syncLevel: 'line', originalText: '[00:01.00] First', plainText: 'First',
      offsetMs: 0, timeScale: 1, matchConfidence: 0.98, humanVerified: true,
      licenseStatus: 'external-provider', retrievedAt,
      cues: [{ position: 0, startMs: 1000, endMs: null, text: 'First', speaker: null, words: [] }]
    });
    await repository.saveTimedText('owner-a', asset.id, {
      provider: 'manual', providerItemId: null, textType: 'lyrics', language: 'en',
      originalFormat: 'plain', syncLevel: 'none', originalText: 'Corrected', plainText: 'Corrected',
      offsetMs: 0, timeScale: 1, matchConfidence: null, humanVerified: true,
      licenseStatus: 'user-provided', retrievedAt, cues: []
    });
    expect((await repository.getTimedText('owner-a', asset.id, 'lyrics'))?.plainText).toBe('Corrected');
    const [item] = await repository.listCatalog('owner-a');
    expect(item?.hasLyrics).toBe(true);
    expect('plainText' in (item as unknown as Record<string, unknown>)).toBe(false);
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
      roles: [{ name: 'Axel Dörner', role: 'Trumpet' }], notes: 'Release notes'
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
      expect(item.coverUrl).toBe(`/api/assets/${item.asset.id}/cover?delivery=2&v=1229980`);
      expect(item.asset.canonicalMetadata.albumDurationMs).toBe(252_000);
      expect(item.asset.canonicalMetadata.albumTags).toEqual(['Free Improvisation']);
      expect(item.asset.canonicalMetadata.roles).toEqual([{ name: 'Axel Dörner', role: 'Trumpet' }]);
      expect(item.asset.canonicalMetadata.albumNotes).toBe('Release notes');
    }
  });

  test('bulk edits album track names and numbers atomically', async () => {
    const repository = new MemoryAbyRepository();
    const collective = fixturePreview();
    collective.candidateMetadata.tracks = [
      {
        objectKey: collective.objectKey, canonicalObjectKey: collective.objectKey,
        originalFilename: 'feldman - album - 01 - one.wav', checksumSha256: collective.checksumSha256,
        technicalMetadata: collective.technicalMetadata, recordingTitle: 'feldman - album - 01 - one'
      },
      {
        objectKey: 'aby/aud/demo/two.wav', canonicalObjectKey: 'aby/aud/demo/two.wav',
        originalFilename: 'feldman - album - 02 - two.wav', checksumSha256: 'b'.repeat(64),
        technicalMetadata: collective.technicalMetadata, recordingTitle: 'feldman - album - 02 - two'
      }
    ];
    await repository.commitPreview('owner-a', (await repository.savePreview(collective)).id, 'Work', 'One', 'Album', 'Feldman');
    const initial = await repository.listCatalog('owner-a');
    const updated = await repository.updateAlbum('owner-a', initial[0]!.albumId!, {
      title: 'Album',
      collectionCode: 'ens',
      tracks: initial.map((item, index) => ({
        assetId: item.asset.id,
        recordingTitle: index === 0 ? 'One' : 'Two',
        trackNumber: index + 1
      }))
    });
    expect(updated.map((item) => [item.trackNumber, item.recordingTitle])).toEqual([[1, 'One'], [2, 'Two']]);
    expect(updated.every((item) => item.asset.canonicalMetadata.collectionCode === 'ens')).toBe(true);
  });

  test('relocates canonical identity while retaining a verified cleanup candidate', async () => {
    const repository = new MemoryAbyRepository();
    const preview = await repository.savePreview(fixturePreview());
    const asset = await repository.commitPreview('owner-a', preview.id, 'Work', 'Track', 'Album');
    const target = 'aby/aud/18/schubert/Work/Album/01.wav';
    const moved = await repository.relocateAsset('owner-a', asset.id, asset.objectKey, target, '18', 'schubert');
    expect(moved.asset.objectKey).toBe(target);
    expect(moved.asset.canonicalMetadata.collectionCode).toBe('18');
    expect(moved.asset.canonicalMetadata.entitySlug).toBe('schubert');
    expect(moved.asset.canonicalMetadata.storageRetirementCandidates?.[0]).toMatchObject({
      sourceObjectKey: asset.objectKey, targetObjectKey: target, checksumSha256: asset.checksumSha256, state: 'candidate'
    });
    expect(await repository.objectKeyInUse(asset.objectKey)).toBe(false);
    expect(await repository.objectKeyInUse(target)).toBe(true);
  });

  test('propagates an album title edited from a track to its album siblings', async () => {
    const repository = new MemoryAbyRepository();
    const collective = fixturePreview();
    collective.candidateMetadata.tracks = [
      { objectKey: collective.objectKey, canonicalObjectKey: collective.objectKey, originalFilename: '01.wav', checksumSha256: collective.checksumSha256, technicalMetadata: collective.technicalMetadata, recordingTitle: 'One', trackNumber: 1 },
      { objectKey: 'aby/aud/demo/02.wav', canonicalObjectKey: 'aby/aud/demo/02.wav', originalFilename: '02.wav', checksumSha256: 'b'.repeat(64), technicalMetadata: collective.technicalMetadata, recordingTitle: 'Two', trackNumber: 2 }
    ];
    const preview = await repository.savePreview(collective);
    await repository.commitPreview('owner-a', preview.id, 'Work', 'One', 'Old album');
    const items = await repository.listCatalog('owner-a');
    await repository.updateCatalogItem('owner-a', items[0]!.asset.id, {
      workTitle: 'Work', albumTitle: 'Canonical album', recordingTitle: 'One'
    });
    expect((await repository.listCatalog('owner-a')).map((item) => item.albumTitle)).toEqual(['Canonical album', 'Canonical album']);
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
