import { AbyError, api, ownerFor } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { selectableAvStreams } from '$lib/server/av-streams';
import { playableVideoDelivery } from '$lib/server/av-video-proxies';
import type { RequestHandler } from './$types';
import { discoverAvSidecars } from '$lib/server/av-inspection';
import { basename, dirname } from 'node:path';

export const GET: RequestHandler = (event) => api('av.item.playback', async () => {
  const ownerId = ownerFor(event);
  const storedItem = await getAvRepository().getItem(ownerId, event.params.id);
  if (!storedItem) throw new AbyError('av_item_not_found', 'AV item not found', 404);
  const item = storedItem.technicalMetadata.sidecarSubtitles ? storedItem : await getAvRepository().updateItemTechnicalMetadata(ownerId, storedItem.id, {
    ...storedItem.technicalMetadata,
    sidecarSubtitles: (await discoverAvSidecars(storedItem.sourceObjectKey)).map((sidecar) => ({
      ...sidecar, destinationObjectKey: `${dirname(storedItem.destinationObjectKey)}/${basename(sidecar.sourceObjectKey)}`
    }))
  });
  const delivery = await playableVideoDelivery(item);
  return { ...delivery, ...await selectableAvStreams(item.id,delivery.url,item.technicalMetadata), sidecarSubtitles: item.technicalMetadata.sidecarSubtitles ?? [] };
});
