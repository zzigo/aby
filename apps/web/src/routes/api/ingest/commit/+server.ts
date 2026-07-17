import { CommitIngestSchema } from '@zztt/aby-domain';
import { api, jsonBody, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => api('ingest.commit', async () => {
  const input = CommitIngestSchema.parse(await jsonBody(event));
  const asset = await getRepository().commitPreview(
    ownerFor(event),
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
  return { asset, event: { type: 'aby.asset.committed.v1', assetId: asset.id, ownerId: asset.ownerId, occurredAt: new Date().toISOString() } };
});
