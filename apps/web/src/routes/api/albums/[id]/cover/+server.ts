import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redirect } from '@sveltejs/kit';
import { api, AbyError, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import { artifactUrl, uploadWasabiArtifact } from '$lib/server/storage';
import type { RequestHandler } from './$types';

const imageTypes: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

async function albumItems(ownerId: string, albumId: string) {
  const items = (await getRepository().listCatalog(ownerId)).filter((item) => item.albumId === albumId);
  if (!items.length) throw new AbyError('album_not_found', 'Album not found', 404);
  return items;
}

export const GET: RequestHandler = async (event) => {
  const items = await albumItems(ownerFor(event), event.params.id);
  const manual = items[0]!.asset.canonicalMetadata.imageCandidates
    ?.find((candidate) => candidate.authority === 'manual-upload');
  const objectKey = manual?.provenance?.artifactObjectKey;
  if (!manual || typeof objectKey !== 'string') throw new AbyError('cover_not_found', 'Manual cover not found', 404);
  const signed = await artifactUrl(objectKey, String(manual.provenance.contentType || 'image/jpeg'));
  redirect(302, signed.url);
};

export const POST: RequestHandler = async (event) => api('album.cover.upload', async () => {
  const ownerId = ownerFor(event);
  const items = await albumItems(ownerId, event.params.id);
  const form = await event.request.formData();
  const file = form.get('cover');
  if (!(file instanceof File)) throw new AbyError('cover_missing', 'Choose an image file', 400);
  const suffix = imageTypes[file.type];
  if (!suffix) throw new AbyError('cover_type_invalid', 'Cover must be JPEG, PNG or WebP', 415);
  if (!file.size || file.size > 10 * 1024 * 1024) {
    throw new AbyError('cover_size_invalid', 'Cover must be between 1 byte and 10 MB', 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  const directory = await mkdtemp(join(tmpdir(), 'aby-album-cover-'));
  const localPath = join(directory, `cover${suffix}`);
  const objectKey = `aby/_artwork/albums/${event.params.id}/${digest}${suffix}`;
  try {
    await writeFile(localPath, bytes, { flag: 'wx' });
    await uploadWasabiArtifact(objectKey, localPath, file.type);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const prior = items[0]!.asset.canonicalMetadata.imageCandidates
    ?.filter((candidate) => candidate.authority !== 'manual-upload') ?? [];
  const updated = await getRepository().mergeAlbumMetadata(ownerId, event.params.id, {
    imageCandidates: [{
      authority: 'manual-upload', url: `/api/albums/${event.params.id}/cover?v=${digest.slice(0, 16)}`,
      kind: 'cover', exactRelease: true, sourceId: digest,
      provenance: { artifactObjectKey: objectKey, contentType: file.type, originalFilename: file.name || `cover${suffix}` }
    }, ...prior]
  });
  return { items: updated };
});
