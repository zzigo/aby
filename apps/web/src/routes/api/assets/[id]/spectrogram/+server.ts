import { api, AbyError, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import { artifactUrl } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('asset.spectrogram', async () => {
  const ownerId = ownerFor(event);
  const repository = getRepository();
  const asset = await repository.getAsset(ownerId, event.params.id);
  if (!asset) throw new AbyError('asset_not_found', 'Asset not found', 404);
  const analysis = await repository.getSpectrogramAnalysis(ownerId, asset.id);
  if (!analysis) throw new AbyError('spectrogram_pending', 'Spectrogram has not been generated for this asset', 404);
  const signed = await artifactUrl(analysis.artifactObjectKey, 'image/png');
  return {
    url: signed.url,
    expiresAt: signed.expiresAt,
    checksumSha256: analysis.sourceAssetChecksum,
    tool: analysis.tool,
    toolVersion: analysis.toolVersion,
    reviewState: analysis.reviewState,
    ...analysis.summary
  };
});
