import { z } from 'zod';
import { api, AbyError, jsonBody, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import { parseTrackTitle } from '$lib/server/track-title';
import type { RequestHandler } from './$types';

const inputSchema = z.object({
  creator: z.string().trim().max(500).optional(),
  albumTitle: z.string().trim().max(500).optional()
});

export const POST: RequestHandler = (event) => api('album.tracks.preview', async () => {
  const items = (await getRepository().listCatalog(ownerFor(event)))
    .filter((item) => item.albumId === event.params.id);
  if (!items.length) throw new AbyError('album_not_found', 'Album not found', 404);
  const input = inputSchema.parse(await jsonBody(event));
  const context = {
    creator: input.creator || items[0]?.creator,
    albumTitle: input.albumTitle || items[0]?.albumTitle
  };
  return {
    tracks: items.map((item) => {
      const parsed = parseTrackTitle(item.recordingTitle, context);
      return {
        assetId: item.asset.id,
        sourceTitle: item.recordingTitle,
        recordingTitle: parsed.title,
        trackNumber: parsed.trackNumber ?? item.trackNumber ?? null,
        changed: parsed.title !== item.recordingTitle || (parsed.trackNumber ?? item.trackNumber) !== item.trackNumber
      };
    })
  };
});
