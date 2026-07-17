import { api, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('catalog.list', async () => ({
  items: await getRepository().listCatalog(ownerFor(event))
}));
