import { AbyError, api, ownerFor } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { startVideoProxy, videoProxyState } from '$lib/server/av-video-proxies';
import type { RequestHandler } from './$types';

async function itemFor(event: Parameters<RequestHandler>[0]) {
  const item = await getAvRepository().getItem(ownerFor(event), event.params.id);
  if (!item) throw new AbyError('av_item_not_found', 'AV item not found', 404);
  return item;
}

export const GET: RequestHandler = (event) => api('av.video-proxy.state', async () => ({
  proxy: await videoProxyState(await itemFor(event))
}));

export const POST: RequestHandler = (event) => api('av.video-proxy.start', async () => ({
  proxy: await startVideoProxy(await itemFor(event))
}));
