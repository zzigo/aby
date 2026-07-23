import { api, ownerFor } from '$lib/server/errors';
import { executeMediaRelocation } from '$lib/server/media-relocation-executor';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => api('storage.operation.execute', async () => {
  await executeMediaRelocation(ownerFor(event), event.params.id);
  return { accepted: true, operationId: event.params.id };
});
