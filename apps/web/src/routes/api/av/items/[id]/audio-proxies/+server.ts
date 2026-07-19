import { api, ownerFor, AbyError } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { audioProxyState, withSelectableAudioTracks } from '$lib/server/av-audio-proxies';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('av.audio-proxies.list', async () => {
  const storedItem = await getAvRepository().getItem(ownerFor(event), event.params.id);
  if (!storedItem) throw new AbyError('av_item_not_found', 'AV item not found', 404);
  const item = await withSelectableAudioTracks(storedItem);
  return { proxies: await Promise.all((item.technicalMetadata.audioTracks ?? []).map((track) => audioProxyState(item, track.index))) };
});
