import { api, ownerFor } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('av.operations.list', async () => ({
  operations: await getAvRepository().listOperations(ownerFor(event))
}));
