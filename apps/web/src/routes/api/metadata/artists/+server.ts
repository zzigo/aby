import { api } from '$lib/server/errors';
import { searchMusicBrainzArtists } from '$lib/server/musicbrainz';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('metadata.artists', async () => ({
  artists: await searchMusicBrainzArtists(event.url.searchParams.get('q') ?? '')
}));
