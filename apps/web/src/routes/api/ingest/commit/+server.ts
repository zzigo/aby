import { CommitIngestSchema } from '@zztt/aby-domain';
import { api, jsonBody, ownerFor } from '$lib/server/errors';
import { promoteIngestCandidate } from '$lib/server/promotion';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => api('ingest.commit', async () => {
  const input = CommitIngestSchema.parse(await jsonBody(event));
  const ownerId = ownerFor(event);
  const repository = getRepository();
  let preview = await repository.getPreview(ownerId, input.previewId);
  let sourceRetirement: { objectKey: string; state: 'candidate' } | undefined;
  if (preview?.candidateMetadata.canonicalObjectKey
    && preview.candidateMetadata.canonicalObjectKey !== preview.objectKey) {
    const promotion = await promoteIngestCandidate(ownerId, input.previewId, repository);
    preview = promotion.preview;
    sourceRetirement = promotion.sourceRetirement;
  }
  const asset = await repository.commitPreview(
    ownerId,
    input.previewId,
    input.workTitle,
    input.recordingTitle,
    input.albumTitle,
    input.creator,
    input.date,
    input.releaseDate,
    input.label,
    input.catalogNumber,
    input.tracks
  );
  return {
    asset,
    ...(preview ? { preview } : {}),
    ...(sourceRetirement ? { sourceRetirement } : {}),
    event: { type: 'aby.asset.committed.v1', assetId: asset.id, ownerId: asset.ownerId, occurredAt: new Date().toISOString() }
  };
});
