import { api, AbyError, ownerFor } from '$lib/server/errors';
import { searchDiscogsRelease } from '$lib/server/discogs';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => api('album.metadata.discogs', async () => {
  const ownerId = ownerFor(event);
  const repository = getRepository();
  const items = (await repository.listCatalog(ownerId)).filter((item) => item.albumId === event.params.id);
  const first = items[0];
  if (!first) throw new AbyError('album_not_found', 'Album not found', 404);
  const creator = first.creator?.trim();
  if (!creator) throw new AbyError('album_creator_missing', 'Add the album creator before searching Discogs', 400);
  const candidate = await searchDiscogsRelease({
    creator,
    albumTitle: first.albumTitle || first.workTitle,
    year: first.releaseDate
  });
  if (!candidate) throw new AbyError('discogs_release_not_found', 'No Discogs release matched this album', 404);

  const prior = first.asset.canonicalMetadata.imageCandidates
    ?.filter((image) => image.authority !== 'discogs') ?? [];
  const imageCandidates = candidate.coverUrl ? [{
    authority: 'discogs', url: candidate.coverUrl, kind: 'cover' as const, exactRelease: true,
    sourceId: candidate.id, provenance: { canonicalUrl: candidate.canonicalUrl }
  }, ...prior] : prior;
  const updated = await repository.mergeAlbumMetadata(ownerId, event.params.id, {
    ...(imageCandidates.length ? { imageCandidates } : {}),
    discogs: candidate,
    discogsRefreshedAt: new Date().toISOString()
  });
  return { items: updated, candidate };
});
