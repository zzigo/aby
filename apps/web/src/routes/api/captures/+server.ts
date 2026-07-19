import { CaptureCreateSchema } from '@zztt/aby-domain';
import { api, jsonBody, ownerFor } from '$lib/server/errors';
import { getAvRepository } from '$lib/server/av-repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => api('captures.list', async () => ({
  captures: await getAvRepository().listCaptures(ownerFor(event))
}));

export const POST: RequestHandler = (event) => api('captures.create', async () => ({
  capture: await getAvRepository().createCapture(ownerFor(event), CaptureCreateSchema.parse(await jsonBody(event)))
}));
