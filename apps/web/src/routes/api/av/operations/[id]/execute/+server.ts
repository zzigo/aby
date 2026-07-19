import { api, ownerFor } from '$lib/server/errors';
import { executeStorageOperation } from '$lib/server/av-operations';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => api('av.operation.execute', async () => {
  const ownerId = ownerFor(event);
  await executeStorageOperation(ownerId, event.params.id);
  return { accepted: true, operationId: event.params.id };
});
