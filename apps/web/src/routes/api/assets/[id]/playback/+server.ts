import { api, AbyError, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import { playbackUrl } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('asset.playback', async () => {
  const asset = await getRepository().getAsset(ownerFor(event), event.params.id);
  if (!asset) throw new AbyError('asset_not_found', 'Asset not found', 404);
  return playbackUrl(asset);
});

