import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { z } from 'zod';
import { api, AbyError, jsonBody, ownerFor } from '$lib/server/errors';
import { searchDiscogsRelease } from '$lib/server/discogs';
import { findAlbumArtwork, getAudioFingerprint, identifyWithMusicBrainz, lookupAcoustID } from '$lib/server/musicbrainz';
import { getRepository } from '$lib/server/repository';
import { readConfig } from '$lib/server/config';
import { downloadWasabiObject } from '$lib/server/storage';
import { fetchWikidataEntity } from '$lib/server/wikidata';
import type { RequestHandler } from './$types';

const QuerySchema = z.discriminatedUnion('service', [
  z.object({ service: z.literal('musicbrainz'), creator: z.string().trim().min(1), title: z.string().trim().min(1), durationMs: z.number().int().nonnegative() }),
  z.object({ service: z.literal('wikidata'), query: z.string().trim().min(1) }),
  z.object({ service: z.literal('cover-art'), creator: z.string().trim().min(1), albumTitle: z.string().trim().min(1) }),
  z.object({ service: z.literal('discogs'), creator: z.string().trim().min(1), albumTitle: z.string().trim().min(1), year: z.string().trim().optional() }),
  z.object({ service: z.literal('acoustid'), assetId: z.string().uuid() })
]);

export const POST: RequestHandler = (event) => api('metadata.query', async () => {
  const parsed = QuerySchema.safeParse(await jsonBody(event));
  if (!parsed.success) throw new AbyError('metadata_query_invalid', parsed.error.issues[0]?.message ?? 'Invalid metadata query', 400);
  const input = parsed.data;
  if (input.service === 'musicbrainz') {
    return { service: input.service, result: await identifyWithMusicBrainz({ creator: input.creator, workTitle: input.title, durationMs: input.durationMs }) };
  }
  if (input.service === 'wikidata') {
    return { service: input.service, result: await fetchWikidataEntity(input.query) };
  }
  if (input.service === 'cover-art') {
    return { service: input.service, result: await findAlbumArtwork(input) };
  }
  if (input.service === 'discogs') {
    return { service: input.service, result: await searchDiscogsRelease(input) };
  }

  const item = await getRepository().getCatalogItem(ownerFor(event), input.assetId);
  if (!item) throw new AbyError('asset_not_found', 'Asset not found', 404);
  if (item.asset.provider === 'local-fixture') throw new AbyError('metadata_unavailable', 'AcoustID requires a canonical audio asset', 409);
  const config = readConfig();
  const directory = await mkdtemp(join(tmpdir(), 'aby-acoustid-query-'));
  try {
    const localPath = join(directory, `source${extname(item.asset.objectKey).toLowerCase()}`);
    await downloadWasabiObject(item.asset.objectKey, localPath);
    const fingerprint = await getAudioFingerprint(localPath, config.FPCALC_PATH);
    if (!fingerprint) return { service: input.service, result: null };
    const result = await lookupAcoustID(fingerprint.duration, fingerprint.fingerprint, config.ACOUSTID_CLIENT_API_KEY);
    return {
      service: input.service,
      result: { duration: fingerprint.duration, status: result?.status, results: result?.results?.slice(0, 5) ?? [] }
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
