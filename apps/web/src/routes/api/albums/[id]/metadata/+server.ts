import { z } from 'zod';
import { api, AbyError, jsonBody, ownerFor } from '$lib/server/errors';
import { getDiscogsRelease, parseDiscogsDuration, parseDiscogsReleaseId, searchDiscogsRelease } from '$lib/server/discogs';
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
  const input = z.object({
    releaseId: z.string().regex(/^\d+$/),
    setPosition: z.string().trim().max(100).optional()
  }).parse(await jsonBody(event));
  const parentCandidate = await getDiscogsRelease(input.releaseId);
  const setMember = input.setPosition
    ? parentCandidate.tracklist?.find((track) => track.position?.toLowerCase() === input.setPosition?.toLowerCase())
    : undefined;
  if (input.setPosition && !setMember) {
    throw new AbyError('discogs_set_member_not_found', `Discogs set member ${input.setPosition} was not found`, 404);
  }
  const candidate = setMember?.externalId
    ? await getDiscogsRelease(setMember.externalId)
    : parentCandidate;
  const items = (await repository.listCatalog(ownerId)).filter((item) => item.albumId === event.params.id);
  const first = items[0];
  if (!first) throw new AbyError('album_not_found', 'Album not found', 404);
  const selectedCover = candidate.coverUrl ? candidate : parentCandidate;
  const imageCandidates = selectedCover.coverUrl ? mergeImageCandidates([{
    authority: 'discogs', url: selectedCover.coverUrl, kind: 'cover' as const, exactRelease: true,
    sourceId: selectedCover.id, provenance: { canonicalUrl: selectedCover.canonicalUrl }
  }], first.asset.canonicalMetadata.imageCandidates) : first.asset.canonicalMetadata.imageCandidates ?? [];
  const fetchedAt = new Date().toISOString();
  const discNumber = setMember?.position?.match(/\d+/)?.[0];
  const declaredTotal = parentCandidate.formats?.find((format) => format.name.toLowerCase() === 'cd')?.quantity;
  const totalDiscs = declaredTotal && /^\d+$/.test(declaredTotal)
    ? Number(declaredTotal)
    : parentCandidate.tracklist?.filter((track) => /^CD\d+$/i.test(track.position ?? '')).length;
  const albumSet = setMember?.position ? {
    title: parentCandidate.title,
    position: setMember.position,
    ...(discNumber ? { discNumber: Number(discNumber) } : {}),
    ...(totalDiscs ? { totalDiscs } : {}),
    authority: 'discogs',
    externalId: parentCandidate.id,
    canonicalUrl: parentCandidate.canonicalUrl,
    ...(candidate.id !== parentCandidate.id ? { memberExternalId: candidate.id, memberCanonicalUrl: candidate.canonicalUrl } : {})
  } : undefined;
  const albumTags = [...new Set([
    ...(first.asset.canonicalMetadata.albumTags ?? []),
    ...(candidate.styles ?? [])
  ])];
  const localDurationMs = items.reduce((total, item) => total + item.asset.technicalMetadata.durationMs, 0);
  const memberDurationMs = setMember?.duration ? parseDiscogsDuration(setMember.duration) : undefined;
  const updated = await repository.applyAlbumMetadata(ownerId, event.params.id, {
    title: setMember
      ? (candidate.id !== parentCandidate.id ? candidate.title : setMember.title)
      : parentCandidate.title,
    albumArtist: candidate.creator,
    releaseDate: candidate.releaseDate || candidate.year || null,
    label: candidate.label || null,
    catalogNumber: candidate.catalogNumber || null,
    albumDurationMs: candidate.durationMs ?? memberDurationMs ?? localDurationMs,
    albumTags,
    genres: candidate.genres ?? [],
    styles: candidate.styles ?? [],
    roles: (candidate.credits ?? []).map((credit) => ({ ...credit, authority: 'discogs' })),
    notes: candidate.notes ?? first.asset.canonicalMetadata.albumNotes ?? null,
    albumSet: albumSet ?? null,
    collectionCode: first.asset.canonicalMetadata.collectionCode
  }, {
    ...(imageCandidates.length ? { imageCandidates } : {}),
    discogs: candidate,
    ...(albumSet ? { albumSet } : {}),
    discogsRefreshedAt: fetchedAt,
    metadataSources: [candidate, ...(candidate.id !== parentCandidate.id ? [parentCandidate] : [])].map((source) => ({
      authority: 'discogs', externalId: source.id, canonicalUrl: source.canonicalUrl, fetchedAt, reviewState: 'accepted' as const
    }))
  });
  return { items: updated, candidate: parentCandidate, appliedCandidate: candidate, setMember, albumSet };
});
