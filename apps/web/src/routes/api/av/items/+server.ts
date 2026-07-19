import { AvCatalogCreateSchema } from '@zztt/aby-domain';
import { api, jsonBody, ownerFor } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { proposeAvDestination } from '$lib/server/av-tree';
import { readConfig } from '$lib/server/config';
import { assertSourceObjectKey, headWasabiSourceObject } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('av.items.list', async () => ({
  items: await getAvRepository().listItems(ownerFor(event))
}));

export const POST: RequestHandler = (event) => api('av.items.create', async () => {
  const ownerId = ownerFor(event);
  const input = AvCatalogCreateSchema.parse(await jsonBody(event));
  const config = readConfig();
  const sourceObjectKey = assertSourceObjectKey(input.sourceObjectKey, [config.sourceVideoPrefix]);
  const destinationObjectKey = proposeAvDestination({
    sourceObjectKey, title: input.title, year: input.year, strategy: input.treeStrategy, treeValue: input.treeValue
  });
  const head = await headWasabiSourceObject(sourceObjectKey);
  const created = await getAvRepository().createItem(ownerId, config.WASABI_BUCKET!, {
    ...input, sourceObjectKey, destinationObjectKey
  }, {
    sizeBytes: head.sizeBytes ?? 0,
    ...(head.contentType ? { contentType: head.contentType } : {}),
    ...(head.etag ? { etag: head.etag } : {})
  });
  return { ...created, copied: false, message: 'Metadata cataloged. Bytes remain in mov/ until EXECUTE.' };
});
