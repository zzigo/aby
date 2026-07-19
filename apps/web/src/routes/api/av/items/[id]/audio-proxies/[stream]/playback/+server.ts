import { api, ownerFor, AbyError } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { audioProxyPlayback } from '$lib/server/av-audio-proxies';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('av.audio-proxy.playback', async () => {
  const item = await getAvRepository().getItem(ownerFor(event), event.params.id);
  if (!item) throw new AbyError('av_item_not_found', 'AV item not found', 404);
  const stream = Number(event.params.stream);
  if (!Number.isInteger(stream) || stream < 0) throw new AbyError('invalid_audio_stream', 'Audio stream must be a non-negative integer', 400);
  return audioProxyPlayback(item, stream);
});
