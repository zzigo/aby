import { CaptureCreateSchema } from '@zztt/aby-domain';
import { AbyError, api, jsonBody, ownerFor } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('captures.list', async () => ({
  captures: await getAvRepository().listCaptures(ownerFor(event))
}));

export const POST: RequestHandler = (event) => api('captures.create', async () => {
  const ownerId = ownerFor(event);
  const input = CaptureCreateSchema.parse(await jsonBody(event));
  if (input.assetId && !await getRepository().getAsset(ownerId, input.assetId)) {
    throw new AbyError('asset_not_found', 'Asset not found', 404);
  }
  return { capture: await getAvRepository().createCapture(ownerId, input) };
});
