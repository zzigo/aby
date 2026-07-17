import { api, AbyError, jsonBody, ownerFor } from '$lib/server/errors';
import { inspectFixture } from '$lib/server/ingest';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => api('ingest.preview', async () => {
  const body = await jsonBody(event) as { fixture?: unknown };
  if (body.fixture !== true) {
    throw new AbyError('phase_0_fixture_only', 'Phase 0 only inspects the bounded local fixture; Wasabi registration awaits authorized credentials', 501);
  }
  return { preview: await inspectFixture(ownerFor(event), getRepository()) };
});

