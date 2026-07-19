import { AbyError, api, ownerFor } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { videoProxyPlayback } from '$lib/server/av-video-proxies';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('av.video-proxy.playback', async () => {
  const item = await getAvRepository().getItem(ownerFor(event), event.params.id);
  if (!item) throw new AbyError('av_item_not_found', 'AV item not found', 404);
  return videoProxyPlayback(item);
});
