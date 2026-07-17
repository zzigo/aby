import { SourceIngestPreviewRequestSchema } from '@zztt/aby-domain';
import { api, AbyError, jsonBody, ownerFor } from '$lib/server/errors';
import { inspectFixture, inspectWasabiSource } from '$lib/server/ingest';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => api('ingest.preview', async () => {
  const body = await jsonBody(event) as { fixture?: unknown };
  const ownerId = ownerFor(event);
  if (body.fixture === true) return { preview: await inspectFixture(ownerId, getRepository()) };
  const input = SourceIngestPreviewRequestSchema.parse(body);
  if (input.analyze) throw new AbyError('analysis_not_available', 'The first adoption performs metadata identification only', 400);
  return { preview: await inspectWasabiSource(ownerId, input, getRepository()) };
});
