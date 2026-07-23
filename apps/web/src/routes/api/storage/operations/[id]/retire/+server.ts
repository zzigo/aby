import { api, ownerFor } from '$lib/server/errors';
import { retireMediaRelocation } from '$lib/server/media-relocation-executor';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => api('storage.operation.retire', async () => {
  await retireMediaRelocation(ownerFor(event), event.params.id);
  return { retired: true, operationId: event.params.id };
});
