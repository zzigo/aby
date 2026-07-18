import { api, AbyError, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import { artifactUrl } from '$lib/server/storage';
import { generateWaveform } from '$lib/server/waveform';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => api('asset.waveform', async () => {
  const ownerId = ownerFor(event);
  const repository = getRepository();
  const asset = await repository.getAsset(ownerId, event.params.id);
  if (!asset) throw new AbyError('asset_not_found', 'Asset not found', 404);
  let waveform = asset.canonicalMetadata.waveform;
  if (!waveform || waveform.sourceChecksumSha256 !== asset.checksumSha256) {
    waveform = await generateWaveform(asset);
    await repository.mergeCanonicalMetadata(ownerId, asset.id, { waveform });
  }
  const signed = await artifactUrl(waveform.artifactObjectKey, 'image/png');
  return { ...waveform, ...signed };
});
