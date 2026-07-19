import { api, ownerFor, AbyError } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { startAudioProxy, withSelectableAudioTracks } from '$lib/server/av-audio-proxies';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => api('av.audio-proxy.start', async () => {
  const storedItem = await getAvRepository().getItem(ownerFor(event), event.params.id);
  if (!storedItem) throw new AbyError('av_item_not_found', 'AV item not found', 404);
  const item = await withSelectableAudioTracks(storedItem);
  const stream = Number(event.params.stream);
  if (!Number.isInteger(stream) || stream < 0) throw new AbyError('invalid_audio_stream', 'Audio stream must be a non-negative integer', 400);
  return { proxy: await startAudioProxy(item, stream) };
});
