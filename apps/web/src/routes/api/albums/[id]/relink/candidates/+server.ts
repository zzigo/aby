import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { extname, basename, dirname } from 'node:path';
import type { RequestHandler } from './$types';
import { api, AbyError, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import { readConfig } from '$lib/server/config';
import { wasabiClient, normalizeObjectKey } from '$lib/server/storage';

export const GET: RequestHandler = (event) => api('album.relink.candidates', async () => {
  const ownerId = ownerFor(event);
  const repository = getRepository();
  const items = (await repository.listCatalog(ownerId)).filter((item) => item.albumId === event.params.id);
  if (!items.length) throw new AbyError('album_not_found', 'Album not found', 404);

  const tracks = items.map((item) => ({
    assetId: item.asset.id,
    objectKey: item.asset.objectKey,
    filename: basename(item.asset.objectKey),
    sizeBytes: item.asset.technicalMetadata.sizeBytes,
    durationMs: item.asset.technicalMetadata.durationMs,
    checksumSha256: item.asset.checksumSha256
  }));

  const config = readConfig();
  const bucket = config.WASABI_BUCKET!;
  const root = config.wasabiRootPrefix ? normalizeObjectKey(config.wasabiRootPrefix).replace(/\/+$/, '') + '/' : '';

  const prefixes = [
    `${root}aby/audio/`,
    `${root}${config.sourceAudioPrefix}`
  ];

  const folders = new Map<string, Array<{ key: string; size: number }>>();

  for (const prefix of prefixes) {
    let continuationToken: string | undefined;
    do {
      const response = await wasabiClient().send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      }));

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (!obj.Key || obj.Key.endsWith('/')) continue;
          
          let logicalKey = obj.Key;
          if (root && logicalKey.startsWith(root)) {
            logicalKey = logicalKey.substring(root.length);
          }

          const dir = dirname(logicalKey);
          if (!folders.has(dir)) {
            folders.set(dir, []);
          }
          folders.get(dir)!.push({
            key: logicalKey,
            size: obj.Size ?? 0
          });
        }
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  const candidates: Array<{
    prefix: string;
    totalFiles: number;
    matchCount: number;
    sizeMatches: number;
    nameMatches: number;
    score: number;
  }> = [];

  for (const [dir, files] of folders.entries()) {
    let sizeMatches = 0;
    let nameMatches = 0;
    const matchedFiles = new Set<string>();

    for (const track of tracks) {
      const sizeMatch = files.find(f => !matchedFiles.has(f.key) && f.size === track.sizeBytes);
      if (sizeMatch) {
        sizeMatches++;
        matchedFiles.add(sizeMatch.key);
        continue;
      }

      const nameMatch = files.find(f => !matchedFiles.has(f.key) && basename(f.key).toLowerCase() === track.filename.toLowerCase());
      if (nameMatch) {
        nameMatches++;
        matchedFiles.add(nameMatch.key);
      }
    }

    const matchCount = sizeMatches + nameMatches;
    if (matchCount > 0) {
      const score = (sizeMatches * 2) + nameMatches;
      candidates.push({
        prefix: dir + '/',
        totalFiles: files.length,
        matchCount,
        sizeMatches,
        nameMatches,
        score
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  return { candidates };
});
