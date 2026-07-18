import { LyricsEditSchema } from '@zztt/aby-domain';
import { api, AbyError, jsonBody, ownerFor } from '$lib/server/errors';
import { findLrclibLyrics, looksLikeLrc, parseLrc, plainLyricsFromLrc } from '$lib/server/lrclib';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('asset.lyrics.detail', async () => ({
  lyrics: await getRepository().getTimedText(ownerFor(event), event.params.id, 'lyrics')
}));

export const POST: RequestHandler = (event) => api('asset.lyrics.lrclib', async () => {
  const item = await getRepository().getCatalogItem(ownerFor(event), event.params.id);
  if (!item) throw new AbyError('asset_not_found', 'Asset not found', 404);
  const artistName = item.albumArtist?.trim() || item.creator?.trim();
  const albumName = item.albumTitle?.trim();
  if (!artistName || !albumName) {
    throw new AbyError('lyrics_signature_incomplete', 'Add track artist and album before searching LRCLIB', 400);
  }
  const record = await findLrclibLyrics({
    trackName: item.recordingTitle,
    artistName,
    albumName,
    durationSeconds: item.asset.technicalMetadata.durationMs / 1000
  });
  if (!record) throw new AbyError('lyrics_not_found', 'LRCLIB has no duration-matched lyrics for this track', 404);
  const syncedLyrics = record.syncedLyrics?.trim() || null;
  const plainLyrics = record.plainLyrics?.trim() || (syncedLyrics ? plainLyricsFromLrc(syncedLyrics) : '');
  return {
    candidate: {
      provider: 'lrclib', providerItemId: String(record.id), language: 'und',
      licenseStatus: 'external-provider', plainLyrics, syncedLyrics,
      instrumental: record.instrumental,
      cues: syncedLyrics ? parseLrc(syncedLyrics) : []
    }
  };
});

export const PUT: RequestHandler = (event) => api('asset.lyrics.save', async () => {
  const ownerId = ownerFor(event);
  const input = LyricsEditSchema.parse(await jsonBody(event));
  const submittedPlainText = input.plainLyrics.trim();
  const syncedLyrics = input.syncedLyrics?.trim() || (looksLikeLrc(submittedPlainText) ? submittedPlainText : null);
  const plainText = syncedLyrics ? plainLyricsFromLrc(syncedLyrics) : submittedPlainText;
  const cues = syncedLyrics
    ? parseLrc(syncedLyrics)
    : plainText.split(/\r?\n/).map((text) => text.trim()).filter(Boolean).slice(0, 5000).map((text, position) => ({
        position, startMs: null, endMs: null, text, speaker: null, words: [] as []
      }));
  const lyrics = await getRepository().saveTimedText(ownerId, event.params.id, {
    provider: input.provider,
    providerItemId: input.providerItemId ?? null,
    textType: 'lyrics', language: input.language,
    originalFormat: syncedLyrics ? 'lrc' : 'plain',
    syncLevel: syncedLyrics ? 'line' : 'none',
    originalText: syncedLyrics ?? plainText,
    plainText, offsetMs: 0, timeScale: 1,
    matchConfidence: input.matchConfidence ?? null,
    humanVerified: true, licenseStatus: input.licenseStatus,
    retrievedAt: new Date().toISOString(), cues
  });
  return { lyrics, item: await getRepository().getCatalogItem(ownerId, event.params.id) };
});
