import { AbyError, api, ownerFor } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { artifactUrl, sourceVideoPlaybackUrl } from '$lib/server/storage';
import { selectableAvStreams } from '$lib/server/av-streams';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('av.item.playback', async () => {
  const item = await getAvRepository().getItem(ownerFor(event), event.params.id);
  if (!item) throw new AbyError('av_item_not_found', 'AV item not found', 404);
  const delivery = await (item.state === 'available'
    ? artifactUrl(item.destinationObjectKey, item.technicalMetadata.contentType ?? 'video/mp4')
    : sourceVideoPlaybackUrl(item.sourceObjectKey));
  return { ...delivery, ...await selectableAvStreams(item.id,delivery.url,item.technicalMetadata) };
});
