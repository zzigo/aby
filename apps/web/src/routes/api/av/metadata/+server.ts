import { api, ownerFor } from '$lib/server/errors';
import { getTmdbMovieDetails, lookupAvMetadataById, searchAvMetadata, type AvMetadataService } from '$lib/server/av-metadata';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('av.metadata.search', async () => {
  ownerFor(event);
  const tmdbId = event.url.searchParams.get('tmdbId')?.trim();
  if (tmdbId) return { details: await getTmdbMovieDetails(tmdbId) };
  const service = event.url.searchParams.get('service');
  const requested = service === 'tmdb' || service === 'wikidata' || service === 'internet-archive' ? service as AvMetadataService : undefined;
  const id = event.url.searchParams.get('id')?.trim();
  if (requested && id) return lookupAvMetadataById(requested, id);
  const query = event.url.searchParams.get('q')?.trim();
  if (!query) return { candidates: [], services: {} };
  const parsedYear = Number(event.url.searchParams.get('year'));
  return searchAvMetadata(query, Number.isInteger(parsedYear) && parsedYear >= 1800 ? parsedYear : undefined, requested);
});
