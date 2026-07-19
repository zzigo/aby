import { AbyError, api, jsonBody, ownerFor } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('workspace.list', async () => {
  const ownerId = ownerFor(event);
  const [catalog, avItems, captures, operations] = await Promise.all([
    getRepository().listCatalog(ownerId), getAvRepository().listItems(ownerId),
    getAvRepository().listCaptures(ownerId), getAvRepository().listOperations(ownerId)
  ]);
  const operationByItem = new Map(operations.map((operation) => [operation.avItemId, operation]));
  const rows = [
    ...catalog.map((item) => ({
      id: item.asset.id, type: 'item', media: item.asset.technicalMetadata.videoCodec ? 'video' : 'audio',
      title: item.recordingTitle, work: item.workTitle, creator: item.creator ?? item.albumArtist ?? '',
      year: item.releaseDate?.slice(0, 4) ?? '', state: 'available', source: item.asset.objectKey,
      destination: item.asset.objectKey, sizeBytes: item.asset.technicalMetadata.sizeBytes ?? 0,
      durationMs: item.asset.technicalMetadata.durationMs, tags: item.asset.canonicalMetadata.tags ?? [],
      externalIds: Object.fromEntries((item.asset.canonicalMetadata.identificationCandidates ?? []).map((candidate) => [candidate.authority, candidate.externalId])),
      createdAt: item.asset.createdAt
    })),
    ...catalog.flatMap((item) => item.segments.map((segment) => ({
      id: segment.id, type: 'capture-fragment', media: item.asset.technicalMetadata.videoCodec ? 'video' : 'audio',
      title: segment.label ?? `${item.recordingTitle} fragment`, work: item.workTitle, creator: item.creator ?? '',
      year: item.releaseDate?.slice(0, 4) ?? '', state: 'accepted', source: item.asset.objectKey, destination: '',
      sizeBytes: 0, durationMs: segment.endTimeMs - segment.startTimeMs, tags: [], externalIds: {}, createdAt: item.asset.createdAt
    }))),
    ...avItems.map((item) => {
      const operation = operationByItem.get(item.id);
      return {
        id: item.id, type: 'item', media: 'video', title: item.title, work: item.originalTitle ?? item.title,
        creator: item.director ?? item.entity ?? '', year: item.year ?? '', state: item.state,
        source: item.sourceObjectKey, destination: item.destinationObjectKey, sizeBytes: item.technicalMetadata.sizeBytes,
        durationMs: item.technicalMetadata.durationMs ?? 0, tags: [item.kind, item.treeStrategy, item.treeValue],
        externalIds: item.externalIds, createdAt: item.createdAt,
        operation: operation ? { id: operation.id, state: operation.state, transferredBytes: operation.transferredBytes, speedBytesPerSecond: operation.speedBytesPerSecond, etaSeconds: operation.etaSeconds, beaconAt: operation.beaconAt } : null
      };
    }),
    ...captures.map((capture) => ({
      id: capture.id, type: 'capture-fragment', media: capture.mediaKind, title: capture.label ?? 'Untitled capture', work: '', creator: '', year: '',
      state: 'shared', source: capture.assetId ?? capture.avItemId ?? '', destination: capture.shareUrl,
      sizeBytes: 0, durationMs: capture.endTimeMs - capture.startTimeMs, tags: [], externalIds: {}, createdAt: capture.createdAt
    }))
  ];
  return { rows, columns: ['type','media','title','work','creator','year','state','source','destination','sizeBytes','durationMs','tags','externalIds','createdAt','operation'] };
});

export const PATCH: RequestHandler = (event) => api('workspace.bulk-edit', async () => {
  const ownerId = ownerFor(event);
  const body = await jsonBody(event) as { ids?: unknown; field?: unknown; value?: unknown };
  if (!Array.isArray(body.ids) || !body.ids.every((id) => typeof id === 'string') || body.ids.length > 500) throw new AbyError('invalid_workspace_selection', 'Select up to 500 rows', 400);
  if (!['title','creator','tags'].includes(String(body.field)) || typeof body.value !== 'string') throw new AbyError('invalid_workspace_edit', 'Unsupported bulk field', 400);
  let updated = 0; let skipped = 0;
  for (const id of body.ids) {
    const avItem = await getAvRepository().getItem(ownerId, id);
    if (avItem) {
      if (body.field === 'title') await getAvRepository().updateItemMetadata(ownerId, id, { title: body.value.trim() });
      else if (body.field === 'creator') await getAvRepository().updateItemMetadata(ownerId, id, { director: body.value.trim() });
      else { skipped += 1; continue; }
      updated += 1; continue;
    }
    const item = await getRepository().getCatalogItem(ownerId, id);
    if (!item) { skipped += 1; continue; }
    await getRepository().updateCatalogItem(ownerId, id, {
      workTitle: item.workTitle, albumTitle: item.albumTitle ?? null,
      recordingTitle: body.field === 'title' ? body.value.trim() : item.recordingTitle,
      trackNumber: item.trackNumber ?? null,
      creator: body.field === 'creator' ? body.value.trim() : item.creator ?? null,
      releaseDate: item.releaseDate ?? null, label: item.label ?? null,
      tags: body.field === 'tags' ? body.value.split(',').map((tag) => tag.trim()).filter(Boolean) : item.asset.canonicalMetadata.tags ?? []
    });
    updated += 1;
  }
  return { updated, skipped };
});
