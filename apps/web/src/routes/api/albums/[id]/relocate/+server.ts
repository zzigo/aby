import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { sha256File } from '@zztt/aby-media-ingest';
import { z } from 'zod';
import { api, AbyError, jsonBody, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import { copyWasabiCanonicalObject, deleteWasabiCanonicalObject, downloadWasabiObject } from '$lib/server/storage';
import type { RequestHandler } from './$types';

const inputSchema = z.object({
  collectionCode: z.string().trim().regex(/^[A-Za-z0-9]{1,8}$/).transform((value) => value.toUpperCase()),
  limit: z.number().int().min(1).max(5).default(3)
});

function targetFor(source: string, collectionCode: string) {
  const parts = source.split('/');
  if (parts[0] !== 'aby' || !['aud', 'mov'].includes(parts[1] ?? '') || !parts[2]) {
    throw new AbyError('relocation_source_invalid', 'Only canonical aby/aud or aby/mov assets can be relocated', 409);
  }
  parts[2] = collectionCode;
  return parts.join('/');
}

export const POST: RequestHandler = (event) => api('album.relocate.copy', async () => {
  const ownerId = ownerFor(event);
  const repository = getRepository();
  const input = inputSchema.parse(await jsonBody(event));
  const items = (await repository.listCatalog(ownerId)).filter((item) => item.albumId === event.params.id);
  if (!items.length) throw new AbyError('album_not_found', 'Album not found', 404);
  const pending = items.filter((item) => item.asset.objectKey !== targetFor(item.asset.objectKey, input.collectionCode));
  const batch = pending.slice(0, input.limit);
  const directory = await mkdtemp(join(tmpdir(), 'aby-relocate-'));
  try {
    for (const item of batch) {
      const source = item.asset.objectKey;
      const target = targetFor(source, input.collectionCode);
      const copy = await copyWasabiCanonicalObject(source, target);
      if (copy.source.sizeBytes !== copy.head.sizeBytes) {
        throw new AbyError('relocation_size_mismatch', `Copied object size differs for ${target}`, 502);
      }
      const localPath = join(directory, `${randomUUID()}${extname(target).toLowerCase()}`);
      await downloadWasabiObject(target, localPath);
      if (await sha256File(localPath) !== item.asset.checksumSha256) {
        if (copy.created) await deleteWasabiCanonicalObject(target).catch(() => undefined);
        throw new AbyError('relocation_checksum_mismatch', `Copied object checksum differs for ${target}`, 502);
      }
      await repository.relocateAsset(ownerId, item.asset.id, source, target, input.collectionCode);
      await rm(localPath, { force: true });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const updated = (await repository.listCatalog(ownerId)).filter((item) => item.albumId === event.params.id);
  const remaining = updated.filter((item) => item.asset.objectKey !== targetFor(item.asset.objectKey, input.collectionCode)).length;
  const retirementPending = updated.reduce((count, item) => count + (item.asset.canonicalMetadata.storageRetirementCandidates ?? []).filter((candidate) => candidate.state === 'candidate').length, 0);
  return { items: updated, copied: batch.length, remaining, retirementPending, complete: remaining === 0 };
});

export const DELETE: RequestHandler = (event) => api('album.relocate.retire', async () => {
  const ownerId = ownerFor(event);
  const repository = getRepository();
  const input = z.object({ limit: z.number().int().min(1).max(10).default(5) }).parse(await jsonBody(event));
  const items = (await repository.listCatalog(ownerId)).filter((item) => item.albumId === event.params.id);
  if (!items.length) throw new AbyError('album_not_found', 'Album not found', 404);
  let retired = 0;
  for (const item of items) {
    if (retired >= input.limit) break;
    const candidates = item.asset.canonicalMetadata.storageRetirementCandidates ?? [];
    const candidate = candidates.find((entry) => entry.state === 'candidate');
    if (!candidate || candidate.targetObjectKey !== item.asset.objectKey || candidate.checksumSha256 !== item.asset.checksumSha256) continue;
    if (await repository.objectKeyInUse(candidate.sourceObjectKey)) {
      throw new AbyError('relocation_source_still_active', 'An old object is still referenced by an active catalog asset', 409);
    }
    await deleteWasabiCanonicalObject(candidate.sourceObjectKey);
    const retiredAt = new Date().toISOString();
    await repository.mergeCanonicalMetadata(ownerId, item.asset.id, {
      storageRetirementCandidates: candidates.map((entry) => entry === candidate ? { ...entry, state: 'retired', retiredAt } : entry)
    });
    retired += 1;
  }
  const updated = (await repository.listCatalog(ownerId)).filter((item) => item.albumId === event.params.id);
  const remaining = updated.reduce((count, item) => count + (item.asset.canonicalMetadata.storageRetirementCandidates ?? []).filter((candidate) => candidate.state === 'candidate').length, 0);
  return { items: updated, retired, remaining, complete: remaining === 0 };
});
