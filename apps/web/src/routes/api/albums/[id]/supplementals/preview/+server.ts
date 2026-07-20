import { AbyError, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import { supplementalArtifactUrl } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const ownerId = ownerFor(event);
  const items = (await getRepository().listCatalog(ownerId)).filter((item) => item.albumId === event.params.id);
  if (!items.length) throw new AbyError('album_not_found', 'Album not found', 404);
  const key = event.url.searchParams.get('key');
  if (!key) throw new AbyError('supplemental_key_missing', 'Choose a supplemental file', 400);
  const signed = await supplementalArtifactUrl(key, event.url.searchParams.get('type') ?? undefined);
  return new Response(null, { status: 302, headers: { location: signed.url, 'cache-control': 'private, no-store' } });
};
