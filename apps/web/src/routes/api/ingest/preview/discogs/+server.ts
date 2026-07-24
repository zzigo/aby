import { SourceIngestPreviewRequestSchema } from '@zztt/aby-domain';
import { z } from 'zod';
import { api, AbyError, jsonBody, ownerFor } from '$lib/server/errors';
import { getDiscogsRelease, parseDiscogsReleaseId } from '$lib/server/discogs';
import { inspectWasabiSource } from '$lib/server/ingest';
import { applyDiscogsToIngestPreview } from '$lib/server/ingest-discogs';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

const DiscogsFolderPreviewSchema = SourceIngestPreviewRequestSchema.extend({
  release: z.string().trim().min(1).max(1_000)
});

export const POST: RequestHandler = (event) => api('ingest.preview.discogs-folder', async () => {
  const input = DiscogsFolderPreviewSchema.parse(await jsonBody(event));
  const { release, ...sourceInput } = input;
  if (input.mediaKind !== 'aud') {
    throw new AbyError('discogs_audio_only', 'Discogs folder adoption currently accepts audio albums', 400);
  }
  const releaseId = parseDiscogsReleaseId(release);
  if (!releaseId) {
    throw new AbyError(
      'discogs_release_invalid',
      'Enter a numeric Discogs release ID or a discogs.com/release/… URL',
      400
    );
  }
  const ownerId = ownerFor(event);
  const repository = getRepository();
  const discogs = await getDiscogsRelease(releaseId);
  const inspected = await inspectWasabiSource(ownerId, {
    ...sourceInput,
    creatorDisplay: discogs.creator,
    workTitle: discogs.title
  }, repository);
  const preview = applyDiscogsToIngestPreview(inspected, discogs);
  await repository.updatePreviewMetadata(ownerId, preview.id, preview.candidateMetadata);
  return { preview, discogs };
});
