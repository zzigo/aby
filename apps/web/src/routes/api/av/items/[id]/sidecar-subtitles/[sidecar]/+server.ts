import { artifactUrl, sourceVideoPlaybackUrl } from '$lib/server/storage';
import { api, ownerFor, AbyError } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { fetchSubtitleBytes, subtitleBytesToVtt } from '$lib/server/subtitle-vtt';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('av.sidecar-subtitle', async () => {
  const item = await getAvRepository().getItem(ownerFor(event), event.params.id);
  if (!item) throw new AbyError('av_item_not_found', 'AV item not found', 404);
  const index = Number(event.params.sidecar);
  const subtitle = Number.isInteger(index) ? item.technicalMetadata.sidecarSubtitles?.[index] : undefined;
  if (!subtitle) throw new AbyError('sidecar_subtitle_not_found', 'Sidecar subtitle not found', 404);
  const delivery = item.state === 'available'
    ? await artifactUrl(subtitle.destinationObjectKey, 'application/x-subrip')
    : await sourceVideoPlaybackUrl(subtitle.sourceObjectKey);
  return new Response(await subtitleBytesToVtt(await fetchSubtitleBytes(delivery.url)), {
    headers: { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'private, max-age=300' }
  });
});
