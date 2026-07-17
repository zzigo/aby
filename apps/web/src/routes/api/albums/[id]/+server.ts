import { AlbumEditSchema } from '@zztt/aby-domain';
import { api, AbyError, jsonBody, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('album.detail', async () => {
  const items = (await getRepository().listCatalog(ownerFor(event)))
    .filter((item) => item.albumId === event.params.id);
  if (!items.length) throw new AbyError('album_not_found', 'Album not found', 404);
  return { items };
});

export const PATCH: RequestHandler = (event) => api('album.update', async () => ({
  items: await getRepository().updateAlbum(
    ownerFor(event), event.params.id, AlbumEditSchema.parse(await jsonBody(event))
  )
}));
