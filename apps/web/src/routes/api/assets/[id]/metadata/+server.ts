import { api, ownerFor } from '$lib/server/errors';
import { regenerateAssetMetadata } from '$lib/server/asset-metadata';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => api('asset.metadata.regenerate', async () => ({
  item: await regenerateAssetMetadata(ownerFor(event), event.params.id, getRepository())
}));
