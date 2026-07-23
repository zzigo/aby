import { AbyError, api, jsonBody, ownerFor } from '$lib/server/errors';
import { executeMediaRelocation } from '$lib/server/media-relocation-executor';
import { getMediaRelocationRepository } from '$lib/server/media-relocation-repository';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => api('storage.operations.bulk-execute', async () => {
  const ownerId = ownerFor(event);
  const body = await jsonBody(event) as { operationIds?: unknown };
  if (!Array.isArray(body.operationIds) || !body.operationIds.length || body.operationIds.length > 50
    || !body.operationIds.every((id) => typeof id === 'string')) {
    throw new AbyError('invalid_relocation_batch', 'Choose between 1 and 50 saved plans', 400);
  }
  const repository = getMediaRelocationRepository();
  const uniqueIds = [...new Set(body.operationIds)];
  const operations = await Promise.all(uniqueIds.map((id) => repository.get(ownerId, id)));
  if (operations.some((operation) => !operation || !['draft', 'failed'].includes(operation.state))) {
    throw new AbyError('relocation_batch_not_ready', 'Every batch item must be a saved or retryable plan', 409);
  }
  for (const operation of operations) {
    await executeMediaRelocation(ownerId, operation!.id);
  }
  return { accepted: operations.length, operationIds: uniqueIds };
});
