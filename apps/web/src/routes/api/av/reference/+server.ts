import { api, ownerFor } from '$lib/server/errors';
import { importAvReference } from '$lib/server/av-reference';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('av.reference.import', async () => {
  ownerFor(event);
  return importAvReference(event.url.searchParams.get('url')?.trim() ?? '');
});
