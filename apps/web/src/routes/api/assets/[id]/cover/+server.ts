import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { api, AbyError, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import { artifactUrl, uploadWasabiArtifact } from '$lib/server/storage';
import type { RequestHandler } from './$types';

const imageTypes: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

export const GET: RequestHandler = async (event) => {
  const item = await getRepository().getCatalogItem(ownerFor(event), event.params.id);
  if (!item) throw new AbyError('asset_not_found', 'Asset not found', 404);
  const manual = item.asset.canonicalMetadata.imageCandidates?.find((candidate) => candidate.authority === 'manual-upload');
  const objectKey = manual?.provenance?.artifactObjectKey;
  if (!manual || typeof objectKey !== 'string') throw new AbyError('cover_not_found', 'Manual cover not found', 404);
  const signed = await artifactUrl(objectKey, String(manual.provenance.contentType || 'image/jpeg'));
  return new Response(null, {
    status: 302,
    headers: { location: signed.url, 'cache-control': 'private, no-store, max-age=0' }
  });
};

export const POST: RequestHandler = (event) => api('asset.cover.upload', async () => {
  const ownerId = ownerFor(event);
  const item = await getRepository().getCatalogItem(ownerId, event.params.id);
  if (!item) throw new AbyError('asset_not_found', 'Asset not found', 404);
  const form = await event.request.formData();
  const file = form.get('cover');
  if (!(file instanceof File)) throw new AbyError('cover_missing', 'Choose an image file', 400);
  const suffix = imageTypes[file.type];
  if (!suffix) throw new AbyError('cover_type_invalid', 'Cover must be JPEG, PNG or WebP', 415);
  if (!file.size || file.size > 10 * 1024 * 1024) throw new AbyError('cover_size_invalid', 'Cover must be between 1 byte and 10 MB', 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  const directory = await mkdtemp(join(tmpdir(), 'aby-cover-'));
  const localPath = join(directory, `cover${suffix}`);
  const objectKey = `aby/_artwork/${item.asset.id}/${digest}${suffix}`;
  try {
    await writeFile(localPath, bytes, { flag: 'wx' });
    await uploadWasabiArtifact(objectKey, localPath, file.type);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const prior = item.asset.canonicalMetadata.imageCandidates?.filter((candidate) => candidate.authority !== 'manual-upload') ?? [];
  const updated = await getRepository().mergeCanonicalMetadata(ownerId, item.asset.id, {
    imageCandidates: [{
      authority: 'manual-upload', url: `/api/assets/${item.asset.id}/cover?v=${digest.slice(0, 16)}`, kind: 'cover', exactRelease: true,
      sourceId: digest,
      provenance: { artifactObjectKey: objectKey, contentType: file.type, originalFilename: file.name || `cover${extname(localPath)}` }
    }, ...prior]
  });
  return { item: updated };
});
