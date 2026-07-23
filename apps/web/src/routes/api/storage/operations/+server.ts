import { basename, dirname, extname } from 'node:path';
import { api, jsonBody, ownerFor, AbyError } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import { getAvRepository } from '$lib/server/av-repository';
import { discoverAvSidecars } from '$lib/server/av-inspection';
import { getMediaRelocationRepository } from '$lib/server/media-relocation-repository';
import { audioTargetObjectKey, currentAudioPrefix, validateAudioDestinationPrefix } from '$lib/server/media-path';
import { assertAbyObjectKey, headWasabiObject, normalizeObjectKey } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('storage.operations.list', async () => ({
  operations: await getMediaRelocationRepository().list(ownerFor(event))
}));

export const DELETE: RequestHandler = (event) => api('storage.operations.clear-stopped', async () => (
  getMediaRelocationRepository().clearUntouchedStopped(ownerFor(event))
));

export const POST: RequestHandler = (event) => api('storage.operations.plan', async () => {
  const ownerId = ownerFor(event);
  const body = await jsonBody(event) as Record<string, unknown>;
  if (typeof body.mediaKind !== 'string' || typeof body.entityId !== 'string' || typeof body.destinationPrefix !== 'string') {
    throw new AbyError('invalid_relocation_plan', 'Media kind, entity and destination are required', 400);
  }
  if (body.mediaKind === 'audio') {
    const catalog = await getRepository().listCatalog(ownerId);
    const items = catalog.filter((item) => (item.albumId ?? item.asset.workId) === body.entityId);
    if (!items.length) throw new AbyError('audio_entity_not_found', 'Album or work not found', 404);
    const destinationPrefix = validateAudioDestinationPrefix(body.destinationPrefix);
    const [, , collectionCode, entitySlug] = destinationPrefix.split('/');
    const destinations = new Set<string>();
    const mediaFiles = items.map((item) => {
      const destinationObjectKey = audioTargetObjectKey(destinationPrefix, item);
      if (destinations.has(destinationObjectKey)) {
        throw new AbyError('audio_destination_conflict', `Two tracks resolve to ${destinationObjectKey}`, 409);
      }
      destinations.add(destinationObjectKey);
      return {
        assetId: item.asset.id, role: 'media' as const, sourceObjectKey: item.asset.objectKey,
        destinationObjectKey, sizeBytes: item.asset.technicalMetadata.sizeBytes ?? 0,
        expectedChecksumSha256: item.asset.checksumSha256, state: 'planned' as const
      };
    }).filter((file) => file.sourceObjectKey !== file.destinationObjectKey);
    const bookletPages = [...new Map(items.flatMap((item) => item.asset.canonicalMetadata.bookletPages ?? [])
      .map((page) => [page.objectKey, page])).values()];
    const bookletFiles = await Promise.all(bookletPages.map(async (page) => {
      const destinationObjectKey = `${destinationPrefix}/${basename(page.objectKey)}`;
      if (destinations.has(destinationObjectKey)) {
        throw new AbyError('audio_destination_conflict', `A booklet and track resolve to ${destinationObjectKey}`, 409);
      }
      destinations.add(destinationObjectKey);
      const source = await headWasabiObject(page.objectKey);
      return {
        role: 'booklet' as const, sourceObjectKey: page.objectKey, destinationObjectKey,
        sizeBytes: source.sizeBytes ?? 0, state: 'planned' as const
      };
    }));
    const files = [...mediaFiles, ...bookletFiles.filter((file) => file.sourceObjectKey !== file.destinationObjectKey)];
    if (!files.length) {
      throw new AbyError('audio_already_canonical', 'Every track already uses this canonical destination', 409);
    }
    const first = items[0]!;
    return {
      operation: await getMediaRelocationRepository().create(ownerId, {
        mediaKind: 'audio', entityType: first.albumId ? 'album' : 'work',
        entityId: body.entityId, title: first.albumTitle || first.workTitle,
        sourcePrefix: currentAudioPrefix(first.asset.objectKey), destinationPrefix,
        collectionCode: collectionCode!, entitySlug: entitySlug!, files,
        pattern: { version: 1, template: 'aby/aud/<collection>/<entity>/<album-or-set>/<track>' }
      })
    };
  }
  if (body.mediaKind !== 'video') throw new AbyError('invalid_media_kind', 'Media kind must be audio or video', 400);
  const item = await getAvRepository().getItem(ownerId, body.entityId);
  if (!item) throw new AbyError('av_item_not_found', 'AV item not found', 404);
  const destinationObjectKey = assertAbyObjectKey(normalizeObjectKey(body.destinationPrefix), 'aby/mov/');
  if (!extname(destinationObjectKey) || destinationObjectKey.endsWith('/')) {
    throw new AbyError('invalid_video_destination', 'Video destinations include the final filename and extension', 400);
  }
  const sidecars = item.technicalMetadata.sidecarSubtitles ?? await discoverAvSidecars(item.sourceObjectKey);
  const destinationDirectory = dirname(destinationObjectKey);
  const files = [
    {
      role: 'media' as const, sourceObjectKey: item.sourceObjectKey, destinationObjectKey,
      sizeBytes: item.technicalMetadata.sizeBytes, state: 'planned' as const
    },
    ...sidecars.map((sidecar) => ({
      role: 'subtitle' as const, sourceObjectKey: sidecar.sourceObjectKey,
      destinationObjectKey: `${destinationDirectory}/${basename(sidecar.sourceObjectKey)}`,
      sizeBytes: sidecar.sizeBytes, state: 'planned' as const
    }))
  ].filter((file) => file.sourceObjectKey !== file.destinationObjectKey);
  if (!files.length) {
    throw new AbyError('video_already_canonical', 'The video and its sidecars already use this destination', 409);
  }
  return {
    operation: await getMediaRelocationRepository().create(ownerId, {
      mediaKind: 'video', entityType: 'av_item', entityId: item.id, title: item.title,
      sourcePrefix: dirname(item.sourceObjectKey), destinationPrefix: destinationObjectKey,
      collectionCode: item.treeStrategy, entitySlug: item.treeValue, files,
      pattern: { version: 1, template: 'aby/mov/<criterion>/<year>-<title>.<ext>' }
    })
  };
});
