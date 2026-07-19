import { z } from 'zod';
import { api, jsonBody, ownerFor } from '$lib/server/errors';
import { inspectAvSource } from '$lib/server/av-inspection';
import type { RequestHandler } from './$types';

const RequestSchema = z.object({ sourceObjectKey: z.string().trim().min(1).max(4_000) });

export const POST: RequestHandler = (event) => api('av.inspect', async () => {
  const ownerId = ownerFor(event);
  const input = RequestSchema.parse(await jsonBody(event));
  const inspection = await inspectAvSource(ownerId, input.sourceObjectKey);
  return { inspection };
});
