import { TrackEditSchema } from '@zztt/aby-domain';
import { api, AbyError, jsonBody, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('asset.detail', async () => {
  const item = await getRepository().getCatalogItem(ownerFor(event), event.params.id);
  if (!item) throw new AbyError('asset_not_found', 'Asset not found', 404);
  return { item };
});

export const PATCH: RequestHandler = (event) => api('asset.update', async () => ({
  item: await getRepository().updateCatalogItem(
    ownerFor(event), event.params.id, TrackEditSchema.parse(await jsonBody(event))
  )
}));

export const DELETE: RequestHandler = (event) => api('asset.delete', async () => {
  await getRepository().softDeleteAsset(ownerFor(event), event.params.id);
  return { deleted: true };
});
