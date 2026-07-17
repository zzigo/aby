import { PromoteIngestSchema } from '@zztt/aby-domain';
import { api, jsonBody, ownerFor } from '$lib/server/errors';
import { promoteIngestCandidate } from '$lib/server/promotion';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => api('ingest.promote', async () => {
  const input = PromoteIngestSchema.parse(await jsonBody(event));
  return promoteIngestCandidate(ownerFor(event), input.previewId, getRepository());
});
