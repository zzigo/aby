import { z } from 'zod';
import { api, AbyError, jsonBody, ownerFor } from '$lib/server/errors';
import { getDiscogsRelease, parseDiscogsReleaseId, searchDiscogsRelease } from '$lib/server/discogs';
import { getRepository } from '$lib/server/repository';
import { mergeImageCandidates } from '$lib/server/image-candidates';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => api('album.metadata.discogs', async () => {
  const ownerId = ownerFor(event);
  const repository = getRepository();
  const items = (await repository.listCatalog(ownerId)).filter((item) => item.albumId === event.params.id);
  const first = items[0];
  if (!first) throw new AbyError('album_not_found', 'Album not found', 404);
  const input = z.object({
    release: z.string().trim().max(1000).optional(),
    creator: z.string().trim().max(500).optional(),
    albumTitle: z.string().trim().max(500).optional(),
    year: z.string().trim().max(50).optional()
  }).parse(await jsonBody(event));
  if (input.release) {
    const releaseId = parseDiscogsReleaseId(input.release);
    if (!releaseId) {
      throw new AbyError(
        'discogs_release_invalid',
        'Enter a numeric Discogs release ID or a discogs.com/release/… URL',
        400
      );
    }
    return { candidate: await getDiscogsRelease(releaseId), match: 'exact' };
  }
  const creator = input.creator || first.albumArtist?.trim() || first.creator?.trim();
  if (!creator) throw new AbyError('album_creator_missing', 'Add the album creator before searching Discogs', 400);
  const candidate = await searchDiscogsRelease({
    creator,
    albumTitle: input.albumTitle || first.albumTitle || first.workTitle,
    year: input.year || first.releaseDate
  });
  if (!candidate) throw new AbyError('discogs_release_not_found', 'No Discogs release matched this album', 404);

  return { candidate, match: 'search' };
});

export const PUT: RequestHandler = (event) => api('album.metadata.discogs.apply', async () => {
  const ownerId = ownerFor(event);
  const repository = getRepository();
  const input = z.object({ releaseId: z.string().regex(/^\d+$/) }).parse(await jsonBody(event));
  const candidate = await getDiscogsRelease(input.releaseId);
  const items = (await repository.listCatalog(ownerId)).filter((item) => item.albumId === event.params.id);
  const first = items[0];
  if (!first) throw new AbyError('album_not_found', 'Album not found', 404);
  const imageCandidates = candidate.coverUrl ? mergeImageCandidates([{
    authority: 'discogs', url: candidate.coverUrl, kind: 'cover' as const, exactRelease: true,
    sourceId: candidate.id, provenance: { canonicalUrl: candidate.canonicalUrl }
  }], first.asset.canonicalMetadata.imageCandidates) : first.asset.canonicalMetadata.imageCandidates ?? [];
  const fetchedAt = new Date().toISOString();
  const albumTags = [...new Set([
    ...(first.asset.canonicalMetadata.albumTags ?? []),
    ...(candidate.styles ?? [])
  ])];
  const updated = await repository.applyAlbumMetadata(ownerId, event.params.id, {
    title: candidate.title,
    albumArtist: candidate.creator,
    releaseDate: candidate.releaseDate || candidate.year || null,
    label: candidate.label || null,
    catalogNumber: candidate.catalogNumber || null,
    albumDurationMs: candidate.durationMs ?? null,
    albumTags,
    genres: candidate.genres ?? [],
    styles: candidate.styles ?? [],
    roles: (candidate.credits ?? []).map((credit) => ({ ...credit, authority: 'discogs' })),
    notes: candidate.notes ?? first.asset.canonicalMetadata.albumNotes ?? null,
    collectionCode: first.asset.canonicalMetadata.collectionCode
  }, {
    ...(imageCandidates.length ? { imageCandidates } : {}),
    discogs: candidate,
    discogsRefreshedAt: fetchedAt,
    metadataSources: [{
      authority: 'discogs', externalId: candidate.id, canonicalUrl: candidate.canonicalUrl,
      fetchedAt, reviewState: 'accepted'
    }]
  });
  return { items: updated, candidate };
});
