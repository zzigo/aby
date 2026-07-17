import { SegmentCreateSchema } from '@zztt/aby-domain';
import { api, jsonBody, ownerFor } from '$lib/server/errors';
import { getRepository } from '$lib/server/repository';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => api('segment.create', async () => {
  const ownerId = ownerFor(event);
  const input = SegmentCreateSchema.parse(await jsonBody(event));
  const segment = await getRepository().createSegment(ownerId, input, {
    method: 'human', source: 'aby.inspect.manual-selection', actorId: ownerId,
    parameters: {}, timestamp: new Date().toISOString(), reviewState: 'accepted',
    reviewedBy: ownerId, reviewedAt: new Date().toISOString()
  });
  return { segment, event: { type: 'aby.segment.created.v1', segmentId: segment.id, assetId: segment.assetId, ownerId, occurredAt: new Date().toISOString() } };
});

