import { api, ownerFor, AbyError } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { downloadOpenSubtitleVtt } from '$lib/server/open-subtitles';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('av.external-subtitles.download', async () => {
  const ownerId = ownerFor(event);
  if (!await getAvRepository().getItem(ownerId, event.params.id)) throw new AbyError('av_item_not_found', 'AV item not found', 404);
  if (!/^\d+$/.test(event.params.file)) throw new AbyError('invalid_subtitle_file', 'OpenSubtitles file id must be numeric', 400);
  return new Response(await downloadOpenSubtitleVtt(Number(event.params.file)), {
    headers: { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'private, max-age=21600' }
  });
});
