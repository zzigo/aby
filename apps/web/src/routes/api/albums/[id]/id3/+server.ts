import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { inspectLocalAsset } from '@zztt/aby-media-ingest';
import type { CatalogItem } from '@zztt/aby-domain';
import { z } from 'zod';
import { api, AbyError, jsonBody, ownerFor } from '$lib/server/errors';
import { readConfig } from '$lib/server/config';
import { id3FfmpegArgs, id3Values } from '$lib/server/id3';
import { getRepository } from '$lib/server/repository';
import { downloadWasabiObject, uploadWasabiArtifact } from '$lib/server/storage';
import type { RequestHandler } from './$types';

const execFileAsync = promisify(execFile);

async function coverFile(item: CatalogItem | undefined, directory: string) {
  const candidate = item?.asset.canonicalMetadata.imageCandidates?.[0];
  if (!candidate) return undefined;
  const output = join(directory, 'cover-image');
  const artifactObjectKey = candidate.provenance?.artifactObjectKey;
  if (typeof artifactObjectKey === 'string') {
    await downloadWasabiObject(artifactObjectKey, output);
    return output;
  }
  if (!/^https:\/\//i.test(candidate.url)) return undefined;
  const coverUrl = new URL(candidate.url);
  const allowedHosts = ['i.discogs.com', 'coverartarchive.org', 'archive.org', 'upload.wikimedia.org'];
  if (!allowedHosts.some((host) => coverUrl.hostname === host || coverUrl.hostname.endsWith(`.${host}`))) {
    throw new AbyError('id3_cover_host_invalid', 'Cover host is not an approved metadata authority', 400);
  }
  const response = await fetch(coverUrl, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new AbyError('id3_cover_failed', `Cover download failed with HTTP ${response.status}`, 502);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new AbyError('id3_cover_size_invalid', 'Cover must be between 1 byte and 10 MB', 413);
  await writeFile(output, bytes, { flag: 'wx' });
  return output;
}

export const POST: RequestHandler = (event) => api('album.id3.write', async () => {
  const ownerId = ownerFor(event);
  const repository = getRepository();
  const items = (await repository.listCatalog(ownerId)).filter((item) => item.albumId === event.params.id);
  if (!items.length) throw new AbyError('album_not_found', 'Album not found', 404);
  const mp3Items = items.filter((item) => item.asset.objectKey.toLowerCase().endsWith('.mp3'));
  if (!mp3Items.length) throw new AbyError('id3_unavailable', 'This album has no MP3 assets', 409);
  const input = z.object({
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(10).default(5)
  }).parse(await jsonBody(event));
  const batch = mp3Items.slice(input.offset, input.offset + input.limit);
  const config = readConfig();
  const directory = await mkdtemp(join(tmpdir(), 'aby-id3-'));
  const results: Array<{ assetId: string; objectKey: string; checksumSha256: string; reused: boolean }> = [];
  try {
    const cover = await coverFile(batch[0], directory);
    for (const item of batch) {
      const values = id3Values(item);
      const metadataDigest = createHash('sha256').update(JSON.stringify({ values, cover: item.asset.canonicalMetadata.imageCandidates?.[0]?.sourceId })).digest('hex').slice(0, 16);
      const objectKey = `aby/_derivatives/id3/${item.asset.id}/${item.asset.checksumSha256.slice(0, 16)}-${metadataDigest}.mp3`;
      const existing = item.asset.canonicalMetadata.derivatives?.find((entry) => entry.kind === 'id3-master' && entry.objectKey === objectKey);
      if (existing?.checksumSha256) {
        results.push({ assetId: item.asset.id, objectKey, checksumSha256: existing.checksumSha256, reused: true });
        continue;
      }
      const input = join(directory, `${item.asset.id}-source.mp3`);
      const output = join(directory, `${item.asset.id}-id3.mp3`);
      await downloadWasabiObject(item.asset.objectKey, input);
      await execFileAsync(config.FFMPEG_PATH, id3FfmpegArgs(input, output, values, cover), {
        timeout: config.FFMPEG_ANALYSIS_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024
      });
      const inspected = await inspectLocalAsset(output, { binary: config.FFPROBE_PATH, timeoutMs: config.FFPROBE_TIMEOUT_MS });
      if (Math.abs(inspected.metadata.durationMs - item.asset.technicalMetadata.durationMs) > 2_000) {
        throw new AbyError('id3_duration_changed', `ID3 rewrite changed the duration of ${item.recordingTitle}`, 502);
      }
      await uploadWasabiArtifact(objectKey, output, 'audio/mpeg');
      const derivative = {
        kind: 'id3-master', objectKey, format: 'mp3', codec: item.asset.technicalMetadata.audioCodec || 'mp3',
        checksumSha256: inspected.checksumSha256, sourceChecksumSha256: item.asset.checksumSha256,
        metadataVersion: 'id3v2.3/aby-album-v1', createdAt: new Date().toISOString()
      };
      const derivatives = [
        derivative,
        ...(item.asset.canonicalMetadata.derivatives ?? []).filter((entry) => entry.kind !== 'id3-master' || entry.objectKey !== objectKey)
      ];
      await repository.mergeCanonicalMetadata(ownerId, item.asset.id, { derivatives });
      results.push({ assetId: item.asset.id, objectKey, checksumSha256: inspected.checksumSha256, reused: false });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const nextOffset = Math.min(input.offset + batch.length, mp3Items.length);
  return {
    written: results.length,
    total: mp3Items.length,
    processed: nextOffset,
    complete: nextOffset >= mp3Items.length,
    ...(nextOffset < mp3Items.length ? { nextOffset } : {}),
    results
  };
});
