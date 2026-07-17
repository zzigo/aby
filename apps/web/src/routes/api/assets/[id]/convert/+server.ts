import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { api, AbyError, ownerFor } from '$lib/server/errors';
import { readConfig } from '$lib/server/config';
import { getRepository } from '$lib/server/repository';
import { downloadWasabiObject, uploadWasabiArtifact } from '$lib/server/storage';
import type { RequestHandler } from './$types';

const execFileAsync = promisify(execFile);

export const POST: RequestHandler = (event) => api('asset.convert', async () => {
  const ownerId = ownerFor(event);
  const repository = getRepository();
  const item = await repository.getCatalogItem(ownerId, event.params.id);
  if (!item) throw new AbyError('asset_not_found', 'Asset not found', 404);
  if (item.asset.provider === 'local-fixture') throw new AbyError('conversion_unavailable', 'The local fixture cannot be converted', 409);
  const config = readConfig();
  const settings = await repository.getConversionSettings(ownerId);
  const directory = await mkdtemp(join(tmpdir(), 'aby-convert-'));
  const input = join(directory, `source${extname(item.asset.objectKey).toLowerCase()}`);
  const output = join(directory, 'playback.ogg');
  const objectKey = `aby/_derivatives/${item.asset.id}/${item.asset.checksumSha256.slice(0, 16)}-${settings.codec}-q${settings.quality}.ogg`;
  try {
    await downloadWasabiObject(item.asset.objectKey, input);
    const codecArgs = settings.codec === 'libopus'
      ? ['-c:a', 'libopus', '-b:a', `${64 + settings.quality * 16}k`]
      : ['-c:a', 'libvorbis', '-q:a', String(settings.quality)];
    await execFileAsync(config.FFMPEG_PATH, ['-y', '-i', input, '-vn', ...codecArgs, output], {
      timeout: config.FFMPEG_ANALYSIS_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024
    });
    await uploadWasabiArtifact(objectKey, output, 'audio/ogg');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const derivative = {
    kind: 'playback', objectKey, format: 'ogg', codec: settings.codec,
    quality: settings.quality, createdAt: new Date().toISOString()
  };
  const derivatives = [
    derivative,
    ...(item.asset.canonicalMetadata.derivatives ?? []).filter((entry) => entry.objectKey !== objectKey)
  ];
  const updated = await repository.mergeCanonicalMetadata(ownerId, item.asset.id, { derivatives });
  return { derivative, item: updated };
});
