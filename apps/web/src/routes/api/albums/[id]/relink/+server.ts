import { z } from 'zod';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { basename, dirname } from 'node:path';
import type { RequestHandler } from './$types';
import { api, AbyError, jsonBody, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import { readConfig } from '$lib/server/config';
import { wasabiClient, normalizeObjectKey } from '$lib/server/storage';

const relinkInputSchema = z.object({
  targetPrefix: z.string().trim()
});

export const POST: RequestHandler = (event) => api('album.relink', async () => {
  const ownerId = ownerFor(event);
  const repository = getRepository();
  const input = relinkInputSchema.parse(await jsonBody(event));
  let targetPrefix = input.targetPrefix;
  if (!targetPrefix.endsWith('/')) targetPrefix += '/';

  const items = (await repository.listCatalog(ownerId)).filter((item) => item.albumId === event.params.id);
  if (!items.length) throw new AbyError('album_not_found', 'Album not found', 404);

  const config = readConfig();
  const bucket = config.WASABI_BUCKET!;
  const root = config.wasabiRootPrefix ? normalizeObjectKey(config.wasabiRootPrefix).replace(/\/+$/, '') + '/' : '';
  const physicalPrefix = `${root}${targetPrefix}`;

  const targetFiles: Array<{ key: string; size: number }> = [];
  let continuationToken: string | undefined;
  do {
    const response = await wasabiClient().send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: physicalPrefix,
      ContinuationToken: continuationToken
    }));

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (!obj.Key || obj.Key.endsWith('/')) continue;
        let logicalKey = obj.Key;
        if (root && logicalKey.startsWith(root)) {
          logicalKey = logicalKey.substring(root.length);
        }
        targetFiles.push({ key: logicalKey, size: obj.Size ?? 0 });
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  if (!targetFiles.length) {
    throw new AbyError('relink_folder_empty', `No files found in target folder "${targetPrefix}"`, 400);
  }

  const matchedKeys = new Set<string>();
  const updates: Array<{ assetId: string; targetKey: string }> = [];
  const unmatched: string[] = [];

  for (const item of items) {
    const trackFilename = basename(item.asset.objectKey);
    const trackSize = item.asset.technicalMetadata.sizeBytes;

    let fileMatch = targetFiles.find(f => !matchedKeys.has(f.key) && f.size === trackSize);
    
    if (!fileMatch) {
      fileMatch = targetFiles.find(f => !matchedKeys.has(f.key) && basename(f.key).toLowerCase() === trackFilename.toLowerCase());
    }

    if (!fileMatch) {
      const trackNumStr = item.trackNumber !== undefined ? String(item.trackNumber).padStart(2, '0') : null;
      fileMatch = targetFiles.find(f => {
        if (matchedKeys.has(f.key)) return false;
        const name = basename(f.key).toLowerCase();
        if (trackNumStr && (name.startsWith(trackNumStr) || name.includes(`-${trackNumStr}`) || name.includes(` ${trackNumStr}`))) {
          return true;
        }
        return false;
      });
    }

    if (fileMatch) {
      matchedKeys.add(fileMatch.key);
      updates.push({ assetId: item.asset.id, targetKey: fileMatch.key });
    } else {
      unmatched.push(item.recordingTitle);
    }
  }

  if (!updates.length) {
    throw new AbyError('relink_no_matches', 'Could not match any tracks to the files in the target folder.', 400);
  }

  for (const update of updates) {
    await repository.relinkAsset(ownerId, update.assetId, update.targetKey);
  }

  const updatedItems = (await repository.listCatalog(ownerId)).filter((item) => item.albumId === event.params.id);

  return {
    success: true,
    relinkedCount: updates.length,
    unmatchedCount: unmatched.length,
    unmatched,
    items: updatedItems
  };
});
