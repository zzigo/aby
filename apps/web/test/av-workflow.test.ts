import { describe, expect, test } from 'bun:test';
import { MemoryAvRepository, postgresJson } from '../src/lib/server/av-repository';

describe('deferred AV catalog workflow', () => {
  test('serializes every array as JSONB rather than a PostgreSQL array literal', () => {
    expect(postgresJson(['ru', 'en'])).toBe('["ru","en"]');
    expect(postgresJson([{ name: 'Andrei Tarkovsky', role: 'Director', externalIds: {} }])).toBe('[{"name":"Andrei Tarkovsky","role":"Director","externalIds":{}}]');
  });

  test('catalogs metadata and creates a pending copy without promoting bytes', async () => {
    const repository = new MemoryAvRepository();
    const created = await repository.createItem('owner-a', 'zzttuntref', {
      sourceObjectKey: 'mov/Stalker.mkv', destinationObjectKey: 'aby/mov/1970s/tarkovsky/1979-Stalker/stalker.mkv',
      title: 'Stalker', kind: 'film', year: 1979, director: 'Andrei Tarkovsky', countries: ['SU'], languages: ['ru'], tags: [], credits: [],
      externalIds: { imdb: 'tt0079944' }, metadataSources: [], treeStrategy: 'author', treeValue: 'Andrei Tarkovsky'
    }, { sizeBytes: 1_000_000, contentType: 'video/x-matroska', etag: 'source-etag' });

    expect(created.item.sourceObjectKey).toBe('mov/Stalker.mkv');
    expect(created.item.state).toBe('queued');
    expect(created.operation.state).toBe('pending');
    expect(created.operation.transferredBytes).toBe(0);
  });

  test('keeps neighboring subtitles in the same deferred copy total', async () => {
    const repository = new MemoryAvRepository();
    const created = await repository.createItem('owner-a', 'zzttuntref', {
      sourceObjectKey: 'mov/Frances Ha/Frances.Ha.mkv', destinationObjectKey: 'aby/mov/gerwig/2012-Frances Ha/Frances.Ha.mkv',
      title: 'Frances Ha', kind: 'film', year: 2012, countries: ['US'], languages: ['en'], tags: [], credits: [],
      externalIds: {}, metadataSources: [], treeStrategy: 'author', treeValue: 'Gerwig'
    }, {
      sizeBytes: 1_000, sidecarSubtitles: [{
        sourceObjectKey: 'mov/Frances Ha/Frances.Ha.es.srt', destinationObjectKey: 'aby/mov/gerwig/2012-Frances Ha/Frances.Ha.es.srt',
        language: 'es', sizeBytes: 125
      }]
    });
    expect(created.item.technicalMetadata.sidecarSubtitles?.[0]?.language).toBe('es');
    expect(created.operation.sizeBytes).toBe(1_125);
  });

  test('creates an immutable-time share capture for a staged video', async () => {
    const repository = new MemoryAvRepository();
    const { item } = await repository.createItem('owner-a', 'zzttuntref', {
      sourceObjectKey: 'mov/film.mp4', destinationObjectKey: 'aby/mov/2000s/author/2001-Film/film.mp4',
      title: 'Film', kind: 'film', year: 2001, countries: [], languages: [], tags: [], credits: [], externalIds: {}, metadataSources: [], treeStrategy: 'author', treeValue: 'Author'
    }, { sizeBytes: 10 });
    const capture = await repository.createCapture('owner-a', {
      mediaKind: 'video', avItemId: item.id, startTimeMs: 3_000, endTimeMs: 6_000,
      label: 'Montage note', annotations: []
    });
    expect(capture.shareUrl).toBe(`/share/${capture.shareToken}`);
    expect(capture.endTimeMs - capture.startTimeMs).toBe(3_000);
  });
});
