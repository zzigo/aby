import { AvCatalogCreateSchema } from '@zztt/aby-domain';
import { api, jsonBody, ownerFor } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { proposeAvDestination } from '$lib/server/av-tree';
import { readConfig } from '$lib/server/config';
import { assertSourceObjectKey, headWasabiSourceObject } from '$lib/server/storage';
import { getAvInspection } from '$lib/server/av-inspection';
import type { RequestHandler } from './$types';
import { basename, dirname } from 'node:path';

export const GET: RequestHandler = (event) => api('av.items.list', async () => ({
  items: await getAvRepository().listItems(ownerFor(event))
}));

export const POST: RequestHandler = (event) => api('av.items.create', async () => {
  const ownerId = ownerFor(event);
  const body = await jsonBody(event) as Record<string, unknown>;
  const inspectionId = typeof body.inspectionId === 'string' ? body.inspectionId : '';
  const input = AvCatalogCreateSchema.parse(body);
  const config = readConfig();
  const sourceObjectKey = assertSourceObjectKey(input.sourceObjectKey, [config.sourceVideoPrefix]);
  const destinationObjectKey = proposeAvDestination({
    sourceObjectKey, title: input.title, year: input.year, strategy: input.treeStrategy, treeValue: input.treeValue
  });
  const head = await headWasabiSourceObject(sourceObjectKey);
  const inspection = inspectionId ? getAvInspection(ownerId, inspectionId, sourceObjectKey) : null;
  const sidecarSubtitles = (inspection?.sidecarSubtitles ?? []).map((sidecar) => ({
    ...sidecar,
    destinationObjectKey: `${dirname(destinationObjectKey)}/${basename(sidecar.sourceObjectKey)}`
  }));
  const created = await getAvRepository().createItem(ownerId, config.WASABI_BUCKET!, {
    ...input, sourceObjectKey, destinationObjectKey
  }, {
    ...(inspection?.technicalMetadata ?? {}),
    sizeBytes: head.sizeBytes ?? inspection?.technicalMetadata.sizeBytes ?? 0,
    ...(head.contentType ? { contentType: head.contentType } : {}),
    ...(head.etag ? { etag: head.etag } : {}),
    ...(sidecarSubtitles.length ? { sidecarSubtitles } : {})
  });
  return { ...created, copied: false, message: 'Metadata cataloged. Bytes remain in mov/ until EXECUTE.' };
});
