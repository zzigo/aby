import { basename, dirname } from 'node:path';
import { api, ownerFor } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { getRepository } from '$lib/server/repository';
import { getMediaRelocationRepository } from '$lib/server/media-relocation-repository';
import { audioDestinationPrefix, audioPathAnomalies, currentAudioPrefix } from '$lib/server/media-path';
import { proposeAvDestination } from '$lib/server/av-tree';
import type { CatalogItem } from '@zztt/aby-domain';
import type { RequestHandler } from './$types';

function slug(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 80) || 'unknown';
}

export const GET: RequestHandler = (event) => api('storage.board', async () => {
  const ownerId = ownerFor(event);
  const [catalog, videos, operations] = await Promise.all([
    getRepository().listCatalog(ownerId),
    getAvRepository().listItems(ownerId),
    getMediaRelocationRepository().list(ownerId)
  ]);
  const latest = new Map<string, (typeof operations)[number]>();
  for (const operation of operations) {
    const key = `${operation.mediaKind}:${operation.entityType}:${operation.entityId}`;
    if (!latest.has(key)) latest.set(key, operation);
  }
  const groups = new Map<string, CatalogItem[]>();
  for (const item of catalog) {
    const id = item.albumId ?? item.asset.workId;
    groups.set(id, [...(groups.get(id) ?? []), item]);
  }
  const audio = [...groups.entries()].map(([id, items]) => {
    const first = items[0]!;
    const metadata = first.asset.canonicalMetadata;
    const collectionCode = metadata.collectionCode || first.asset.objectKey.split('/')[2] || 'unsorted';
    const entitySlug = metadata.entitySlug || slug(first.creator || first.albumArtist || 'unknown');
    const container = metadata.albumSet?.title || first.albumTitle || first.workTitle;
    const destinationPrefix = audioDestinationPrefix({ collectionCode, entitySlug, container });
    const anomalies = [...new Set(items.flatMap((item) => audioPathAnomalies(item.asset.objectKey, collectionCode)))];
    if (items.some((item) => currentAudioPrefix(item.asset.objectKey) !== destinationPrefix)) anomalies.push('path differs from current metadata');
    const bookletCount = new Set(items.flatMap((item) =>
      (item.asset.canonicalMetadata.bookletPages ?? []).map((page) => page.objectKey)
    )).size;
    return {
      mediaKind: 'audio', entityType: first.albumId ? 'album' : 'work', entityId: id,
      title: first.albumTitle || first.workTitle, setTitle: metadata.albumSet?.title,
      collectionCode, entitySlug, container, sourcePrefix: currentAudioPrefix(first.asset.objectKey),
      destinationPrefix, fileCount: items.length + bookletCount,
      sizeBytes: items.reduce((total, item) => total + (item.asset.technicalMetadata.sizeBytes ?? 0), 0),
      anomalies: [...new Set(anomalies)],
      operation: latest.get(`audio:${first.albumId ? 'album' : 'work'}:${id}`) ?? null
    };
  });
  const video = videos.map((item) => {
    const proposal = proposeAvDestination({
      sourceObjectKey: item.sourceObjectKey, title: item.title, year: item.year,
      strategy: item.treeStrategy, treeValue: item.treeValue
    });
    return {
      mediaKind: 'video', entityType: 'av_item', entityId: item.id, title: item.title,
      collectionCode: item.treeStrategy, entitySlug: item.treeValue, container: basename(proposal),
      sourcePrefix: dirname(item.sourceObjectKey), destinationPrefix: proposal,
      fileCount: 1 + (item.technicalMetadata.sidecarSubtitles?.length ?? 0),
      sizeBytes: item.technicalMetadata.sizeBytes + (item.technicalMetadata.sidecarSubtitles ?? []).reduce((total, file) => total + file.sizeBytes, 0),
      anomalies: item.destinationObjectKey === proposal ? [] : ['destination differs from canonical proposal'],
      operation: latest.get(`video:av_item:${item.id}`) ?? null
    };
  });
  const cards = [...audio, ...video].sort((left, right) => left.title.localeCompare(right.title));
  return {
    cards, operations,
    collections: [...new Set(audio.map((card) => card.collectionCode))].sort(),
    summary: {
      total: cards.length, anomalies: cards.filter((card) => card.anomalies.length).length,
      active: operations.filter((operation) => ['copying', 'verifying', 'retiring'].includes(operation.state)).length,
      awaitingRetirement: operations.filter((operation) => operation.state === 'retirement_pending').length
    },
    cloneUrl: 'https://clone.zztt.org/'
  };
});
