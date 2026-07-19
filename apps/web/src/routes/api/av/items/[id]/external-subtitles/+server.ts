import { api, ownerFor } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import { getRepository } from '$lib/server/repository';
import { searchOpenSubtitles } from '$lib/server/open-subtitles';
import { AbyError } from '$lib/server/errors';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('av.external-subtitles.search', async () => {
  const ownerId = ownerFor(event);
  const item = await getAvRepository().getItem(ownerId, event.params.id);
  if (!item) throw new AbyError('av_item_not_found', 'AV item not found', 404);
  const settings = await getRepository().getAvSubtitleSettings(ownerId);
  return { settings, candidates: await searchOpenSubtitles(item, settings) };
});
