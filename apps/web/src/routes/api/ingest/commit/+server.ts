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
  if (preview) {
    let updated = false;
    if (input.canonicalObjectKey && input.canonicalObjectKey !== preview.candidateMetadata.canonicalObjectKey) {
      preview.candidateMetadata.canonicalObjectKey = input.canonicalObjectKey;
      updated = true;
    }
    if (input.tracks && preview.candidateMetadata.tracks) {
      for (const inputTrack of input.tracks) {
        const matchedTrack = preview.candidateMetadata.tracks.find(t => 
          t.objectKey === inputTrack.objectKey && 
          t.trackNumber === inputTrack.trackNumber
        ) || preview.candidateMetadata.tracks.find(t => t.objectKey === inputTrack.objectKey);
        
        if (matchedTrack && inputTrack.canonicalObjectKey && inputTrack.canonicalObjectKey !== matchedTrack.canonicalObjectKey) {
          matchedTrack.canonicalObjectKey = inputTrack.canonicalObjectKey;
          updated = true;
        }
      }
    }
    if (updated) {
      await repository.updatePreviewMetadata(ownerId, preview.id, preview.candidateMetadata);
    }
  }

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
